/**
 * Durable write queue for transactions.
 *
 * Guarantees
 *  - A transaction the user saved is never silently lost: if the network is
 *    unavailable it is persisted (AsyncStorage) and retried when online.
 *  - Replays are safe: creates carry a client-generated UUID and the
 *    `save_transaction` RPC is idempotent on it; deletes of missing rows are
 *    no-ops; edits carry `expectedUpdatedAt` so a conflicting edit made on
 *    another device is detected instead of overwritten.
 *  - Writes that the server rejects (validation, conflict) are kept in a
 *    "failed" state and surfaced to the user — never dropped automatically.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';

import { describeError, isNetworkError } from './errors';
import type { Minor } from './money';
import { deleteTransaction, saveTransaction, type SaveTransactionInput } from '@/services/transactions';
import type { TxnType } from '@/types/domain';

export interface PendingDisplay {
  type: TxnType;
  amount: Minor;
  currency: string;
  title: string;
  subtitle: string;
  occurredAt: string;
}

export type QueueItem =
  | {
      opId: string;
      kind: 'save';
      input: SaveTransactionInput;
      display: PendingDisplay;
      createdAt: string;
      status: 'pending' | 'failed';
      error?: string;
    }
  | {
      opId: string;
      kind: 'delete';
      transactionId: string;
      display: PendingDisplay;
      createdAt: string;
      status: 'pending' | 'failed';
      error?: string;
    };

type Listener = () => void;
type NewQueueItem = QueueItem extends infer T
  ? T extends QueueItem
    ? Omit<T, 'opId' | 'createdAt' | 'status'>
    : never
  : never;

class OfflineQueue {
  private items: QueueItem[] = [];
  private userId: string | null = null;
  private listeners = new Set<Listener>();
  private flushing: Promise<void> | null = null;
  private onSynced: (() => void) | null = null;

  private key() {
    return `cf.offline-queue.${this.userId}`;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.items;

  private emit() {
    this.items = [...this.items];
    for (const l of this.listeners) l();
  }

  private async persist() {
    if (!this.userId) return;
    await AsyncStorage.setItem(this.key(), JSON.stringify(this.items));
  }

  setSyncedHandler(handler: () => void) {
    this.onSynced = handler;
  }

  async load(userId: string | null) {
    this.userId = userId;
    this.items = [];
    if (userId) {
      try {
        const raw = await AsyncStorage.getItem(this.key());
        this.items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      } catch {
        this.items = [];
      }
    }
    this.emit();
  }

  hasUnsynced() {
    return this.items.length > 0;
  }

  async enqueue(item: NewQueueItem): Promise<void> {
    // Deleting something that was created offline and never synced: cancel both.
    if (item.kind === 'delete') {
      const pendingCreate = this.items.find(
        (i) => i.kind === 'save' && i.input.id === item.transactionId && i.input.mode === 'create',
      );
      if (pendingCreate) {
        this.items = this.items.filter((i) => !(i.kind === 'save' && i.input.id === item.transactionId));
        await this.persist();
        this.emit();
        return;
      }
    }
    this.items.push({
      ...item,
      opId: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    } as QueueItem);
    await this.persist();
    this.emit();
  }

  async discard(opId: string) {
    this.items = this.items.filter((i) => i.opId !== opId);
    await this.persist();
    this.emit();
  }

  async retry(opId: string) {
    this.items = this.items.map((i) => (i.opId === opId ? { ...i, status: 'pending', error: undefined } : i));
    await this.persist();
    this.emit();
    await this.flush();
  }

  /** Processes pending items in order. Stops at the first network failure. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let synced = 0;
      try {
        for (;;) {
          const next = this.items.find((i) => i.status === 'pending');
          if (!next) break;
          try {
            if (next.kind === 'save') await saveTransaction(next.input);
            else await deleteTransaction(next.transactionId);
            this.items = this.items.filter((i) => i.opId !== next.opId);
            synced++;
          } catch (err) {
            if (isNetworkError(err)) break;
            this.items = this.items.map((i) =>
              i.opId === next.opId ? { ...i, status: 'failed', error: describeError(err).message } : i,
            );
          }
          await this.persist();
          this.emit();
        }
      } finally {
        this.flushing = null;
        if (synced > 0) this.onSynced?.();
      }
    })();
    return this.flushing;
  }
}

export const offlineQueue = new OfflineQueue();

let netUnsubscribe: (() => void) | null = null;
export function startQueueAutoFlush(): () => void {
  netUnsubscribe?.();
  netUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) void offlineQueue.flush();
  });
  return () => {
    netUnsubscribe?.();
    netUnsubscribe = null;
  };
}

export type SubmitResult = { status: 'saved' } | { status: 'queued' };

async function isOnline(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return !!s.isConnected && s.isInternetReachable !== false;
}

/**
 * Saves now when online; queues durably when offline or the request fails for
 * network reasons. Validation errors are thrown so the form can show them.
 */
export async function submitTransaction(
  input: SaveTransactionInput,
  display: PendingDisplay,
): Promise<SubmitResult> {
  if (await isOnline()) {
    try {
      await saveTransaction(input);
      return { status: 'saved' };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  await offlineQueue.enqueue({ kind: 'save', input, display });
  return { status: 'queued' };
}

export async function submitDelete(transactionId: string, display: PendingDisplay): Promise<SubmitResult> {
  if (await isOnline()) {
    try {
      await deleteTransaction(transactionId);
      return { status: 'saved' };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  await offlineQueue.enqueue({ kind: 'delete', transactionId, display });
  return { status: 'queued' };
}
