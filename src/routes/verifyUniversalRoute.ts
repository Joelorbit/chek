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
}

function extractNormalizedPaymentInfo(resultData: any, defaultProvider: string, inputRef: string) {
  const d = resultData?.data || resultData || {};
  
  const provider = (d.provider || defaultProvider || 'UNKNOWN').toUpperCase();
  const reference = d.reference || d.receiptNo || d.transactionNo || d.invoiceNo || inputRef;
  
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
  const payer = d.payerName || d.payer || d.customerName || d.debitedPartyName || d.sender || null;

  // Extract receiver
  const receiver = d.receiverName || d.receiver || d.creditedPartyName || d.creditedPartyAccountNo || d.receiverAccount || null;

  const verificationMode = d.verificationMode || (d.receiptTextVerified ? 'LOCAL_TEXT' : 'LIVE_API');

  return {
    provider,
    reference,
    amount: amount.toFixed(2),
    payer: payer ? String(payer).slice(0, 255) : null,
    receiver: receiver ? String(receiver).slice(0, 255) : null,
    status: 'COMPLETED',
    verificationMode,
    metadata: d,
  };
}

router.post('/', async (req: Request<{}, {}, UniversalVerifyBody>, res: Response): Promise<void> => {
  const { reference, suffix, phoneNumber, receiptText, fullText } = req.body;
  const rawInput = reference || receiptText || fullText;

  if (!rawInput || typeof rawInput !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Missing verification input. Provide a "reference" or "receiptText".'
    });
    return;
  }

  const effectiveRef = (reference || '').trim();
  const apiKeyId = (req as any).apiKeyData?.id || null;

  const result: SmartVerifyResult = await runSmartVerify({
    reference: effectiveRef,
    suffix,
    phoneNumber,
    receiptText,
    fullText,
  });

  if (!result.success) {
    logger.warn(`Verification failed [${result.httpStatus}]: ${result.error}`);
    res.status(result.httpStatus).json({
      success: false,
      error: result.error,
      ...(result.details ? { details: result.details } : {}),
    });
    return;
  }

  const normalized = extractNormalizedPaymentInfo(result.data, result.provider || 'UNKNOWN', effectiveRef);
  const txId = crypto.randomUUID();
  const verifiedAt = new Date();

  // Save to Supabase PostgreSQL database via Drizzle ORM
  try {
    await db.insert(verifiedTransactions).values({
      id: txId,
      reference: normalized.reference,
      provider: normalized.provider,
      amount: normalized.amount,
      payer: normalized.payer,
      receiver: normalized.receiver,
      status: normalized.status,
      verificationMode: normalized.verificationMode,
      rawText: (receiptText || fullText || null),
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

  // Preserve exact Vixen878/verifier-api response shape
  const responseBody = (result.data as any)?.success !== undefined
    ? result.data
    : { success: true, data: result.data };

  res.json(responseBody);
});

export default router;
