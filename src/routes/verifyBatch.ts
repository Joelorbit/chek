import { Router, Request, Response } from 'express';
import { runSmartVerify } from '../services/verifyUniversal';
import logger from '../utils/logger';
import { db } from '../db';
import { verifiedTransactions } from '../db/schema';
import crypto from 'crypto';

const router = Router();
const MAX_BATCH_SIZE = 50;

interface BatchItem {
  reference: string;
  suffix?: string;
  phoneNumber?: string;
  receiptText?: string;
}

interface BatchBody {
  references: BatchItem[];
}

router.post('/', async (req: Request<{}, {}, BatchBody>, res: Response): Promise<void> => {
  const { references } = req.body;

  if (!Array.isArray(references) || references.length === 0) {
    res.status(400).json({ success: false, error: 'references must be a non-empty array of items.' });
    return;
  }

  if (references.length > MAX_BATCH_SIZE) {
    res.status(400).json({
      success: false,
      error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} items per request.`,
    });
    return;
  }

  const apiKeyId = (req as any).apiKeyData?.id || null;

  const settled = await Promise.allSettled(
    references.map(async (item) => {
      const res = await runSmartVerify({
        reference: item.reference,
        suffix: item.suffix,
        phoneNumber: item.phoneNumber,
        receiptText: item.receiptText,
      });

      if (res.success) {
        // Save to DB in background
        const txId = crypto.randomUUID();
        const d: any = res.data || {};
        const amount = d.amount || d.settledAmount || d.paidAmount || d.transactionAmount || '0.00';

        db.insert(verifiedTransactions).values({
          id: txId,
          reference: item.reference,
          provider: res.provider || 'UNKNOWN',
          amount: String(amount),
          payer: d.payerName || d.payer || d.customerName || null,
          receiver: d.receiverName || d.receiver || null,
          status: 'COMPLETED',
          verificationMode: item.receiptText ? 'LOCAL_TEXT' : 'LIVE_API',
          rawText: item.receiptText || null,
          metadata: d,
          apiKeyId,
        }).catch((e) => logger.error('Batch save error:', e.message));
      }

      return res;
    })
  );

  const results = settled.map((outcome, i) => {
    const item = references[i]!;
    if (outcome.status === 'fulfilled') {
      const r = outcome.value;
      return {
        index: i,
        reference: item.reference,
        success: r.success,
        provider: r.provider,
        ...(r.success ? { data: r.data } : { error: r.error }),
      };
    }
    return {
      index: i,
      reference: item.reference,
      success: false,
      error: outcome.reason instanceof Error ? outcome.reason.message : 'Unexpected error',
    };
  });

  const succeeded = results.filter((r) => r.success).length;

  res.json({
    success: true,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
});

export default router;
