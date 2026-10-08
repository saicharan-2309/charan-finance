/**
 * Indian bank / card SMS parser.
 *
 * Pure TypeScript with no imports, so the same file runs in the `ingest-sms`
 * Edge Function (Deno) and in the app and its Jest tests (Node).
 *
 * The parser only *reads* a message. It never decides which of the user's
 * accounts it belongs to or whether it is a duplicate — the database does
 * that, atomically, in `ingest_bank_sms`. Here we answer:
 *
 *   * Is this a real, completed money movement? (OTPs, promos, declined
 *     transactions, "will be debited" notices and statements are not.)
 *   * Debit or credit, how much, on which instrument (account / card), with
 *     which last digits, at which merchant, with which reference number.
 *
 * Amounts are returned as exact decimal strings ("1234.50"), never floats.
 */

export type SmsDirection = 'debit' | 'credit';
export type SmsInstrument = 'account' | 'credit_card' | 'debit_card' | 'card' | 'wallet';
export type SmsChannel =
  | 'upi'
  | 'card'
  | 'atm'
  | 'neft'
  | 'imps'
  | 'rtgs'
  | 'netbanking'
  | 'autopay'
  | 'cheque'
  | 'bbps'
  | 'cash'
  | 'other';

export type IgnoreReason =
  'otp' | 'promotional' | 'declined' | 'notice' | 'statement' | 'not_financial' | 'not_bank_sender';

export interface ParsedTransaction {
  kind: 'transaction';
  direction: SmsDirection;
  /** Exact decimal string, two places: "1234.50". */
  amount: string;
  instrument: SmsInstrument | null;
  /** Last 3–4 digits of the account or card the message is about. */
  last4: string | null;
  /** Bank key, matching the app's provider keys (hdfc, sbi, icici…). */
  bank: string | null;
  channel: SmsChannel;
  /** Cleaned, human merchant / payee / payer name. */
  merchant: string | null;
  /** Raw counterparty identifier: a UPI VPA or account fragment. */
  counterparty: string | null;
  /** Last digits of the *other* account in a transfer, when the SMS names it. */
  counterpartyLast4: string | null;
  /** UPI ref / UTR / transaction id — used for de-duplication and pairing. */
  reference: string | null;
  /** Date printed in the SMS (YYYY-MM-DD), if any. */
  occurredOn: string | null;
  /** Balance or available limit printed in the SMS, if any. */
  balance: string | null;
  balanceKind: 'balance' | 'limit' | null;
  /** A payment *into* a credit card (bill paid). */
  isCardPaymentReceived: boolean;
  /** A debit from a bank account that pays a credit-card bill. */
  isCardBillPayment: boolean;
  isRefund: boolean;
  isSalary: boolean;
  isInterest: boolean;
  isCashWithdrawal: boolean;
}

export interface ParsedBalance {
  kind: 'balance';
  last4: string | null;
  bank: string | null;
  instrument: SmsInstrument | null;
  balance: string;
  balanceKind: 'balance' | 'limit';
}

export interface ParsedIgnored {
  kind: 'ignored';
  reason: IgnoreReason;
  bank: string | null;
}

export type ParsedSms = ParsedTransaction | ParsedBalance | ParsedIgnored;

