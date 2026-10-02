/**
 * Receipt files in the private `receipts` bucket.
 * Path: <user_id>/transactions/<transaction_id>/<uuid>.<ext>
 *       <user_id>/inbox/<uuid>.<ext>   (scanned before a transaction exists)
 */
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { currentUserId, supabase, unwrap } from '@/lib/supabase';
import type { Attachment } from '@/types/domain';
import { mapAttachment, type Row } from './mappers';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_RECEIPT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;

export class AttachmentError extends Error {}

export interface LocalFile {
  uri: string;
  mimeType: string;
}

/**
 * Downscales and re-encodes photos to JPEG (~1600px, q=0.7). Keeps receipts
 * legible while typically shrinking them from several MB to ~300 KB, and strips
 * most metadata. PDFs are passed through unchanged.
 */
export async function prepareReceipt(file: LocalFile): Promise<LocalFile> {
  if (file.mimeType === 'application/pdf') return file;
  const context = ImageManipulator.manipulate(file.uri);
  context.resize({ width: 1600 });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function uploadReceipt(file: LocalFile, transactionId: string | null): Promise<Attachment> {
  if (!(ALLOWED_RECEIPT_TYPES as readonly string[]).includes(file.mimeType)) {
    throw new AttachmentError('Only JPEG, PNG, HEIC, WebP images or PDFs can be attached.');
  }
  const local = new File(file.uri);
  const size = local.size ?? 0;
  if (size <= 0) throw new AttachmentError('That file could not be read.');
  if (size > MAX_RECEIPT_BYTES) throw new AttachmentError('Receipts must be 10 MB or smaller.');

  const uid = await currentUserId();
  const name = `${randomUUID()}.${EXT[file.mimeType]}`;
  const path = transactionId ? `${uid}/transactions/${transactionId}/${name}` : `${uid}/inbox/${name}`;
  const bytes = await local.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, bytes, { contentType: file.mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('attachments')
    .insert({ transaction_id: transactionId, storage_path: path, mime_type: file.mimeType, size_bytes: size })
    .select('*')
    .single();
  if (error) {
    // Do not leave an orphaned file behind.
    await supabase.storage.from('receipts').remove([path]);
    throw error;
  }
  return mapAttachment(data as Row);
}

export async function linkAttachment(attachmentId: string, transactionId: string): Promise<void> {
  unwrap(
    await supabase
      .from('attachments')
      .update({ transaction_id: transactionId })
      .eq('id', attachmentId)
      .select('id'),
  );
}

export async function saveOcrResult(attachmentId: string, result: unknown): Promise<void> {
  unwrap(
    await supabase.from('attachments').update({ ocr_result: result }).eq('id', attachmentId).select('id'),
  );
}

export async function fetchAttachments(transactionId: string): Promise<Attachment[]> {
  const rows = unwrap(
    await supabase.from('attachments').select('*').eq('transaction_id', transactionId).order('created_at'),
  ) as Row[];
  return rows.map(mapAttachment);
}

/** Short-lived signed URL (5 minutes) for viewing a private receipt. */
export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteAttachment(att: Attachment): Promise<void> {
  unwrap(await supabase.from('attachments').delete().eq('id', att.id).select('id'));
  await supabase.storage.from('receipts').remove([att.storagePath]);
}

export type OcrOutcome =
  { status: 'ok'; text: string } | { status: 'not_configured' } | { status: 'failed'; message: string };

/** Calls the receipt-ocr Edge Function. Never creates records. */
export async function runReceiptOcr(path: string): Promise<OcrOutcome> {
  const { data, error } = await supabase.functions.invoke<{ text?: string; error?: string }>('receipt-ocr', {
    body: { path },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 501) return { status: 'not_configured' };
    return { status: 'failed', message: 'Text recognition failed. You can enter the details manually.' };
  }
  return { status: 'ok', text: data?.text ?? '' };
}
