import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { runSmartVerify, SmartVerifyResult } from '../services/verifyUniversal';
import logger from '../utils/logger';
import { db } from '../db';
import { verifiedTransactions } from '../db/schema';
import { dispatchPaymentWebhook } from '../queues/webhookQueue';

const router = Router();

interface UniversalVerifyBody {
  reference?: string;
  suffix?: string;
  phoneNumber?: string;
  receiptText?: string;
  fullText?: string;
  input?: string;
}

function extractNormalizedPaymentInfo(resultData: any, defaultProvider: string, inputRef: string, mode?: string) {
  const d = resultData?.data || resultData || {};
  
  const provider = (d.provider || defaultProvider || 'UNKNOWN').toUpperCase();
  const reference = d.reference || d.receiptNo || d.transactionNo || d.invoiceNo || d.id || inputRef;
  
  // Extract amount
  let amount: number = 0;
  if (d.amount != null && !isNaN(Number(d.amount))) {
    amount = Number(d.amount);
  } else if (d.settledAmount != null) {
    const parsed = parseFloat(String(d.settledAmount).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) amount = parsed;
  } else if (d.totalPaidAmount != null) {
    const parsed = parseFloat(String(d.totalPaidAmount).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) amount = parsed;
  }

  // Extract payer
  const payer = d.payerName || d.payer || d.customerName || d.debitedPartyName || d.debitAccountHolder || d.sender || 'Customer';

  // Extract receiver
  const receiver = d.receiverName || d.receiver || d.creditedPartyName || d.creditAccountHolder || d.creditedPartyAccountNo || d.receiverAccount || 'Merchant';

  const verificationMode = mode || d.verificationMode || (d.receiptTextVerified ? 'TEXT_PARSER' : 'LIVE_BANK');

  return {
    provider,
    reference,
    amount: amount.toFixed(2),
    currency: 'ETB',
    payer: payer ? String(payer).slice(0, 255) : 'Customer',
    payerAccount: d.payerTelebirrNo || d.payerAccount || d.debitAccountNo || null,
    receiver: receiver ? String(receiver).slice(0, 255) : 'Merchant',
    receiverAccount: d.creditedPartyAccountNo || d.receiverAccount || d.creditAccountNo || null,
    status: 'COMPLETED',
    verificationMode,
    timestamp: d.paymentDate || d.date || new Date().toISOString(),
    raw: d,
  };
}

router.post('/', async (req: Request<{}, {}, UniversalVerifyBody>, res: Response): Promise<void> => {
  const { reference, suffix, phoneNumber, receiptText, fullText, input } = req.body;
  const rawInput = (reference || receiptText || fullText || input || '').trim();

  if (!rawInput) {
    res.status(400).json({
      success: false,
      error: 'Missing verification input. Provide a "reference", "receiptText", or "input".'
    });
    return;
  }

  const apiKeyId = (req as any).apiKeyData?.id || null;
  const merchantId = (req as any).merchantId || null;

  const result: SmartVerifyResult = await runSmartVerify({
    input: rawInput,
    reference,
    suffix,
    phoneNumber,
    receiptText,
    fullText,
  });

  if (!result.success) {
    logger.warn(`[VERIFY-ROUTE] Verification failed [${result.httpStatus}]: ${result.error}`);
    res.status(result.httpStatus).json({
      success: false,
      error: result.error,
      provider: result.provider,
      ...(result.details ? { details: result.details } : {}),
    });
    return;
  }

  const normalized = extractNormalizedPaymentInfo(
    result.data,
    result.provider || 'UNKNOWN',
    reference || rawInput,
    result.verificationMode
  );

  const txId = crypto.randomUUID();
  const verifiedAt = new Date();

  // Save to database
  try {
    await db.insert(verifiedTransactions).values({
      id: txId,
      merchantId,
      reference: normalized.reference,
      provider: normalized.provider,
      amount: normalized.amount,
      payer: normalized.payer,
      receiver: normalized.receiver,
      status: normalized.status,
      verificationMode: normalized.verificationMode,
      rawText: rawInput,
      apiKeyId,
      metadata: {
        rawPayload: result.data,
      },
      verifiedAt,
    });
  } catch (dbErr: any) {
    logger.warn(`Failed to persist verified transaction to database: ${dbErr.message}`);
  }

  // Trigger async webhook dispatch
  dispatchPaymentWebhook('payment.verified', {
    event: 'payment.verified',
    transaction: {
      id: txId,
      reference: normalized.reference,
      provider: normalized.provider,
      amount: parseFloat(normalized.amount),
      payer: normalized.payer,
      receiver: normalized.receiver,
      status: normalized.status,
      verifiedAt: verifiedAt.toISOString(),
      verificationMode: normalized.verificationMode,
      metadata: result.data,
    },
    timestamp: verifiedAt.toISOString(),
  }, txId).catch((hookErr) => {
    logger.warn(`Async webhook dispatch error: ${hookErr.message}`);
  });

  res.json({
    success: true,
    provider: normalized.provider,
    verificationMode: normalized.verificationMode,
    data: normalized,
  });
});

export default router;
