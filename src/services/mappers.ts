/**
 * Row → domain mappers. The only place snake_case database rows are touched.
 * NUMERIC values become integer minor units here.
 */
import { toMinor, type Minor } from '@/lib/money';
import type {
  Account,
  AccountTotal,
  AppSettings,
  Attachment,
  BankMessage,
  BankSyncStatus,
  CategoryRule,
  DetectedRecurring,
  DiscoveredAccount,
  Budget,
  BudgetItem,
  BudgetStatusRow,
  CardCycle,
  Category,
  CategoryTotal,
  DashboardAccount,
  DashboardData,
  Goal,
  GoalContribution,
  Loan,
  Merchant,
  MerchantTotal,
  NetWorthSnapshot,
  PeriodSummary,
  Profile,
  RecurringItem,
  SeriesPoint,
  Transaction,
} from '@/types/domain';

export type Row = Record<string, any>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const money = (v: unknown): Minor => toMinor(v as string | number | null);
const moneyOrNull = (v: unknown): Minor | null =>
  v === null || v === undefined ? null : toMinor(v as string | number);
/** Dates may arrive as 'YYYY-MM-DD' or full timestamps; keep the calendar part. */
const isoDate = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

export function mapProfile(r: Row): Profile {
  return {
    id: r.id,
    displayName: str(r.display_name),
    defaultCurrency: r.default_currency ?? 'INR',
    timezone: r.timezone ?? 'Asia/Kolkata',
    username: str(r.username),
    status: str(r.status),
    discoverable: r.discoverable !== false,
  };
}

export function mapSettings(r: Row): AppSettings {
  return {
    weekStartsOn: num(r.week_starts_on),
    budgetWarningPercent: num(r.budget_warning_percent),
    notifyUpcomingBills: !!r.notify_upcoming_bills,
    notifyBudgetWarnings: !!r.notify_budget_warnings,
    notifyGoalReminders: !!r.notify_goal_reminders,
    notifySubscriptionRenewals: !!r.notify_subscription_renewals,
    notifyMonthlySummary: !!r.notify_monthly_summary,
    billReminderDaysBefore: num(r.bill_reminder_days_before),
    cycleStartDay: r.cycle_start_day === null || r.cycle_start_day === undefined ? 1 : num(r.cycle_start_day),
    notifyFriendRequests: r.notify_friend_requests !== false,
    notifyMessages: r.notify_messages !== false,
    notifySharedExpenses: r.notify_shared_expenses !== false,
    notifySettlements: r.notify_settlements !== false,
    notifyReminders: r.notify_reminders !== false,
  };
}

export function mapAccount(r: Row): Account {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    institution: str(r.institution),
    last4: str(r.last4),
    currency: r.currency,
    openingBalance: money(r.opening_balance),
    currentBalance: money(r.current_balance),
    creditLimit: moneyOrNull(r.credit_limit),
    isActive: !!r.is_active,
    includeInNetWorth: !!r.include_in_net_worth,
    color: str(r.color),
    icon: str(r.icon),
    notes: str(r.notes),
    sortOrder: num(r.sort_order),
    provider: str(r.provider),
    statementDay: r.statement_day === null || r.statement_day === undefined ? null : num(r.statement_day),
    dueDay: r.due_day === null || r.due_day === undefined ? null : num(r.due_day),
    minimumDue: moneyOrNull(r.minimum_due),
    reportedBalance: moneyOrNull(r.reported_balance),
    reportedBalanceKind:
      r.reported_balance_kind === 'limit' || r.reported_balance_kind === 'balance'
        ? r.reported_balance_kind
        : null,
    reportedBalanceAt: str(r.reported_balance_at),
    systemKind: r.system_kind === 'friends' || r.system_kind === 'lending' ? r.system_kind : null,
  };
}

