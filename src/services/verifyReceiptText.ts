export type LocalReceiptProvider =
  | 'TELEBIRR'
  | 'DASHEN'
  | 'ABYSSINIA'
  | 'CBE_BIRR'
  | 'MPESA'
  | 'AWASH'
  | 'COOP'
  | 'HIBRET'
  | 'ZEMEN'
  | 'NIB'
  | 'WEGAGEN'
  | 'AMHARA'
  | 'GENERIC_BANK';

export interface LocalReceiptTextResult {
  success: boolean;
  provider: LocalReceiptProvider;
  verificationMode: 'LOCAL_TEXT';
  receiptTextVerified: boolean;
  reference: string;
  payer?: string;
  payerName?: string;
  payerAccount?: string;
  receiver?: string;
  receiverName?: string;
  receiverAccount?: string;
  senderName?: string;
  senderAccountNumber?: string;
  transactionReference?: string;
  transactionId?: string;
  receiptNo?: string;
  receiptNumber?: string;
  transactionStatus?: string;
  transactionDate?: Date;
  paymentDate?: Date;
  date?: Date;
  amount?: number;
  transactionAmount?: number;
  transferredAmount?: number;
  reason?: string;
  narrative?: string;
  phoneNumber?: string;
  error?: string;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

function parseAmount(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.replace(/\s+/g, ' ').trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function titleCase(value?: string): string | undefined {
  return value?.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function baseResult(provider: LocalReceiptProvider, reference: string): LocalReceiptTextResult {
  return {
    success: true,
    provider,
    verificationMode: 'LOCAL_TEXT',
    receiptTextVerified: true,
    reference: reference.trim(),
  };
}

function failed(provider: LocalReceiptProvider, reference: string, error: string): LocalReceiptTextResult {
  return {
    success: false,
    provider,
    verificationMode: 'LOCAL_TEXT',
    receiptTextVerified: false,
    reference: reference.trim(),
    error,
  };
}

export function verifyProviderReceiptText(
  provider: LocalReceiptProvider,
  reference: string,
  receiptText: string,
): LocalReceiptTextResult {
  const normalizedReference = reference.trim();
  const rawText = receiptText.replace(/\r/g, '').trim();
  const text = rawText.replace(/\s+/g, ' ');

  if (!normalizedReference || !rawText) {
    return failed(provider, normalizedReference, 'Reference and receipt text are required.');
  }

  if (!text.toLowerCase().includes(normalizedReference.toLowerCase())) {
    return failed(provider, normalizedReference, 'Receipt text reference does not match the supplied reference.');
  }

  // ── TELEBIRR ─────────────────────────────────────────────────────────────
  if (provider === 'TELEBIRR') {
    const payerName = firstMatch(text, [
      /(?:payer|sender)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:transaction\s+status|status|amount|payment\s+date|date)\b)/i,
      /customer\s+name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,})/i,
    ]);
    const transactionStatus = firstMatch(text, [
      /(?:transaction\s+status|status)\s*[:\-]\s*(completed|successful|success|paid|failed|pending)/i,
    ]);
    const amount = parseAmount(firstMatch(text, [
      /(?:settled\s+amount|total\s+paid|paid\s+amount|amount)\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const paymentDate = parseDate(firstMatch(text, [
      /(?:payment\s+date(?:\s*&\s*time)?|transaction\s+date|date)\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
    ]));
    if (!payerName || !transactionStatus || amount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract payer name, transaction status, and amount from Telebirr receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      payerName: titleCase(payerName),
      payer: titleCase(payerName),
      transactionStatus,
      amount,
      paymentDate,
      date: paymentDate,
      receiptNo: normalizedReference,
    };
  }

  // ── DASHEN BANK ──────────────────────────────────────────────────────────
  if (provider === 'DASHEN') {
    const transactionReference = firstMatch(text, [
      /transaction\s+reference\s*[:\-]\s*([A-Z0-9-]+)/i,
      /transfer\s+reference\s*[:\-]\s*([A-Z0-9-]+)/i,
      /reference\s*[:\-]\s*([A-Z0-9-]+)/i,
    ]);
    const transactionAmount = parseAmount(firstMatch(text, [
      /transaction\s+amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
      /amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const senderName = firstMatch(text, [/sender\s*(?:name)?\s*[:\-]\s*(.*?)(?=\s+receiver\s*(?:name)?\s*[:\-])/i]);
    const receiverName = firstMatch(text, [/receiver\s*(?:name)?\s*[:\-]\s*(.*?)(?=\s+(?:transaction\s+amount|transaction\s+date|amount|date)\b)/i]);
    const transactionDate = parseDate(firstMatch(text, [
      /transaction\s+date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
      /date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
    ]));
    if (!transactionReference || transactionAmount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract transaction reference and amount from Dashen receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      transactionReference,
      transactionAmount,
      amount: transactionAmount,
      senderName: titleCase(senderName),
      payer: titleCase(senderName),
      receiverName: titleCase(receiverName),
      receiver: titleCase(receiverName),
      transactionDate,
      date: transactionDate,
      narrative: firstMatch(text, [/narrative\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|transaction))/i]),
    };
  }

  // ── BANK OF ABYSSINIA ───────────────────────────────────────────────────
  if (provider === 'ABYSSINIA') {
    const transactionReference = firstMatch(text, [
      /transaction\s+reference\s*[:\-]\s*([A-Z0-9-]+)/i,
      /reference\s*[:\-]\s*([A-Z0-9-]+)/i,
    ]);
    const transferredAmount = parseAmount(firstMatch(text, [
      /transferred\s+amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
      /amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const payer = firstMatch(text, [/payer(?:'s)?\s+name\s*[:\-]\s*(.*?)(?=\s+(?:transferred\s+amount|transaction\s+date|date|narrative)\b)/i, /sender\s+name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,})/i]);
    const transactionDate = parseDate(firstMatch(text, [
      /transaction\s+date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
      /date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
    ]));
    if (!transactionReference || transferredAmount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract transaction reference and transferred amount from Abyssinia receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      transactionReference,
      transferredAmount,
      amount: transferredAmount,
      payer: titleCase(payer),
      transactionDate,
      date: transactionDate,
      narrative: firstMatch(text, [/narrative\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|reference))/i]),
    };
  }

  // ── CBE BIRR ─────────────────────────────────────────────────────────────
  if (provider === 'CBE_BIRR') {
    const receiptNumber = firstMatch(text, [
      /receipt\s+number\s*[:\-]\s*([A-Z0-9-]+)/i,
      /receipt\s+no\.?\s*[:\-]\s*([A-Z0-9-]+)/i,
    ]) || normalizedReference;
    const amount = parseAmount(firstMatch(text, [
      /paid\s+amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
      /transaction\s+amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
      /amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const customerName = firstMatch(text, [/customer\s+name\s*[:\-]\s*(.*?)(?=\s+(?:paid\s+amount|transaction\s+date|date|transaction\s+status|status)\b)/i, /payer\s+name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,})/i]);
    const transactionDate = parseDate(firstMatch(text, [/transaction\s+date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i, /date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i]));
    if (!amount && !customerName) {
      return failed(provider, normalizedReference, 'Could not extract amount or customer name from CBE Birr receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      receiptNumber,
      reference: normalizedReference,
      payer: titleCase(customerName),
      payerName: titleCase(customerName),
      amount,
      transactionDate,
      date: transactionDate,
      transactionStatus: firstMatch(text, [/transaction\s+status\s*[:\-]\s*([A-Za-z]+)/i, /status\s*[:\-]\s*([A-Za-z]+)/i]),
    };
  }

  // ── SAFARICOM M-PESA ─────────────────────────────────────────────────────
  if (provider === 'MPESA') {
    const transactionId = firstMatch(text, [
      /transaction\s+id\s*[:\-]\s*([A-Z0-9-]+)/i,
      /receipt\s+(?:no|number)\s*[:\-]\s*([A-Z0-9-]+)/i,
    ]) || normalizedReference;
    const payerName = firstMatch(text, [/payer\s+name\s*[:\-]\s*(.*?)(?=\s+receiver\s+name\s*[:\-])/i, /sender\s+name\s*[:\-]\s*(.*?)(?=\s+receiver\s+name\s*[:\-])/i]);
    const receiverName = firstMatch(text, [/receiver\s+name\s*[:\-]\s*(.*?)(?=\s+(?:total|amount|date)\b)/i, /credited\s+party\s*[:\-]\s*(.*?)(?=\s+(?:total|amount|date)\b)/i]);
    const amount = parseAmount(firstMatch(text, [/total\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i, /amount\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i]));
    const paymentDate = parseDate(firstMatch(text, [/payment\s+date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i, /date\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i]));
    if (!payerName || !receiverName || amount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract payer, receiver, and amount from M-Pesa receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      transactionId,
      receiptNo: normalizedReference,
      payerName: titleCase(payerName),
      payer: titleCase(payerName),
      receiverName: titleCase(receiverName),
      receiver: titleCase(receiverName),
      amount,
      paymentDate,
      date: paymentDate,
    };
  }

  // ── AWASH BANK / AWASHBIRR ───────────────────────────────────────────────
  if (provider === 'AWASH') {
    const amount = parseAmount(firstMatch(text, [
      /(?:transferred\s+amount|amount|total\s+amount)\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const payer = firstMatch(text, [
      /(?:sender|payer|from)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:receiver|to|beneficiary|amount|date)\b)/i,
      /customer\s+name\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{2,})/i,
    ]);
    const receiver = firstMatch(text, [
      /(?:receiver|beneficiary|to)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|reason|narrative)\b)/i,
    ]);
    const date = parseDate(firstMatch(text, [
      /(?:transaction\s+date|payment\s+date|date)\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
    ]));
    if (amount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract transaction amount from Awash Bank receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      amount,
      payer: titleCase(payer),
      payerName: titleCase(payer),
      receiver: titleCase(receiver),
      receiverName: titleCase(receiver),
      date,
      transactionDate: date,
      narrative: firstMatch(text, [/(?:reason|narrative|description)\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|$))/i]),
    };
  }

  // ── COOPERATIVE BANK OF OROMIA (COOP / COOPAY-EBIRR) ────────────────────
  if (provider === 'COOP') {
    const amount = parseAmount(firstMatch(text, [
      /(?:transferred\s+amount|paid\s+amount|amount)\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]));
    const payer = firstMatch(text, [
      /(?:sender|payer|customer)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:receiver|beneficiary|amount|date)\b)/i,
    ]);
    const receiver = firstMatch(text, [
      /(?:receiver|beneficiary|credited\s+party)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:amount|date)\b)/i,
    ]);
    const date = parseDate(firstMatch(text, [
      /(?:date|transaction\s+date)\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
    ]));
    if (amount === undefined) {
      return failed(provider, normalizedReference, 'Could not extract amount from Cooperative Bank of Oromia receipt text.');
    }
    return {
      ...baseResult(provider, normalizedReference),
      amount,
      payer: titleCase(payer),
      payerName: titleCase(payer),
      receiver: titleCase(receiver),
      receiverName: titleCase(receiver),
      date,
      transactionDate: date,
    };
  }

  // ── HIBRET BANK, ZEMEN, NIB, WEGAGEN, AMHARA & GENERIC BANK ─────────────
  const genericAmount = parseAmount(firstMatch(text, [
    /(?:transferred\s+amount|transaction\s+amount|paid\s+amount|total\s+amount|amount)\s*[:\-]\s*([\d,]+(?:\.\d{1,2})?)/i,
  ]));
  const genericPayer = firstMatch(text, [
    /(?:payer|sender|from|customer)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:receiver|beneficiary|to|amount|date)\b)/i,
  ]);
  const genericReceiver = firstMatch(text, [
    /(?:receiver|beneficiary|to|credited\s+party)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|reason|narrative)\b)/i,
  ]);
  const genericDate = parseDate(firstMatch(text, [
    /(?:transaction\s+date|payment\s+date|date\s*&\s*time|date)\s*[:\-]\s*([\d/\-:, ]+(?:AM|PM)?)/i,
  ]));

  if (genericAmount === undefined) {
    return failed(provider, normalizedReference, `Could not extract amount from ${provider} receipt text.`);
  }

  return {
    ...baseResult(provider, normalizedReference),
    amount: genericAmount,
    payer: titleCase(genericPayer),
    payerName: titleCase(genericPayer),
    receiver: titleCase(genericReceiver),
    receiverName: titleCase(genericReceiver),
    date: genericDate,
    transactionDate: genericDate,
    narrative: firstMatch(text, [/(?:narrative|reason|description|payment\s+details)\s*[:\-]\s*(.*?)(?=\s+(?:amount|date|$))/i]),
  };
}
