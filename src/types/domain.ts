/**
 * Domain types used throughout the app. Monetary fields are integer minor
 * units (`Minor`); services convert from database NUMERIC at the boundary.
 */
import type { ISODate } from '@/lib/dates';
import type { Minor } from '@/lib/money';
import type { Frequency } from '@/lib/recurrence';
import type { BudgetPeriod } from '@/lib/budget';

export type UUID = string;

export type AccountType =
  | 'bank'
  | 'savings'
  | 'cash'
  | 'credit_card'
  | 'debit_card'
  | 'wallet'
  | 'investment'
  | 'loan'
  | 'other_asset'
  | 'other_liability';

export type TxnType = 'expense' | 'income' | 'transfer' | 'adjustment';
export type CategoryKind = 'expense' | 'income';
export type SpendClass = 'essential' | 'discretionary';
export type RecurringKind = 'general' | 'bill' | 'subscription';

export interface Profile {
  id: UUID;
  displayName: string | null;
  defaultCurrency: string;
  timezone: string;
}

export interface AppSettings {
  weekStartsOn: number;
  budgetWarningPercent: number;
  notifyUpcomingBills: boolean;
  notifyBudgetWarnings: boolean;
  notifyGoalReminders: boolean;
  notifySubscriptionRenewals: boolean;
  notifyMonthlySummary: boolean;
  billReminderDaysBefore: number;
  /** Day of month the user's money month starts (payday). 1 = calendar months. */
  cycleStartDay: number;
}

export interface Account {
  id: UUID;
  name: string;
  type: AccountType;
  institution: string | null;
  last4: string | null;
  currency: string;
  openingBalance: Minor;
  currentBalance: Minor;
  creditLimit: Minor | null;
  isActive: boolean;
  includeInNetWorth: boolean;
  color: string | null;
  icon: string | null;
  notes: string | null;
  sortOrder: number;
  /** Provider key (gpay, hdfc…) — display identity only, never credentials. */
  provider: string | null;
  /** Credit cards: day of month the statement is generated. */
  statementDay: number | null;
  /** Credit cards: day of month the payment is due. */
  dueDay: number | null;
  /** Credit cards: minimum amount due, as printed on the statement. */
  minimumDue: Minor | null;
  /** Latest balance (or available credit, see kind) printed in a bank SMS. */
  reportedBalance: Minor | null;
  reportedBalanceKind: 'balance' | 'limit' | null;
  reportedBalanceAt: string | null;
}

/**
 * A loan or EMI agreement. The instalments are posted by the linked recurring
 * transaction, which can charge any payment method — bank, card, UPI or cash.
 * Progress figures come from instalments actually recorded, never estimated.
 */
export interface Loan {
  id: UUID;
  name: string;
  lender: string | null;
  principalAmount: Minor;
  emiAmount: Minor;
  interestRate: number | null;
  tenureMonths: number | null;
  currency: string;
  startDate: ISODate;
  accountId: UUID;
  accountName: string;
  accountType: AccountType;
  categoryId: UUID | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  recurringId: UUID | null;
  nextPaymentDate: ISODate | null;
  endDate: ISODate | null;
  scheduleActive: boolean;
  autoPost: boolean;
  notes: string | null;
  color: string | null;
  icon: string | null;
  isClosed: boolean;
  paidAmount: Minor;
  paidCount: number;
  /** emi × tenure, exact; null when the tenure is unknown. */
  scheduledTotal: Minor | null;
  paymentsRemaining: number | null;
  amountRemaining: Minor | null;
}

/** An open credit-card billing cycle, computed by the database. */
export interface CardCycle {
  cycleStart: ISODate;
  cycleEnd: ISODate;
  statementDate: ISODate;
  dueDate: ISODate | null;
  spend: Minor;
  payments: Minor;
}

export interface Category {
  id: UUID;
  parentId: UUID | null;
  name: string;
  kind: CategoryKind;
  classification: SpendClass | null;
  icon: string | null;
  color: string | null;
  isArchived: boolean;
  sortOrder: number;
}

export interface Merchant {
  id: UUID;
  name: string;
  defaultCategoryId: UUID | null;
  isArchived: boolean;
}

export interface Transaction {
  id: UUID;
  type: TxnType;
  amount: Minor;
  currency: string;
  accountId: UUID;
  accountName: string;
  accountType: AccountType;
  toAccountId: UUID | null;
  toAccountName: string | null;
  toAccountType: AccountType | null;
  accountProvider: string | null;
  categoryId: UUID | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  subcategoryId: UUID | null;
  subcategoryName: string | null;
  merchantId: UUID | null;
  merchantName: string | null;
  occurredAt: string; // ISO instant
  notes: string | null;
  recurringId: UUID | null;
  tagNames: string[];
  hasReceipt: boolean;
  updatedAt: string;
  /** Where it came from: typed in, read from a bank SMS, imported… */
  source: TransactionSource;
  /** Auto-captured and not yet confirmed by the user. */
  needsReview: boolean;
  externalRef: string | null;
  splitGroupId: UUID | null;
  /** True while the write is waiting in the offline queue. */
  pending?: boolean;
}

