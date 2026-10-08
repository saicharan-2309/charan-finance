/**
 * Bank alert emails: only a bank's own domain is accepted, the email is cut
 * down to the alert, and the SMS parser reads it like a text.
 */
import { bankEmailSender, emailDomain, emailToAlert } from '@/lib/bank-email';
import { parseBankSms } from '@/lib/bank-sms';

const read = (from: string, subject: string, body: string) => {
  const sender = bankEmailSender(from);
  return {
    sender,
    parsed: parseBankSms({ body: emailToAlert(subject, body), sender, receivedAt: '2026-10-08T11:39:11Z' }),
  };
};

describe('who sent it', () => {
  it('accepts banks, including the new .bank.in domains', () => {
    expect(emailDomain('Axis Bank Alerts <alerts@axisbank.com>')).toBe('axisbank.com');
    expect(bankEmailSender('Axis Bank Alerts <alerts@axisbank.com>')).toBe('EM-AXISBK');
    expect(bankEmailSender('alerts@hdfcbank.net')).toBe('EM-HDFCBK');
    expect(bankEmailSender('"ICICI Bank" <credit_cards@icicibank.com>')).toBe('EM-ICICIB');
    expect(bankEmailSender('noreply@axis.bank.in')).toBe('EM-AXISBK');
    expect(bankEmailSender('alerts@newbank.bank.in')).toBe('EM-BANKEM');
  });
  it('refuses anything else — look-alike domains included', () => {
    expect(bankEmailSender('deals@blinkit.com')).toBeNull();
    expect(bankEmailSender('alerts@axisbank.com.evil.io')).toBeNull();
    expect(bankEmailSender('friend@gmail.com')).toBeNull();
    expect(bankEmailSender(null)).toBeNull();
  });
});

describe('reading the alert', () => {
  it('Axis card summary email (no "spent" in it)', () => {
    const { parsed } = read(
      'Axis Bank Alerts <alerts@axisbank.com>',
      'Transaction alert on Axis Bank Credit Card no. XX1205',
      [
        'Dear Customer,',
        "Here's the summary of your Axis Bank Credit Card Transaction:",
        'Transaction Amount: INR 2285',
        'Merchant Name: BLINKIT',
        'Axis Bank Credit Card No. XX1205',
        'Date & Time: 08-10-2026, 17:09:11 IST',
        'Available Limit*: INR 396186',
        'If this transaction was not initiated by you, please call us at 1860 419 5555.',
        'Get up to 10% cashback on your next order — apply now!',
        'Warm regards,',
        'Axis Bank Ltd.',
        'Disclaimer: This is a system generated email.',
      ].join('\n'),
    );
    expect(parsed).toMatchObject({
      kind: 'transaction',
      direction: 'debit',
      amount: '2285.00',
      bank: 'axis',
      last4: '1205',
      merchant: 'Blinkit',
    });
  });

  it('HDFC "thank you for using your card" email, in HTML', () => {
    const { parsed } = read(
      'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
      'Alert : Update on your HDFC Bank Credit Card',
      '<html><body><p>Dear Card Member,</p><p>Thank you for using your HDFC Bank Credit Card ending 1205 for Rs 2285.00 at BLINKIT on 08-10-2026 17:09:11.</p><p>Authorization code:- 123456</p><p>Never share your OTP with anyone.</p><p>This is an auto generated email, please do not reply.</p></body></html>',
    );
    expect(parsed).toMatchObject({
      kind: 'transaction',
      direction: 'debit',
      amount: '2285.00',
      bank: 'hdfc',
      last4: '1205',
      merchant: 'Blinkit',
    });
  });

  it('ICICI "used for a transaction of" email', () => {
    const { parsed } = read(
      'ICICI Bank <credit_cards@icicibank.com>',
      'Transaction alert for your ICICI Bank Credit Card',
      'Dear Customer,\nYour ICICI Bank Credit Card XX1205 has been used for a transaction of INR 2,285.00 on Oct 08, 2026 at 05:09:11. Info: BLINKIT.\nThe Available Credit Limit on your card is INR 3,96,186.00.',
    );
    expect(parsed).toMatchObject({
      kind: 'transaction',
      direction: 'debit',
      amount: '2285.00',
      last4: '1205',
    });
  });

  it('an account credit email reads as money in', () => {
    const { parsed } = read(
      'alerts@hdfcbank.net',
      'You have received a credit',
      'Dear Customer, Rs.50000.00 has been credited to your account **6202 on 08-10-26 by NEFT from ACME TECHNOLOGIES PVT LTD.',
    );
    expect(parsed).toMatchObject({
      kind: 'transaction',
      direction: 'credit',
      amount: '50000.00',
      last4: '6202',
    });
  });

  it('a bank’s marketing email is not a transaction', () => {
    const { parsed } = read(
      'offers@axisbank.com',
      'Exclusive: get up to ₹5,000 cashback',
      'You are eligible for a pre-approved loan of up to Rs 5,00,000. Apply now!',
    );
    expect(parsed.kind).toBe('ignored');
  });

  it('keeps the stored text short, without the footer', () => {
    const alert = emailToAlert('Subject', `Line one\nLine two\nDisclaimer: ${'x'.repeat(5000)}`);
    expect(alert).toBe('Subject\nLine one\nLine two');
  });
});
