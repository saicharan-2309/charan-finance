/**
 * Bank alert emails → the same shape as a bank SMS, so one parser reads both.
 *
 * Banks email every card spend and account debit/credit as well as texting
 * it. A Google Apps Script in the user's own Gmail forwards those emails to
 * `ingest-sms` (channel "email"); this file
 *   * accepts only mail from a bank's own domain (anything else is ignored —
 *     a random email can never create a transaction),
 *   * gives it the bank's SMS-style sender id ("EM-AXISBK"), and
 *   * boils the email down to the alert itself: subject + the first lines of
 *     the body, without HTML, disclaimers or offers.
 * Plain TypeScript with no imports beyond the SMS parser, shared by the Edge
 * Function (Deno) and the app's tests (Jest).
 */

/** Bank email domains → the code their SMS sender ids use. */
const BANK_DOMAINS: [RegExp, string][] = [
  [/(?:^|\.)(?:axisbank\.com|axis\.bank\.in)$/, 'AXISBK'],
  [/(?:^|\.)(?:hdfcbank\.net|hdfcbank\.com|hdfc\.bank\.in|hdfcbank\.bank\.in)$/, 'HDFCBK'],
  [/(?:^|\.)(?:icicibank\.com|icici\.bank\.in)$/, 'ICICIB'],
  [/(?:^|\.)(?:sbi\.co\.in|sbicard\.com|sbi\.bank\.in)$/, 'SBICRD'],
  [/(?:^|\.)(?:kotak\.com|kotak\.bank\.in|kotakbank\.com)$/, 'KOTAKB'],
  [/(?:^|\.)(?:idfcfirstbank\.com|idfcfirst\.bank\.in)$/, 'IDFCFB'],
  [/(?:^|\.)(?:yesbank\.in|yes\.bank\.in)$/, 'YESBNK'],
  [/(?:^|\.)(?:indusind\.com|indusind\.bank\.in)$/, 'INDUSB'],
  [/(?:^|\.)(?:aubank\.in|au\.bank\.in)$/, 'AUBANK'],
  [/(?:^|\.)(?:federalbank\.co\.in|federal\.bank\.in)$/, 'FEDBNK'],
  [/(?:^|\.)(?:pnb\.co\.in|pnb\.bank\.in)$/, 'PNBSMS'],
  [
    /(?:^|\.)(?:bankofbaroda\.com|bankofbaroda\.co\.in|bobcard\.co\.in|bobfinancial\.com|bob\.bank\.in)$/,
    'BOBTXN',
  ],
  [/(?:^|\.)(?:canarabank\.com|canarabank\.in|canara\.bank\.in)$/, 'CANBNK'],
  [/(?:^|\.)(?:unionbankofindia\.co\.in|unionbank\.bank\.in)$/, 'UNIONB'],
  [/(?:^|\.)(?:idbibank\.co\.in|idbi\.bank\.in)$/, 'IDBIBK'],
  [/(?:^|\.)(?:rblbank\.com|rbl\.bank\.in)$/, 'RBLBNK'],
  [/(?:^|\.)(?:sc\.com|standardchartered\.com)$/, 'SCBANK'],
  [/(?:^|\.)(?:hsbc\.co\.in|hsbc\.bank\.in)$/, 'HSBCIN'],
  [/(?:^|\.)(?:americanexpress\.com|aexp\.com)$/, 'AMEXIN'],
  [/(?:^|\.)(?:getonecard\.app|onecard\.app)$/, 'ONECRD'],
  [/(?:^|\.)(?:bankofindia\.co\.in|boi\.bank\.in)$/, 'BOIIND'],
  // Any other bank on India's reserved bank domain.
  [/\.bank\.in$/, 'BANKEM'],
];

/** The Gmail search the setup script uses — every domain above. */
export const GMAIL_BANK_QUERY =
  'from:(axisbank.com OR hdfcbank.net OR hdfcbank.com OR icicibank.com OR sbi.co.in OR sbicard.com OR kotak.com OR ' +
  'idfcfirstbank.com OR yesbank.in OR indusind.com OR aubank.in OR federalbank.co.in OR pnb.co.in OR ' +
  'bankofbaroda.com OR bobcard.co.in OR bobfinancial.com OR canarabank.com OR unionbankofindia.co.in OR ' +
  'idbibank.co.in OR rblbank.com OR sc.com OR hsbc.co.in OR americanexpress.com OR aexp.com OR ' +
  'getonecard.app OR bankofindia.co.in OR bank.in)';

/** "Axis Bank Alerts <alerts@axisbank.com>" → "axisbank.com". */
export function emailDomain(from: string | null | undefined): string | null {
  const m =
    (from ?? '').match(/@([a-z0-9.-]+\.[a-z]{2,})\s*>?\s*$/i) ??
    (from ?? '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** The SMS-style sender id for a bank's email ("EM-AXISBK"), or null if it isn't a bank. */
export function bankEmailSender(from: string | null | undefined): string | null {
  const domain = emailDomain(from);
  if (!domain) return null;
  for (const [re, code] of BANK_DOMAINS) if (re.test(domain)) return `EM-${code}`;
  return null;
}

const CUT =
  /\b(disclaimer|this is a (?:system|computer|auto(?:matically)?)[- ]generated|this is an auto|do not reply|please do not reply|kindly do not reply|confidential|unsubscribe|privacy policy|terms and conditions|t&c|copyright|©)\b/i;
const NOISE =
  /\b(pre-?approved|apply now|get up to|eligible for|offer|congratulations|reward points|limit (?:upgrade|enhancement|increase)|loan of up to|click here|download (?:the|our)|exclusive|avail|visit (?:us|www)|call us|customer care|helpline|toll[- ]free|follow us|never share|do not share|fraud|phishing|beware|stay safe|warm regards|regards|sincerely|team)\b/i;

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

/**
 * The alert inside an email: subject first, then the body's lines until the
 * footer starts, without greetings, offers or safety boilerplate. Capped well
 * under the 2,000-character limit for a stored message.
 */
export function emailToAlert(subject: string | null | undefined, body: string | null | undefined): string {
  let text = body ?? '';
  if (/<[a-z][\s\S]*>/i.test(text)) text = htmlToText(text);
  const lines: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/[ \t ]+/g, ' ').trim();
    if (!line) continue;
    if (CUT.test(line)) break;
    if (NOISE.test(line)) continue;
    if (/^(dear|hi|hello)\b/i.test(line) && line.length < 60) continue;
    lines.push(line);
    if (lines.join('\n').length > 1200) break;
  }
  const head = (subject ?? '').replace(/\s+/g, ' ').trim();
  return [head, ...lines].filter(Boolean).join('\n').slice(0, 1500);
}
