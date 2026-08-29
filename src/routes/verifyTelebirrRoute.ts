import { Router, Request, Response } from 'express';
import { verifyTelebirr } from '../services/verifyTelebirr';
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

        if (!reference && !suppliedReceiptText) {
            res.status(400).json({ success: false, error: 'Missing reference or receiptText.' });
            return;
        }

        try {
            const result = await verifyTelebirr(reference || '', suppliedReceiptText);
            if (!result) {
                res.status(404).json({ success: false, error: 'Telebirr receipt not found or could not be processed.' });
                return;
            }
            res.json({ success: true, data: result });
        } catch (err: any) {
            logger.error('Telebirr verification error:', err);
            res.status(500).json({ 
                success: false, 
                error: 'Server error verifying Telebirr receipt.',
                message: err instanceof Error ? err.message : 'Unknown error'
            });
        }
    }
);

export default router;