export function mapLoan(r: Row): Loan {
  return {
    id: r.id,
    name: r.name,
    lender: str(r.lender),
    principalAmount: money(r.principal_amount),
    emiAmount: money(r.emi_amount),
    interestRate: r.interest_rate === null || r.interest_rate === undefined ? null : Number(r.interest_rate),
    tenureMonths: r.tenure_months === null || r.tenure_months === undefined ? null : num(r.tenure_months),
    currency: r.currency ?? 'INR',
    startDate: isoDate(r.start_date)!,
    accountId: r.account_id,
    accountName: r.account_name ?? '',
    accountType: r.account_type,
    categoryId: str(r.category_id),
    categoryName: str(r.category_name),
    categoryIcon: str(r.category_icon),
    categoryColor: str(r.category_color),
    recurringId: str(r.recurring_id),
    nextPaymentDate: isoDate(r.next_payment_date),
    endDate: isoDate(r.end_date),
    scheduleActive:
      r.schedule_active === null || r.schedule_active === undefined ? false : !!r.schedule_active,
    autoPost: !!r.auto_post,
    notes: str(r.notes),
    color: str(r.color),
    icon: str(r.icon),
    isClosed: !!r.is_closed,
    paidAmount: money(r.paid_amount),
    paidCount: num(r.paid_count),
    scheduledTotal: moneyOrNull(r.scheduled_total),
    paymentsRemaining:
      r.payments_remaining === null || r.payments_remaining === undefined ? null : num(r.payments_remaining),
    amountRemaining: moneyOrNull(r.amount_remaining),
  };
}

export function mapCardCycle(r: Row): CardCycle {
  return {
    cycleStart: isoDate(r.cycle_start)!,
    cycleEnd: isoDate(r.cycle_end)!,
    statementDate: isoDate(r.statement_date)!,
    dueDate: isoDate(r.due_date),
    spend: money(r.spend),
    payments: money(r.payments),
  };
}

export function mapCategory(r: Row): Category {
  return {
    id: r.id,
    parentId: str(r.parent_id),
    name: r.name,
    kind: r.kind,
    classification: r.classification ?? null,
    icon: str(r.icon),
    color: str(r.color),
    isArchived: !!r.is_archived,
    sortOrder: num(r.sort_order),
  };
}

export function mapMerchant(r: Row): Merchant {
  return {
    id: r.id,
    name: r.name,
    defaultCategoryId: str(r.default_category_id),
    isArchived: !!r.is_archived,
  };
}

export function mapTransaction(r: Row): Transaction {
  return {
    id: r.id,
    type: r.type,
    amount: money(r.amount),
    currency: r.currency,
    accountId: r.account_id,
    accountName: r.account_name ?? '',
    accountType: r.account_type,
    toAccountId: str(r.to_account_id),
    toAccountName: str(r.to_account_name),
    toAccountType: (str(r.to_account_type) as Transaction['toAccountType']) ?? null,
    accountProvider: str(r.account_provider),
    categoryId: str(r.category_id),
    categoryName: str(r.category_name),
    categoryIcon: str(r.category_icon),
    categoryColor: str(r.category_color),
    subcategoryId: str(r.subcategory_id),
    subcategoryName: str(r.subcategory_name),
    merchantId: str(r.merchant_id),
    merchantName: str(r.merchant_name),
    occurredAt: r.occurred_at,
    notes: str(r.notes),
    recurringId: str(r.recurring_id),
    tagNames: Array.isArray(r.tag_names) ? r.tag_names : [],
    hasReceipt: !!r.has_receipt,
    updatedAt: r.updated_at,
    source: (str(r.source) as Transaction['source'] | null) ?? 'manual',
    needsReview: !!r.needs_review,
    externalRef: str(r.external_ref),
    splitGroupId: str(r.split_group_id),
    sharedExpenseId: str(r.shared_expense_id),
    settlementId: str(r.settlement_id),
  };
}

