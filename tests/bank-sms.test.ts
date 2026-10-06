import {
  cleanMerchant,
  describeParsed,
  detectBank,
  extractDate,
  isBankSender,
  normaliseAmount,
  parseBankSms,
  type ParsedTransaction,
} from '../supabase/functions/_shared/bank-sms';

const RECEIVED = '2026-10-03T09:15:00+05:30';

function txn(body: string, sender?: string): ParsedTransaction {
  const p = parseBankSms({ body, sender, receivedAt: RECEIVED });
  if (p.kind !== 'transaction') throw new Error(`Expected a transaction, got ${JSON.stringify(p)}`);
  return p;
}

describe('amounts and dates', () => {
  it('normalises Indian-grouped amounts exactly', () => {
    expect(normaliseAmount('1,23,456.7')).toBe('123456.70');
    expect(normaliseAmount('450')).toBe('450.00');
    expect(normaliseAmount('0.00')).toBeNull();
    expect(normaliseAmount('12.345')).toBeNull();
  });

  it('reads every date format banks print, day first', () => {
    expect(extractDate('on 03-10-26')).toBe('2026-10-03');
    expect(extractDate('on 03/10/2026')).toBe('2026-10-03');
    expect(extractDate('On 2026-10-03:14:22:10')).toBe('2026-10-03');
    expect(extractDate('on 03-Oct-26;')).toBe('2026-10-03');
    expect(extractDate('on date 03Oct26 trf')).toBe('2026-10-03');
    expect(extractDate('on 01-OCT-2026')).toBe('2026-10-01');
    expect(extractDate('on 31-02-26')).toBeNull();
  });
});

describe('banks', () => {
  it('identifies the bank from the sender id first, then the text', () => {
    expect(detectBank('AX-HDFCBK', '')).toBe('hdfc');
    expect(detectBank('JD-SBIUPI-S', '')).toBe('sbi');
    expect(detectBank('VM-ICICIT', '')).toBe('icici');
    expect(detectBank(null, 'Thank you. Axis Bank')).toBe('axis');
    expect(detectBank('+919999999999', 'Your Kotak Bank AC')).toBe('kotak');
  });
});

describe('HDFC', () => {
  it('reads the multi-line UPI debit', () => {
    const p = txn(
      'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 03/10/26\nRef 627612345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
      'AX-HDFCBK',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '450.00',
      instrument: 'account',
      last4: '1234',
      bank: 'hdfc',
      channel: 'upi',
      merchant: 'Swiggy',
      reference: '627612345678',
      occurredOn: '2026-10-03',
    });
  });

  it('reads a credit-card spend and ignores the trailing card number', () => {
    const p = txn(
      'Spent Rs.2,499 On HDFC Bank Card 5678 At AMAZON PAY INDIA On 2026-10-03:14:22:10 Not You? Call 18002586161/SMS BLOCK CC 5678 to 7308080808',
      'VM-HDFCBK',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '2499.00',
      instrument: 'card',
      last4: '5678',
      merchant: 'Amazon',
      channel: 'card',
      occurredOn: '2026-10-03',
    });
  });

  it('reads a salary credit and keeps the balance separate from the amount', () => {
    const p = txn(
      'Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 01-OCT-26 for NEFT Cr-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY OCT.Avl bal INR 1,23,456.78. Cheque deposits in A/C are subject to clearing',
    );
    expect(p).toMatchObject({
      direction: 'credit',
      amount: '85000.00',
      last4: '1234',
      merchant: 'Acme',
      isSalary: true,
      balance: '123456.78',
      balanceKind: 'balance',
      channel: 'neft',
    });
  });

  it('marks a payment to CRED as a credit-card bill payment', () => {
    const p = txn(
      'Rs.20000 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA cred.club@axisb(UPI Ref No 627800001111). Not you? Call 18002586161',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '20000.00',
      merchant: 'CRED',
      counterparty: 'cred.club@axisb',
      isCardBillPayment: true,
      reference: '627800001111',
    });
  });

  it('recognises a payment received on a credit card', () => {
    const p = txn(
      'Payment of Rs. 20,000.00 has been received on your HDFC Bank Credit Card ending 5678 through UPI on 03-10-2026. Thank you',
    );
    expect(p).toMatchObject({
      direction: 'credit',
      instrument: 'credit_card',
      last4: '5678',
      isCardPaymentReceived: true,
      amount: '20000.00',
    });
  });

  it('reads an ATM withdrawal', () => {
    const p = txn(
      'Rs.5000.00 withdrawn from HDFC Bank Card x9012 At +18 MG ROAD ATM On 2026-10-02:19:01:22 Bal Rs.12,345.67',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '5000.00',
      channel: 'atm',
      isCashWithdrawal: true,
      last4: '9012',
      balance: '12345.67',
    });
  });
});