export type TransactionSource = 'manual' | 'sms' | 'import' | 'recurring' | 'receipt';

export type BankMessageStatus =
  | 'received'
  | 'created'
  | 'linked'
  | 'paired'
  | 'duplicate'
  | 'ignored'
  | 'needs_account'
  | 'awaiting_pair'
  | 'balance'
  | 'dismissed';

/** One forwarded bank SMS and what the app did with it. */
export interface BankMessage {
  id: UUID;
  sender: string | null;
  body: string;
  receivedAt: string;
  status: BankMessageStatus;
  direction: 'debit' | 'credit' | null;
  amount: Minor | null;
  last4: string | null;
  bank: string | null;
  merchant: string | null;
  accountId: UUID | null;
  transactionId: UUID | null;
  note: string | null;
}

export interface BankSyncStatus {
  connected: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  pending: number;
  toReview: number;
  last30Days: Partial<Record<BankMessageStatus, number>>;
}

/** "Anything containing SWIGGY goes to Food › Food Delivery." */
export interface CategoryRule {
  id: UUID;
  pattern: string;
  kind: CategoryKind;
  categoryId: UUID;
  subcategoryId: UUID | null;
  createdAt: string;
}

/** A merchant charged on a steady rhythm — a likely subscription or bill. */
export interface DetectedRecurring {
  merchantId: UUID;
  merchantName: string;
  categoryId: UUID | null;
  accountId: UUID | null;
  frequency: Frequency;
  typicalAmount: Minor;
  lastAmount: Minor;
  occurrences: number;
  lastDate: ISODate;
  nextDate: ISODate;
  isTracked: boolean;
}

export interface RecurringItem {
  id: UUID;
  name: string;
  type: Exclude<TxnType, 'adjustment'>;
  kind: RecurringKind;
  amount: Minor;
  currency: string;
  accountId: UUID;
  toAccountId: UUID | null;
  categoryId: UUID | null;
  subcategoryId: UUID | null;
  merchantId: UUID | null;
  notes: string | null;
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate: ISODate | null;
  lastOccurrenceDate: ISODate | null;
  nextDueDate: ISODate | null;
  autoPost: boolean;
  remindDaysBefore: number;
  isActive: boolean;
}

export interface Budget {
  id: UUID;
  name: string;
  period: BudgetPeriod;
  startDate: ISODate;
  endDate: ISODate | null;
  currency: string;
  isActive: boolean;
  items: BudgetItem[];
}

export interface BudgetItem {
  id: UUID;
  categoryId: UUID | null;
  amount: Minor;
}

export interface BudgetStatusRow {
  budgetId: UUID;
  budgetName: string;
  period: BudgetPeriod;
  periodStart: ISODate;
  periodEnd: ISODate;
  itemId: UUID;
  categoryId: UUID | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  amount: Minor;
  spent: Minor;
}

export interface Goal {
  id: UUID;
  name: string;
  description: string | null;
  targetAmount: Minor;
  initialAmount: Minor;
  currentAmount: Minor;
  currency: string;
  targetDate: ISODate | null;
  accountId: UUID | null;
  icon: string | null;
  color: string | null;
  isArchived: boolean;
  createdAt: string;
}

export interface GoalContribution {
  id: UUID;
  goalId: UUID;
  amount: Minor;
  contributedOn: ISODate;
  note: string | null;
}

export interface NetWorthSnapshot {
  id: UUID;
  snapshotDate: ISODate;
  currency: string;
  assets: Minor;
  liabilities: Minor;
  netWorth: Minor;
}

export interface Attachment {
  id: UUID;
  transactionId: UUID | null;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PeriodSummary {
  income: Minor;
  expense: Minor;
  net: Minor;
  transactionCount: number;
  expenseCount: number;
  recurringExpense: Minor;
  subscriptionExpense: Minor;
  essentialExpense: Minor;
  discretionaryExpense: Minor;
  dayCount: number;
}

export interface CategoryTotal {
  categoryId: UUID | null;
  name: string;
  icon: string | null;
  color: string | null;
  classification: SpendClass | null;
  total: Minor;
  count: number;
}

export interface MerchantTotal {
  merchantId: UUID;
  name: string;
  total: Minor;
  count: number;
  average: Minor;
  largest: Minor;
}

export interface AccountTotal {
  accountId: UUID;
  name: string;
  type: AccountType;
  expense: Minor;
  income: Minor;
  count: number;
}

export interface SeriesPoint {
  bucket: ISODate;
  income: Minor;
  expense: Minor;
}

export interface DashboardAccount {
  id: UUID;
  name: string;
  type: AccountType;
  currency: string;
  currentBalance: Minor;
  creditLimit: Minor | null;
  includeInNetWorth: boolean;
  color: string | null;
  icon: string | null;
}

export interface DashboardData {
  currency: string;
  current: PeriodSummary;
  previous: PeriodSummary;
  categories: CategoryTotal[];
  previousCategories: CategoryTotal[];
  merchants: MerchantTotal[];
  trend: SeriesPoint[];
  accounts: DashboardAccount[];
}