export function mapBankMessage(r: Row): BankMessage {
  const parsed = (r.parsed ?? {}) as Row;
  return {
    id: r.id,
    sender: str(r.sender),
    body: r.body,
    receivedAt: r.received_at,
    status: r.status,
    direction: r.direction === 'debit' || r.direction === 'credit' ? r.direction : null,
    amount: moneyOrNull(r.amount),
    last4: str(r.last4),
    bank: str(r.bank),
    merchant: str(parsed.merchant),
    instrument: (str(parsed.instrument) as BankMessage['instrument']) ?? null,
    isCardPayment: parsed.isCardPaymentReceived === true || parsed.isCardBillPayment === true,
    accountId: str(r.account_id),
    transactionId: str(r.transaction_id),
    note: str(r.note),
  };
}

export function mapDiscoveredAccount(r: Row): DiscoveredAccount {
  return {
    bank: str(r.bank),
    last4: str(r.last4),
    instrument: (str(r.instrument) as DiscoveredAccount['instrument']) ?? 'account',
    messageCount: num(r.message_count),
    firstAt: r.first_at,
    lastAt: r.last_at,
    latestBalance: moneyOrNull(r.latest_balance),
    balanceKind: r.balance_kind === 'balance' || r.balance_kind === 'limit' ? r.balance_kind : null,
    suggestedType: r.suggested_type,
    sampleMerchants: Array.isArray(r.sample_merchants) ? r.sample_merchants.map(String) : [],
  };
}

export function mapBankSyncStatus(r: Row): BankSyncStatus {
  return {
    connected: !!r.connected,
    connectedAt: str(r.connected_at),
    lastMessageAt: str(r.last_message_at),
    lastSmsAt: str(r.last_sms_at),
    lastEmailAt: str(r.last_email_at),
    emailCheckedAt: str(r.email_checked_at),
    pending: num(r.pending),
    toReview: num(r.to_review),
    last30Days: (r.last_30_days ?? {}) as BankSyncStatus['last30Days'],
  };
}

export function mapRule(r: Row): CategoryRule {
  return {
    id: r.id,
    pattern: r.pattern,
    kind: r.kind,
    categoryId: r.category_id,
    subcategoryId: str(r.subcategory_id),
    createdAt: r.created_at,
  };
}

export function mapDetectedRecurring(r: Row): DetectedRecurring {
  return {
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    categoryId: str(r.category_id),
    accountId: str(r.account_id),
    frequency: r.frequency,
    typicalAmount: money(r.typical_amount),
    lastAmount: money(r.last_amount),
    occurrences: num(r.occurrences),
    lastDate: isoDate(r.last_date)!,
    nextDate: isoDate(r.next_date)!,
    isTracked: !!r.is_tracked,
  };
}

export function mapRecurring(r: Row): RecurringItem {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    kind: r.kind,
    amount: money(r.amount),
    currency: r.currency,
    accountId: r.account_id,
    toAccountId: str(r.to_account_id),
    categoryId: str(r.category_id),
    subcategoryId: str(r.subcategory_id),
    merchantId: str(r.merchant_id),
    notes: str(r.notes),
    frequency: r.frequency,
    intervalCount: num(r.interval_count) || 1,
    startDate: isoDate(r.start_date)!,
    endDate: isoDate(r.end_date),
    lastOccurrenceDate: isoDate(r.last_occurrence_date),
    nextDueDate: isoDate(r.next_due_date),
    autoPost: !!r.auto_post,
    remindDaysBefore: num(r.remind_days_before),
    isActive: !!r.is_active,
  };
}

export function mapBudgetItem(r: Row): BudgetItem {
  return { id: r.id, categoryId: str(r.category_id), amount: money(r.amount) };
}

export function mapBudget(r: Row): Budget {
  return {
    id: r.id,
    name: r.name,
    period: r.period,
    startDate: isoDate(r.start_date)!,
    endDate: isoDate(r.end_date),
    currency: r.currency,
    isActive: !!r.is_active,
    items: Array.isArray(r.budget_items) ? r.budget_items.map(mapBudgetItem) : [],
  };
}