describe('ICICI', () => {
  it('reads a debit where the merchant is the one "credited"', () => {
    const p = txn(
      'ICICI Bank Acct XX234 debited for Rs 1,250.00 on 03-Oct-26; ZOMATO credited. UPI:627712345678. Call 18002662 for dispute. SMS BLOCK 234 to 9215676766.',
      'VM-ICICIT',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '1250.00',
      instrument: 'account',
      last4: '234',
      merchant: 'Zomato',
      reference: '627712345678',
    });
  });

  it('reads a card spend and reads the available limit as a limit', () => {
    const p = txn(
      'INR 3,499.00 spent using ICICI Bank Card XX4321 on 03-Oct-26 on Flipkart. Avl Limit: INR 1,46,501.00. If not you, call 1800 2662/SMS BLOCK 4321 to 9215676766',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '3499.00',
      last4: '4321',
      merchant: 'Flipkart',
      balance: '146501.00',
      balanceKind: 'limit',
    });
  });

  it('reads a UPI credit from a person', () => {
    const p = txn(
      'Dear Customer, Acct XX234 is credited with Rs 500.00 on 02-Oct-26 from RAHUL SHARMA. UPI:627799990000-ICICI Bank.',
    );
    expect(p).toMatchObject({
      direction: 'credit',
      amount: '500.00',
      merchant: 'Rahul Sharma',
      reference: '627799990000',
      occurredOn: '2026-10-02',
    });
  });

  it('reads a card payment received', () => {
    const p = txn(
      'Dear Customer, Payment of INR 15,000.00 has been received towards your ICICI Bank Credit Card XX4321 on 03-Oct-26. Thank you.',
    );
    expect(p.isCardPaymentReceived).toBe(true);
    expect(p.last4).toBe('4321');
    expect(p.instrument).toBe('credit_card');
  });
});

describe('SBI', () => {
  it('reads the SBI UPI debit that has no currency word', () => {
    const p = txn(
      'Dear UPI user A/C X5566 debited by 120.0 on date 03Oct26 trf to CHAI POINT Refno 627711112222. If not u? call 1800111109. -SBI',
      'JD-SBIUPI',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '120.00',
      last4: '5566',
      merchant: 'Chai Point',
      reference: '627711112222',
      bank: 'sbi',
    });
  });

  it('reads an SBI credit glued to the account number', () => {
    const p = txn('Dear SBI UPI User, ur A/cX5566 credited by Rs500 on 02Oct26 by  (Ref no 627700003333)');
    expect(p).toMatchObject({
      direction: 'credit',
      amount: '500.00',
      last4: '5566',
      reference: '627700003333',
    });
  });

  it('reads a transfer and the other account it went to', () => {
    const p = txn(
      'Your a/c no. XXXXXXXX5566 is debited for Rs.2,000.00 on 03-10-2026 and credited to a/c no. XXXXXXXX9876 (UPI Ref no 627755556666)',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '2000.00',
      last4: '5566',
      counterpartyLast4: '9876',
      reference: '627755556666',
    });
  });

  it('reads an SBI card spend', () => {
    const p = txn(
      'Rs.1,999.00 spent on your SBI Credit Card ending 7788 at MYNTRA on 03/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
      'AD-SBICRD',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      instrument: 'credit_card',
      last4: '7788',
      merchant: 'Myntra',
      amount: '1999.00',
    });
  });

  it('reads a card payment with no card digits', () => {
    const p = txn(
      'We have received payment of Rs.10,000.00 via BBPS & the same has been credited to your SBI Credit Card. Your available limit is Rs.85,000.00.',
      'AD-SBICRD',
    );
    expect(p).toMatchObject({
      direction: 'credit',
      amount: '10000.00',
      instrument: 'credit_card',
      last4: null,
      isCardPaymentReceived: true,
      balance: '85000.00',
      balanceKind: 'limit',
    });
  });
});

