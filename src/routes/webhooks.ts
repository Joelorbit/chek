import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { db } from '../db';
import { webhooks, webhookDeliveries } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { registerWebhook, listWebhooks, deleteWebhook } from '../queues/webhookQueue';

const router = Router();

// ─── POST /webhooks (Register a new webhook) ─────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url, events } = req.body as { url?: string; events?: string[] };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ success: false, error: 'url is required and must be a valid URL.' });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ success: false, error: 'url must be a valid HTTP/HTTPS URL.' });
    return;
  }

  try {
    const webhook = await registerWebhook(url, events || ['verification.success']);
    res.status(201).json({
      success: true,
      webhook,
      note: 'Store signing_secret to verify incoming X-Chek-Signature HMAC headers.',
    });
  } catch (err: any) {
    logger.error('Failed to register webhook:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to register webhook.' });
  }
});

// ─── GET /webhooks (List webhooks) ───────────────────────────────────────────
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const list = await listWebhooks();
    res.json({ success: true, webhooks: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /webhooks/:id (Delete a webhook) ─────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await deleteWebhook(id);
    res.json({ success: true, message: 'Webhook deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /webhooks/:id/deliveries (List deliveries for a webhook) ─────────────
router.get('/:id/deliveries', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const deliveries = await db.query.webhookDeliveries.findMany({
      where: eq(webhookDeliveries.webhookId, id),
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit: 50,
    });

    res.json({ success: true, deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