export function mapBudgetStatus(r: Row): BudgetStatusRow {
  return {
    budgetId: r.budget_id,
    budgetName: r.budget_name,
    period: r.period,
    periodStart: isoDate(r.period_start)!,
    periodEnd: isoDate(r.period_end)!,
    itemId: r.item_id,
    categoryId: str(r.category_id),
    categoryName: str(r.category_name),
    categoryColor: str(r.category_color),
    categoryIcon: str(r.category_icon),
    amount: money(r.amount),
    spent: money(r.spent),
  };
}

export function mapGoal(r: Row): Goal {
  return {
    id: r.id,
    name: r.name,
    description: str(r.description),
    targetAmount: money(r.target_amount),
    initialAmount: money(r.initial_amount),
    currentAmount: money(r.current_amount),
    currency: r.currency,
    targetDate: isoDate(r.target_date),
    accountId: str(r.account_id),
    icon: str(r.icon),
    color: str(r.color),
    isArchived: !!r.is_archived,
    createdAt: r.created_at,
  };
}

export function mapContribution(r: Row): GoalContribution {
  return {
    id: r.id,
    goalId: r.goal_id,
    amount: money(r.amount),
    contributedOn: isoDate(r.contributed_on)!,
    note: str(r.note),
  };
}

export function mapSnapshot(r: Row): NetWorthSnapshot {
  return {
    id: r.id,
    snapshotDate: isoDate(r.snapshot_date)!,
    currency: r.currency,
    assets: money(r.assets),
    liabilities: money(r.liabilities),
    netWorth: money(r.net_worth),
  };
}

export function mapAttachment(r: Row): Attachment {
  return {
    id: r.id,
    transactionId: str(r.transaction_id),
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
    createdAt: r.created_at,
  };
}

export function mapSummary(r: Row | null | undefined): PeriodSummary {
  const x = r ?? {};
  return {
    income: money(x.income),
    expense: money(x.expense),
    net: money(x.net),
    transactionCount: num(x.transaction_count),
    expenseCount: num(x.expense_count),
    recurringExpense: money(x.recurring_expense),
    subscriptionExpense: money(x.subscription_expense),
    essentialExpense: money(x.essential_expense),
    discretionaryExpense: money(x.discretionary_expense),
    dayCount: num(x.day_count),
  };
}

export function mapCategoryTotal(r: Row): CategoryTotal {
  return {
    categoryId: str(r.category_id),
    name: r.name ?? 'Uncategorised',
    icon: str(r.icon),
    color: str(r.color),
    classification: r.classification ?? null,
    total: money(r.total),
    count: num(r.tx_count),
  };
}

export function mapMerchantTotal(r: Row): MerchantTotal {
  return {
    merchantId: r.merchant_id,
    name: r.name,
    total: money(r.total),
    count: num(r.tx_count),
    average: money(r.average),
    largest: money(r.largest),
  };
}

export function mapAccountTotal(r: Row): AccountTotal {
  return {
    accountId: r.account_id,
    name: r.name,
    type: r.type,
    expense: money(r.expense),
    income: money(r.income),
    count: num(r.tx_count),
  };
}

export function mapSeries(r: Row): SeriesPoint {
  return { bucket: isoDate(r.bucket)!, income: money(r.income), expense: money(r.expense) };
}

function mapDashboardAccount(r: Row): DashboardAccount {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    currency: r.currency,
    currentBalance: money(r.current_balance),
    creditLimit: moneyOrNull(r.credit_limit),
    includeInNetWorth: !!r.include_in_net_worth,
    color: str(r.color),
    icon: str(r.icon),
  };
}

export function mapDashboard(r: Row): DashboardData {
  return {
    currency: r.currency ?? 'INR',
    current: mapSummary(r.current),
    previous: mapSummary(r.previous),
    categories: (r.categories ?? []).map(mapCategoryTotal),
    previousCategories: (r.previous_categories ?? []).map(mapCategoryTotal),
    merchants: (r.merchants ?? []).map(mapMerchantTotal),
    trend: (r.trend ?? []).map(mapSeries),
    accounts: (r.accounts ?? []).map(mapDashboardAccount),
  };
}