describe('Axis, Kotak, IDFC', () => {
  it('reads the Axis multi-line UPI debit', () => {
    const p = txn(
      'INR 799.00 debited\nA/c no. XX7890\n03-10-26, 12:15:01\nUPI/P2M/627712340000/NETFLIX\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
      'AX-AXISBK',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '799.00',
      last4: '7890',
      merchant: 'Netflix',
      reference: '627712340000',
    });
  });

  it('reads an Axis UPI credit from a person', () => {
    const p = txn(
      'INR 2,000.00 credited\nA/c no. XX7890\n02-10-26, 10:01:11 IST\nUPI/P2A/627700004444/PRIYA S\nAxis Bank',
    );
    expect(p).toMatchObject({ direction: 'credit', amount: '2000.00', merchant: 'Priya S' });
  });

  it('reads an Axis card spend', () => {
    const p = txn(
      'Spent\nCard no. XX3344\nINR 1,250.00\n03-10-26 20:12:44\nUBER INDIA\nAvl Lmt INR 98,750\nNot you? SMS BLOCK 3344 to 919951860002\nAxis Bank',
    );
    expect(p).toMatchObject({ direction: 'debit', amount: '1250.00', last4: '3344', balance: '98750.00' });
  });

  it('reads Kotak sent and received', () => {
    const sent = txn(
      'Sent Rs.250.00 from Kotak Bank AC X4455 to paytmqr123@paytm on 03-10-26.UPI Ref 627711113333. Not you, https://kotak.com/KBANKT/Fraud',
    );
    expect(sent).toMatchObject({ direction: 'debit', amount: '250.00', last4: '4455', merchant: null });
    expect(sent.counterparty).toBe('paytmqr123@paytm');

    const got = txn(
      'Received Rs.1000.00 in your Kotak Bank AC X4455 from rahul@okicici on 02-10-26.UPI Ref:627700005555.',
    );
    expect(got).toMatchObject({
      direction: 'credit',
      amount: '1000.00',
      merchant: 'Rahul',
      reference: '627700005555',
    });
  });

  it('reads an IDFC debit with a new balance', () => {
    const p = txn(
      'Your A/C XXXXXXX6677 is debited by INR 300.00 on 03/10/2026 10:15. New Bal :INR 9,700.00. Not you? Call 18001080888',
      'VK-IDFCFB',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '300.00',
      last4: '6677',
      balance: '9700.00',
      bank: 'idfc',
    });
  });
});

describe('more formats', () => {
  it('records a mandate debit that has actually happened', () => {
    const p = txn(
      'Your A/c XX1234 has been debited with INR 1,500.00 on 03-Oct-2026 towards e-mandate for LIC. Avl Bal INR 10,000.00 -ICICI Bank',
    );
    expect(p).toMatchObject({
      direction: 'debit',
      amount: '1500.00',
      channel: 'autopay',
      balance: '10000.00',
    });
  });

  it('reads "towards MERCHANT" and Amex long card numbers', () => {
    expect(
      txn(
        'Dear Customer, Rs.649.00 has been debited from your account XX1234 towards NETFLIX (Auto Pay). -ICICI Bank',
      ),
    ).toMatchObject({ merchant: 'Netflix', amount: '649.00' });
    expect(
      txn(
        "Alert: You've spent INR 2,345.00 on your AMEX card ** 41001 at UBER on 3 October 2026 at 08:00 PM IST.",
      ),
    ).toMatchObject({ last4: '1001', merchant: 'Uber', occurredOn: '2026-10-03', amount: '2345.00' });
  });

  it('reads PNB and Federal formats', () => {
    expect(
      txn(
        'Ac XXXXXXXX0123 Debited with Rs.500.00 ,03-10-2026 10:12:11 thru UPI:627799998888. Bal Rs.1000.00 CR. Helpline 18001800-PNB',
      ),
    ).toMatchObject({
      direction: 'debit',
      amount: '500.00',
      last4: '0123',
      reference: '627799998888',
      balance: '1000.00',
    });
    expect(
      txn(
        'Rs 100.00 debited from your A/c XXXX4545 to VPA zomato@hdfcbank on 03-10-2026 10:00:00. UPI Ref:627712121212 -Federal Bank',
      ),
    ).toMatchObject({ merchant: 'Zomato', bank: 'federal', last4: '4545' });
  });
});

describe('refunds, interest and other credits', () => {
  it('reads a refund on a card as a credit', () => {
    const p = txn(
      'Refund of Rs 499.00 from AMAZON has been credited to your HDFC Bank Card 5678 on 02-10-26',
    );
    expect(p).toMatchObject({
      direction: 'credit',
      isRefund: true,
      isCardPaymentReceived: false,
      merchant: 'Amazon',
    });
  });

  it('reads a failed-UPI reversal as a refund, not a declined txn', () => {
    const p = txn(
      'Rs 450.00 reversed to your A/c XX1234 for failed UPI txn Ref 627612345678 on 03-10-26. -HDFC Bank',
    );
    expect(p).toMatchObject({ direction: 'credit', isRefund: true, reference: '627612345678' });
  });

  it('flags interest', () => {
    const p = txn('Interest of Rs 1,234.00 credited to your A/c XX1234 on 30-09-26. -HDFC Bank');
    expect(p.isInterest).toBe(true);
  });
});