export interface SmsInput {
  body: string;
  sender?: string | null;
  /** ISO timestamp the phone received the SMS; used to sanity-check dates. */
  receivedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------

interface BankDef {
  key: string;
  label: string;
  /** Matched against the alphanumeric sender id (e.g. "AX-HDFCBK"). */
  senders: RegExp;
  /** Matched against the message body. */
  body: RegExp;
}

export const BANKS: BankDef[] = [
  { key: 'hdfc', label: 'HDFC Bank', senders: /HDFC/i, body: /\bHDFC\b/i },
  { key: 'icici', label: 'ICICI Bank', senders: /ICICI/i, body: /\bICICI\b/i },
  {
    key: 'sbi',
    label: 'State Bank of India',
    senders: /SBI|ATMSBI|SBICRD|SBMSMS|CBSSBI/i,
    body: /\bSBI\b|State Bank/i,
  },
  { key: 'axis', label: 'Axis Bank', senders: /AXIS/i, body: /\bAxis\b/i },
  { key: 'kotak', label: 'Kotak Mahindra Bank', senders: /KOTAK/i, body: /\bKotak\b/i },
  { key: 'idfc', label: 'IDFC FIRST Bank', senders: /IDFC/i, body: /\bIDFC\b/i },
  { key: 'yes', label: 'Yes Bank', senders: /YESBNK|YESBK/i, body: /\bYes ?Bank\b/i },
  { key: 'indusind', label: 'IndusInd Bank', senders: /INDUS/i, body: /\bIndusInd\b/i },
  {
    key: 'au',
    label: 'AU Small Finance Bank',
    senders: /AUBANK|AUSFB/i,
    body: /\bAU (Small Finance )?Bank\b/i,
  },
  { key: 'federal', label: 'Federal Bank', senders: /FEDBNK|FEDBK/i, body: /\bFederal Bank\b/i },
  { key: 'pnb', label: 'Punjab National Bank', senders: /PNB/i, body: /\bPNB\b|Punjab National/i },
  { key: 'bob', label: 'Bank of Baroda', senders: /BOB|BARODA/i, body: /\bBank of Baroda\b|\bBoB\b/i },
  { key: 'canara', label: 'Canara Bank', senders: /CANBNK|CANARA/i, body: /\bCanara\b/i },
  { key: 'union', label: 'Union Bank of India', senders: /UNIONB|UBOI/i, body: /\bUnion Bank\b/i },
  { key: 'idbi', label: 'IDBI Bank', senders: /IDBI/i, body: /\bIDBI\b/i },
  { key: 'rbl', label: 'RBL Bank', senders: /RBL/i, body: /\bRBL\b/i },
  { key: 'sc', label: 'Standard Chartered', senders: /SCBANK|STANCB/i, body: /Standard Chartered/i },
  { key: 'hsbc', label: 'HSBC', senders: /HSBC/i, body: /\bHSBC\b/i },
  { key: 'amex', label: 'American Express', senders: /AMEX/i, body: /American Express|\bAmex\b/i },
  { key: 'onecard', label: 'OneCard', senders: /ONECRD|ONECARD/i, body: /\bOneCard\b/i },
  { key: 'boi', label: 'Bank of India', senders: /BOIIND|BOI/i, body: /\bBank of India\b/i },
];

export function detectBank(sender: string | null | undefined, body: string): string | null {
  if (sender) {
    // "AX-HDFCBK", "VM-ICICIB-S", "JD-SBIUPI-T" → look at the alphanumeric id
    const id = sender.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    for (const b of BANKS) if (b.senders.test(id)) return b.key;
  }
  for (const b of BANKS) if (b.body.test(body)) return b.key;
  return null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CURRENCY = String.raw`(?:rs\.?|inr|₹)`;
const NUMBER = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;

/** "1,23,456.7" → "123456.70". Returns null for anything that isn't a positive amount. */
export function normaliseAmount(raw: string): string | null {
  const cleaned = raw.replace(/,/g, '');
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const w = whole.replace(/^0+(?=\d)/, '');
  const out = `${w}.${(frac + '00').slice(0, 2)}`;
  return /^0\.00$/.test(out) ? null : out;
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Finds the first date in the text, in any format Indian banks use. */
export function extractDate(text: string): string | null {
  // 2026-10-03 (optionally followed by :HH:MM:SS)
  let m = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  // 03-Oct-26, 03 Oct 2026, 03Oct26, 03-OCT-2026
  m = text.match(
    /\b(\d{1,2})[-\s/]?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[-\s/,]?\s?(\d{2,4})\b/i,
  );
  if (m) return validDate(fullYear(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  // 03-10-26, 03/10/2026, 03.10.26 — Indian banks always print day first
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return validDate(fullYear(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const OTP = /\b(otp|one[- ]time password|verification code|security code)\b|\bis your (?:otp|code)\b/i;
const DECLINED =
  /\b(declined|unsuccessful|failed|could not be (?:processed|completed)|not been processed|insufficient (?:funds|balance))\b/i;
const NOTICE =
  /\b(will be (?:debited|deducted|charged|auto-?debited)|to be debited|is due|due (?:on|by|date)|scheduled for|upcoming|pre-?debit|reminder|has requested|requested (?:money|rs|inr)|collect request|mandate (?:is |has been )?(?:successfully )?(?:created|registered|set up|approved)|payment request)\b/i;
const STATEMENT =
  /\b(statement (?:for|of|is)|total (?:amount )?due|minimum (?:amount )?due|min\.? (?:amt )?due|stmt)\b/i;
const PROMO =
  /\b(pre-?approved|apply now|get up to|eligible for|offer|congratulations|win |reward points|limit (?:upgrade|enhancement|increase)|loan of up to|click here|download the|exclusive|avail)\b/i;

const DEBIT_WORDS =
  /\b(debited|debit(?:ed)? (?:by|for|with)|spent|sent|withdrawn|withdrawal|paid|purchase(?:d)?|deducted|txn of|transaction of|used for|charged|transaction amount|thank you for using|has been used|was used)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|reversed|reversal|cashback|added to)\b/i;

function firstIndex(re: RegExp, s: string): number {
  const m = re.exec(s);
  return m ? m.index : -1;
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

interface Balance {
  amount: string;
  kind: 'balance' | 'limit';
  start: number;
  end: number;
}

const BALANCE_RE = new RegExp(
  String.raw`(?:avl\.?|avail(?:able)?|avbl|available|new|closing|clear|net avbl\.?|total avl\.?)?\s*` +
    String.raw`(bal(?:ance)?|lmt|limit|cr(?:edit)? ?limit)\b` +
    // "bal in A/c XX1234 is Rs 12,000" / "Bal :INR 9,700" / "limit is Rs.85,000"
    String.raw`[^0-9₹\n]{0,20}?(?:[x*]+\d{3,}[^0-9₹\n]{0,15}?)?` +
    CURRENCY +
    String.raw`?\s*:?\s*` +
    NUMBER,
  'gi',
);

function extractBalance(text: string): Balance | null {
  BALANCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BALANCE_RE.exec(text))) {
    const amount = normaliseAmount(m[2]);
    if (!amount) continue;
    const word = m[1].toLowerCase();
    return {
      amount,
      kind: word.startsWith('l') || word.includes('limit') ? 'limit' : 'balance',
      start: m.index,
      end: m.index + m[0].length,
    };
  }
  return null;
}

const AMOUNT_WITH_CURRENCY = new RegExp(CURRENCY + String.raw`\s*\.?\s*` + NUMBER, 'i');
// SBI writes "debited by 120.0" / "credited by Rs500"
const AMOUNT_AFTER_VERB = new RegExp(
  String.raw`(?:debited|credited|deposited|withdrawn)\s+(?:by|for|with|of)?\s*` +
    CURRENCY +
    String.raw`?\s*` +
    NUMBER,
  'i',
);

function extractAmount(text: string): string | null {
  const m = text.match(AMOUNT_WITH_CURRENCY);
  if (m) return normaliseAmount(m[1]);
  const v = text.match(AMOUNT_AFTER_VERB);
  if (v) return normaliseAmount(v[1]);
  return null;
}

interface Hint {
  instrument: SmsInstrument;
  last4: string | null;
  index: number;
}

const CARD_RE =
  /\b(credit card|debit card|card)\b(?:\s*(?:no\.?|number|ending(?:\s*(?:with|in))?|xx|x|\*|:))*\s*[x*]*\s*(\d{3,6})\b/i;
const CARD_NO_DIGITS = /\b(credit card|debit card)\b/i;
const ACCOUNT_RE =
  /\b(?:a\/c|a\/cx|acct|account|ac)\b\.?\s*(?:no\.?|number|ending(?:\s*(?:with|in))?)?\s*[:-]?\s*[x*]*\s*(\d{3,})\b/i;
// "A/cX5566" with no space before the X
const ACCOUNT_GLUED = /\ba\/c[x*]+(\d{3,})\b/i;

function lastDigits(d: string): string {
  return d.length > 4 ? d.slice(-4) : d;
}

function cardKind(word: string): SmsInstrument {
  const w = word.toLowerCase();
  if (w.startsWith('credit')) return 'credit_card';
  if (w.startsWith('debit')) return 'debit_card';
  return 'card';
}

function extractHint(text: string): Hint | null {
  const card = CARD_RE.exec(text);
  const acct = ACCOUNT_RE.exec(text) ?? ACCOUNT_GLUED.exec(text);
  const hints: Hint[] = [];
  if (card) hints.push({ instrument: cardKind(card[1]), last4: lastDigits(card[2]), index: card.index });
  if (acct) hints.push({ instrument: 'account', last4: lastDigits(acct[1]), index: acct.index });
  if (hints.length === 0) {
    const bare = CARD_NO_DIGITS.exec(text) ?? /\b(card)\b/i.exec(text);
    if (bare) return { instrument: cardKind(bare[1]), last4: null, index: bare.index };
    if (/\bwallet\b/i.test(text)) return { instrument: 'wallet', last4: null, index: 0 };
    return null;
  }
  // The instrument named first is the one the message is about.
  hints.sort((a, b) => a.index - b.index);
  return hints[0];
}

const REF_RE =
  /\b(?:upi\s*ref(?:erence)?(?:\s*no\.?)?|ref(?:erence)?\s*(?:no|number|id)?\.?|refno|utr(?:\s*no\.?)?|rrn|txn\s*(?:id|no)|transaction\s*(?:id|ref(?:erence)?)|upi)\s*[:.#-]?\s*(\d{6,})/i;
const SLASH_REF = /\b(?:upi|imps|neft)\/(?:p2[ampm]|dr|cr)?\/?(\d{9,})\//i;

function extractReference(text: string): string | null {
  const s = text.match(SLASH_REF);
  if (s) return s[1];
  const m = text.match(REF_RE);
  return m ? m[1] : null;
}

const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,30})\b/i;

/** Known merchants: legal names, gateways and VPAs → the name people recognise. */
const MERCHANT_ALIASES: Array<[RegExp, string]> = [
  [/\binstamart\b/i, 'Swiggy Instamart'],
  [/\bbundl\b|\bswiggy\b/i, 'Swiggy'],
  [/\bzomato\b/i, 'Zomato'],
  [/\bblinkit\b|\bgrofers\b/i, 'Blinkit'],
  [/\bzepto\b|kiranakart/i, 'Zepto'],
  [/\bbigbasket\b|supermarket grocery supplies/i, 'BigBasket'],
  [/\bamazon ?pay\b|\bamazon\b|\bamzn\b/i, 'Amazon'],
  [/\bflipkart\b/i, 'Flipkart'],
  [/\bmyntra\b/i, 'Myntra'],
  [/\buber\b/i, 'Uber'],
  [/\bola ?cabs?\b|\bani technologies\b/i, 'Ola'],
  [/\brapido\b|roppen/i, 'Rapido'],
  [/\bnetflix\b/i, 'Netflix'],
  [/\bspotify\b/i, 'Spotify'],
  [/\bhotstar\b|\bjiohotstar\b|novi digital/i, 'JioHotstar'],
  [/\byoutube\b|google ?\*?youtube/i, 'YouTube'],
  [/\bapple\.com|\bapple services\b|itunes/i, 'Apple'],
  [/\bgoogle ?play\b|google india digital/i, 'Google Play'],
  [/\birctc\b/i, 'IRCTC'],
  [/\bmakemytrip\b|\bmmt\b/i, 'MakeMyTrip'],
  [/\bbookmyshow\b|bigtree/i, 'BookMyShow'],
  [/\bcred\b|cred\.club|dreamplug/i, 'CRED'],
  [/\bairtel\b/i, 'Airtel'],
  [/\bjio\b|reliance jio/i, 'Jio'],
  [/\bdmart\b|avenue supermarts/i, 'DMart'],
  [/\bstarbucks\b|tata starbucks/i, 'Starbucks'],
  [/\bdomino'?s\b|jubilant foodworks/i, "Domino's"],
  [/\bmcdonald'?s?\b|hardcastle|connaught plaza/i, "McDonald's"],
  [/\bzerodha\b/i, 'Zerodha'],
  [/\bgroww\b|nextbillion/i, 'Groww'],
  [/\bpharmeasy\b/i, 'PharmEasy'],
  [/\bapollo\b/i, 'Apollo'],
  [/\burban ?company\b|urbanclap/i, 'Urban Company'],
  [/\bcult\.?fit\b|curefit/i, 'cult.fit'],
  [/\bnykaa\b|fsn e-?commerce/i, 'Nykaa'],
  [/\bchai point\b/i, 'Chai Point'],
];

const NOISE =
  /\b(pvt\.?|private|ltd\.?|limited|llp|india|indi|technologies|technology|tech|services|retail|ventures|solutions|e-?commerce|online|payments?|com)\b/gi;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Turns "AMAZON PAY INDIA PVT LTD" into "Amazon", "rahul.s@okicici" into "rahul.s". */
export function cleanMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = squash(raw)
    .replace(/^(?:vpa|to|from|at|by|info:?|upi\/p2[am]\/\d+\/)\s*/i, '')
    .replace(/^(?:mr\.?|mrs\.?|ms\.?|m\/s\.?)\s+/i, '')
    .replace(/^(?:raz|rzp|payu|pyu|bd|billdesk|ccavenue|cca|paytm|phonepe|php|gpay)\s*\*\s*/i, '')
    .replace(/[*#]+/g, ' ')
    .trim();
  for (const [re, name] of MERCHANT_ALIASES) if (re.test(s)) return name;
  const vpa = s.match(VPA_RE);
  if (vpa) {
    const local = vpa[1].split('@')[0];
    // QR codes / numeric handles say nothing useful about who was paid.
    if (/^(paytmqr|bharatpe|q\d|\d{6,})/i.test(local)) return null;
    s = local.replace(/[._-]+/g, ' ');
  }
  s = s.replace(NOISE, ' ').replace(/[^\p{L}\p{N}&' .-]/gu, ' ');
  s = squash(s).replace(/^[\s.&'-]+|[\s.&'-]+$/g, '');
  if (!s || /^\d+$/.test(s) || s.length < 2) return null;
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = titleCase(s);
  return s.slice(0, 60);
}

const MERCHANT_PATTERNS: RegExp[] = [
  // Emails: "Merchant Name: BLINKIT", "Merchant: Swiggy"
  /\bmerchant(?: name)?\s*[:\-]\s*([^\n]+)/i,
  // Axis: "UPI/P2M/627712340000/NETFLIX"
  /\bupi\/p2[am]\/\d+\/([^\n/]+)/i,
  // HDFC new UPI format: "To SWIGGY\nOn 03/10/26"
  /\bto\s+([^\n]+?)\s*(?:\n|\s+on\s+\d)/i,
  // Card spends: "At AMAZON PAY INDIA On 2026-..."
  /\bat\s+(.+?)\s+(?:on\s+(?:\d|[a-z]{3}\b)|\.|avl|avail|bal|not you|ref|txn|$)/i,
  // Short forms: "spent at Amazon using HDFC Card", "at Zomato via UPI"
  /\bat\s+(.+?)\s+(?:using|via|with|through|by)\b/i,
  /\bat\s+([a-z0-9&'.\- ]{2,40}?)\s*(?:\.|$)/i,
  // ICICI: "; ZOMATO credited."
  /;\s*([^;.]+?)\s+credited\b/i,
  // SBI: "trf to CHAI POINT Refno"
  /\btrf to\s+(.+?)\s+(?:ref|refno|on)\b/i,
  /\btransferred to\s+(.+?)(?:\.|\s+avl|\s+ref|$)/i,
  // "to VPA cred.club@axisb", "paid to xyz@ybl"
  /\bto\s+(?:vpa\s+)?([a-z0-9._-]+@[a-z0-9]+)/i,
  // "from RAHUL SHARMA." / "from rahul@okicici on"
  /\bfrom\s+(?!.*\ba\/c\b)(.+?)(?:\.\s|\.$|\s+on\s+\d|\s+\(|\s+upi|\s+ref|\s+-|\s+(?:has|have|is|was)\s|\s+credited|\s+to your|$)/i,
  // ICICI card: "on 03-Oct-26 on Flipkart."
  /\bon\s+\d{1,2}[-\s]?[a-z]{3}[-\s]?\d{2,4}\s+on\s+([^.]+?)(?:\.|$)/i,
  // "towards NETFLIX", "for SWIGGY"
  /\btowards\s+(.+?)(?:\.|\s+on\s|\s+ref|$)/i,
  // "Info: AMAZON", "Info-NEFT-..."
  /\binfo[:\s-]+([^.]+?)(?:\.|\s+avl|$)/i,
];

function neftName(text: string): string | null {
  // "NEFT Cr-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY OCT"
  const m = text.match(/\b(?:neft|imps|rtgs)\s*(?:cr|dr)?[-\s]+[a-z]{4}0[a-z0-9]{6}-([^-\n.]+)/i);
  return m ? m[1] : null;
}

function extractMerchant(
  text: string,
  direction: SmsDirection,
): { merchant: string | null; counterparty: string | null } {
  const vpa = text.match(VPA_RE);
  const counterparty = vpa ? vpa[1].toLowerCase() : null;
  const neft = neftName(text);
  if (neft) return { merchant: cleanMerchant(neft), counterparty };

  for (const re of MERCHANT_PATTERNS) {
    // A credit's "from X" is the payer; a debit's "from A/c" is our own account.
    if (direction === 'debit' && re.source.startsWith('\\bfrom')) continue;
    const m = text.match(re);
    if (!m) continue;
    const candidate = m[1];
    if (/\b(a\/c|acct|account|card)\b/i.test(candidate)) continue;
    const merchant = cleanMerchant(candidate);
    if (merchant) return { merchant, counterparty };
  }
  if (counterparty) return { merchant: cleanMerchant(counterparty), counterparty };
  // Line-by-line alerts (Axis cards: "Spent INR 2285 / Axis Bank Card no. XX1205 /
  // 08-10-26 17:09:11 IST / Blinkit / Avl Limit …"): the merchant is a line that is
  // only a name — no digits, and none of the alert's own words.
  if (direction === 'debit') {
    const line = text
      .split('\n')
      .map((l) => l.trim())
      .find(
        (l) =>
          /^[a-z][a-z &'.\-*]{1,39}$/i.test(l) &&
          !/\b(spent|debited|credited|inr|rs|card|bank|a\/c|acct|account|avl|available|limit|balance|bal|not you|sms|block|call|ist|dear|customer|txn|ref|upi|info)\b/i.test(
            l,
          ),
      );
    const merchant = line ? cleanMerchant(line) : null;
    if (merchant) return { merchant, counterparty };
  }
  return { merchant: null, counterparty };
}

function extractCounterpartyAccount(text: string, direction: SmsDirection): string | null {
  // "debited … and credited to a/c no. XXXXXXXX9876", "credited … from a/c XX1234"
  const re =
    direction === 'debit'
      ? /\bcredited to\s+(?:your\s+)?(?:a\/c|acct|account)\s*(?:no\.?)?\s*[x*]*(\d{3,})/i
      : /\b(?:debited from|from)\s+(?:your\s+)?(?:a\/c|acct|account)\s*(?:no\.?)?\s*[x*]*(\d{3,})/i;
  const m = text.match(re);
  return m ? lastDigits(m[1]) : null;
}

function detectChannel(text: string, instrument: SmsInstrument | null): SmsChannel {
  if (/\batm\b|withdrawn|cash withdrawal/i.test(text)) return 'atm';
  if (/\b(e-?mandate|auto-?pay|autodebit|auto debit|standing instruction|\bsi\b|nach|ecs)\b/i.test(text))
    return 'autopay';
  if (/\bupi\b|@[a-z]{2,}|\bvpa\b/i.test(text)) return 'upi';
  if (/\bimps\b/i.test(text)) return 'imps';
  if (/\bneft\b/i.test(text)) return 'neft';
  if (/\brtgs\b/i.test(text)) return 'rtgs';
  if (/\bbbps\b|bill ?desk|bill payment/i.test(text)) return 'bbps';
  if (/\bnet ?banking\b|\bnb\b|\binb\b/i.test(text)) return 'netbanking';
  if (/\bcheque\b|\bchq\b|\bclg\b/i.test(text)) return 'cheque';
  if (/\bcash deposit\b|\bcash dep\b/i.test(text)) return 'cash';
  if (instrument === 'credit_card' || instrument === 'debit_card' || instrument === 'card') return 'card';
  return 'other';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Could a bank have sent this? Indian banks send transaction alerts only from
 * registered sender IDs (AX-HDFCBK, JD-ICICIB) or short codes. A text from an
 * ordinary phone number or an email address is a person — or a fraudster
 * pasting a fake "Rs 5,000 credited" — so it is never read as a bank alert.
 * An unknown (empty) sender is allowed: the Shortcut may not pass one.
 */
export function isBankSender(sender: string | null | undefined): boolean {
  const s = (sender ?? '').trim();
  if (!s) return true;
  if (s.includes('@')) return false;
  return !/^\+?[0-9][0-9 ()-]{6,}$/.test(s);
}

export function parseBankSms(input: SmsInput): ParsedSms {
  const raw = input.body ?? '';
  const text = squash(raw.replace(/\r/g, ''));
  // Keep line structure for patterns that rely on it (HDFC "To X\nOn …").
  const lined = raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const bank = detectBank(input.sender, text);

  if (!text) return { kind: 'ignored', reason: 'not_financial', bank };
  if (!isBankSender(input.sender)) return { kind: 'ignored', reason: 'not_bank_sender', bank };
  if (OTP.test(text)) return { kind: 'ignored', reason: 'otp', bank };

  const balance = extractBalance(text);
  // Strip the balance phrase so "Avl Bal Rs 12,000" is never read as the amount.
  const body = balance ? text.slice(0, balance.start) + ' ' + text.slice(balance.end) : text;

  const debitAt = firstIndex(DEBIT_WORDS, body);
  const creditAt = firstIndex(CREDIT_WORDS, body);
  const hasDirection = debitAt >= 0 || creditAt >= 0;
  const hint = extractHint(text);

  if (DECLINED.test(text) && !/\b(refund|reversed|reversal|credited back)\b/i.test(text)) {
    return { kind: 'ignored', reason: 'declined', bank };
  }
  if (STATEMENT.test(text) && (!hasDirection || /\b(total|minimum|min\.?)\s+(amount\s+)?due\b/i.test(text))) {
    return { kind: 'ignored', reason: 'statement', bank };
  }
  if (NOTICE.test(text)) return { kind: 'ignored', reason: 'notice', bank };
  if (PROMO.test(text) && !hint) return { kind: 'ignored', reason: 'promotional', bank };

  if (!hasDirection) {
    if (balance && hint) {
      return {
        kind: 'balance',
        last4: hint.last4,
        bank,
        instrument: hint.instrument,
        balance: balance.amount,
        balanceKind: balance.kind,
      };
    }
    return { kind: 'ignored', reason: 'not_financial', bank };
  }

  const amount = extractAmount(body);
  if (!amount) return { kind: 'ignored', reason: 'not_financial', bank };
  // A money movement we can't tie to any bank, card or account is noise
  // (a friend's message that mentions rupees, a shop's marketing text).
  if (!hint && !bank) return { kind: 'ignored', reason: 'not_financial', bank };

  let direction: SmsDirection =
    debitAt < 0 ? 'credit' : creditAt < 0 ? 'debit' : debitAt <= creditAt ? 'debit' : 'credit';

  const isRefund = /\b(refund(?:ed)?|reversed|reversal|credited back|cashback)\b/i.test(text);
  if (isRefund) direction = 'credit';

  const instrument = hint?.instrument ?? null;
  const isCardInstrument = instrument === 'credit_card' || instrument === 'card';
  const isCardPaymentReceived =
    direction === 'credit' &&
    !isRefund &&
    isCardInstrument &&
    /\bpayment\b/i.test(text) &&
    /\b(received|credited|thank you|towards)\b/i.test(text);

  const { merchant, counterparty } = extractMerchant(lined, direction);
  const isCardBillPayment =
    direction === 'debit' &&
    instrument !== 'credit_card' &&
    (/\bcred\b|cred\.club|dreamplug/i.test(text) ||
      (counterparty !== null && /(cred|ccpay|ccbill|card|billdesk|bbps)/i.test(counterparty)) ||
      /\b(credit ?card (?:bill|payment|dues)|cc (?:bill|payment)|card ?bill|towards (?:your )?(?:\w+ )?(?:bank )?credit card)\b/i.test(
        text,
      ));

  const isCashWithdrawal = direction === 'debit' && /\batm\b|withdrawn|cash withdrawal/i.test(text);
  const isSalary = direction === 'credit' && /\b(salary|sal\b|payroll|wages)\b/i.test(text);
  const isInterest = direction === 'credit' && /\b(interest|int\.?\s*pd|int\.?\s*cr)\b/i.test(text);

  let occurredOn = extractDate(body);
  if (occurredOn && input.receivedAt) {
    const received = new Date(input.receivedAt);
    const parsed = new Date(`${occurredOn}T12:00:00Z`);
    const diffDays = (received.getTime() - parsed.getTime()) / 86_400_000;
    // A date in the future, or months back, is a misread (or a date-like ref).
    if (diffDays < -1.5 || diffDays > 62) occurredOn = null;
  }

  return {
    kind: 'transaction',
    direction,
    amount,
    instrument,
    last4: hint?.last4 ?? null,
    bank,
    channel: detectChannel(text, instrument),
    merchant: isCashWithdrawal && !merchant ? 'ATM withdrawal' : merchant,
    counterparty,
    counterpartyLast4: extractCounterpartyAccount(text, direction),
    reference: extractReference(text),
    occurredOn,
    balance: balance?.amount ?? null,
    balanceKind: balance?.kind ?? null,
    isCardPaymentReceived,
    isCardBillPayment,
    isRefund,
    isSalary,
    isInterest,
    isCashWithdrawal,
  };
}

/** A one-line, human summary — what the Shortcut shows as a notification. */
export function describeParsed(p: ParsedSms): string {
  if (p.kind === 'ignored') return `Ignored (${p.reason.replace(/_/g, ' ')})`;
  if (p.kind === 'balance') return `Balance update: ₹${p.balance}`;
  const verb = p.isCardPaymentReceived ? 'Card payment' : p.direction === 'debit' ? 'Spent' : 'Received';
  const who = p.merchant ? (p.direction === 'debit' ? ` at ${p.merchant}` : ` from ${p.merchant}`) : '';
  return `${verb} ₹${p.amount}${who}`;
}
