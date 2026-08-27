import { Router, Request, Response } from 'express';
import { verifyTelebirr } from '../services/verifyTelebirr';
import { verifyProviderReceiptText } from '../services/verifyReceiptText';
import logger from '../utils/logger';

const router = Router();

interface VerifyTelebirrRequestBody {
    reference: string;
    receiptText?: string;
    fullText?: string;
}

router.post<{}, {}, VerifyTelebirrRequestBody>(
    '/',
    async (req: Request<{}, {}, VerifyTelebirrRequestBody>, res: Response): Promise<void> => {
        const { reference, receiptText, fullText } = req.body;
        const suppliedReceiptText = typeof receiptText === 'string' ? receiptText : fullText;

        if (!reference) {
            res.status(400).json({ success: false, error: 'Missing reference.' });
            return;
        }

        try {
            const localTextResult = suppliedReceiptText?.trim()
                ? verifyProviderReceiptText('TELEBIRR', reference, suppliedReceiptText)
                : null;
            const result = localTextResult ?? await verifyTelebirr(reference);
            if (!result || (localTextResult !== null && localTextResult.success === false)) {
                res.status(404).json({ success: false, error: (result as any)?.error || 'Receipt not found or could not be processed.' });
                return;
            }
            res.json({ success: true, data: result });
        } catch (err: any) {
            logger.error('Telebirr verification error:', err);

            if (err.name === 'TelebirrVerificationError') {
                res.status(502).json({
                    success: false,
                    error: err.message,
                    details: err.details
                });
                return;
            }

            res.status(500).json({ 
                success: false, 
                error: 'Server error verifying Telebirr receipt.',
                message: err instanceof Error ? err.message : 'Unknown error'
            });
        }
    }
);

export default router;