describe('messages that must never become transactions', () => {
  const ignored = (body: string) => parseBankSms({ body, receivedAt: RECEIVED });

  it('ignores OTPs even when they mention an amount and a card', () => {
    expect(
      ignored(
        '123456 is your OTP for transaction of Rs 2,499 at AMAZON on HDFC Bank card 5678. Valid for 5 mins. Do not share',
      ),
    ).toMatchObject({ kind: 'ignored', reason: 'otp' });
  });

  it('ignores declined transactions', () => {
    expect(
      ignored('Transaction of Rs.5000 on HDFC Bank card XX5678 has been declined due to insufficient funds'),
    ).toMatchObject({ kind: 'ignored', reason: 'declined' });
  });

  it('ignores future debits and mandate notices', () => {
    expect(
      ignored(
        'Your e-mandate for NETFLIX of Rs.649.00 will be debited on 05-10-2026 from A/c XX1234. -HDFC Bank',
      ),
    ).toMatchObject({ kind: 'ignored', reason: 'notice' });
    expect(ignored('Rahul has requested money of Rs 500 from you on Google Pay. UPI')).toMatchObject({
      kind: 'ignored',
    });
  });

  it('ignores statements', () => {
    expect(
      ignored(
        'Statement for HDFC Bank Credit Card 5678: Total due Rs.12,345.00, Min due Rs.620.00, due by 15-10-2026.',
      ),
    ).toMatchObject({ kind: 'ignored', reason: 'statement' });
  });

  it('ignores promotions', () => {
    expect(
      ignored(
        'Congratulations! You are pre-approved for a Personal Loan of up to Rs.5,00,000. Apply now: hdfc.bank/pl',
      ),
    ).toMatchObject({ kind: 'ignored', reason: 'promotional' });
  });

  it('ignores ordinary chat that mentions money', () => {
    expect(ignored('I sent you Rs 500 for dinner, check pls')).toMatchObject({
      kind: 'ignored',
      reason: 'not_financial',
    });
  });

  it('never reads a text from a phone number or email as a bank alert', () => {
    const fake = 'Rs.5,000.00 credited to HDFC Bank A/c **1234 on 03-10-26. Avl bal Rs 95,000';
    for (const sender of ['+919876543210', '98765 43210', 'someone@icloud.com']) {
      expect(parseBankSms({ body: fake, sender, receivedAt: RECEIVED })).toMatchObject({
        kind: 'ignored',
        reason: 'not_bank_sender',
      });
    }
    expect(isBankSender('AX-HDFCBK')).toBe(true);
    expect(isBankSender('JM-SBIUPI-S')).toBe(true);
    expect(isBankSender('56161')).toBe(true);
    expect(isBankSender(null)).toBe(true);
  });

  it('turns a balance-only message into a balance update', () => {
    expect(ignored('Avl bal in A/c XX1234 is Rs 12,000.50 as on 03-10-26. -HDFC Bank')).toMatchObject({
      kind: 'balance',
      last4: '1234',
      balance: '12000.50',
    });
  });

  it('drops a printed date that is in the future or far in the past', () => {
    const p = txn('Rs.100 debited from A/c XX1234 on 03-10-25 to VPA abc@ybl. -HDFC Bank');
    expect(p.occurredOn).toBeNull();
  });
});

describe('merchant names', () => {
  it('maps legal names, gateways and VPAs to recognisable names', () => {
    expect(cleanMerchant('BUNDL TECHNOLOGIES PVT LTD')).toBe('Swiggy');
    expect(cleanMerchant('RAZ*ZOMATO')).toBe('Zomato');
    expect(cleanMerchant('swiggy.stores@icici')).toBe('Swiggy');
    expect(cleanMerchant('LOCAL KIRANA STORE')).toBe('Local Kirana Store');
    expect(cleanMerchant('paytmqr281005050101@paytm')).toBeNull();
    expect(cleanMerchant('Mr. ANAND KUMAR')).toBe('Anand Kumar');
  });

  it('describes a result in one line for the phone notification', () => {
    expect(
      describeParsed(
        txn('Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 03/10/26\nRef 627612345678'),
      ),
    ).toBe('Spent ₹450.00 at Swiggy');
  });
});
