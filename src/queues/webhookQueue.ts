import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import { db } from '../db';
import { webhooks, webhookDeliveries } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';

const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];
const MAX_ATTEMPTS = 3;

export interface WebhookPayload {
  event: string;
  transaction: {
    id: string;
    reference: string;
    provider: string;
    amount: string | number;
    payer?: string | null;
    receiver?: string | null;
    status: string;
    verifiedAt: string;
    verificationMode: string;
    metadata?: Record<string, unknown> | null;
  };
  timestamp: string;
}

function buildSignature(payload: unknown, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function deliverAttempt(deliveryId: string, webhookUrl: string, secret: string, payload: unknown, attempt: number) {
  try {
    const signature = buildSignature(payload, secret);
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Chek-Signature': `sha256=${signature}`,
        'User-Agent': 'Chek-Webhook-Engine/3.1',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    await db.update(webhookDeliveries)
      .set({
        status: 'SUCCEEDED',
        statusCode: response.status,
        responseBody: typeof response.data === 'string' ? response.data.slice(0, 2000) : JSON.stringify(response.data).slice(0, 2000),
        attempts: attempt,
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    logger.info(`Webhook successfully delivered to ${webhookUrl} [delivery=${deliveryId}]`);
  } catch (err: any) {
    const status = err.response?.status || null;
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 2000) : null;
    const errorMessage = err.message || 'Network error';

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1] || 10_000;
      await db.update(webhookDeliveries)
        .set({
          status: 'RETRYING',
          statusCode: status,
          responseBody: body,
          attempts: attempt,
          lastError: errorMessage,
        })
        .where(eq(webhookDeliveries.id, deliveryId));

      logger.warn(`Webhook failed, retrying in ${delay}ms [delivery=${deliveryId}, attempt=${attempt}] ${errorMessage}`);
      setTimeout(() => {
        deliverAttempt(deliveryId, webhookUrl, secret, payload, attempt + 1).catch(() => {});
      }, delay);
    } else {
      await db.update(webhookDeliveries)
        .set({
          status: 'FAILED',
          statusCode: status,
          responseBody: body,
          attempts: attempt,
          lastError: errorMessage,
        })
        .where(eq(webhookDeliveries.id, deliveryId));

      logger.error(`Webhook dead-lettered after ${MAX_ATTEMPTS} attempts [delivery=${deliveryId}] ${errorMessage}`);
    }
  }
}

export async function dispatchPaymentWebhook(
  event: string,
  payload: WebhookPayload,
  transactionId?: string,
  merchantId?: string
): Promise<void> {
  try {
    const conditions = [eq(webhooks.isActive, true)];
    if (merchantId) {
      conditions.push(eq(webhooks.merchantId, merchantId));
    }

    const activeWebhooks = await db.query.webhooks.findMany({
      where: conditions.length === 1 ? conditions[0] : and(...conditions),
    });

    if (activeWebhooks.length === 0) return;

    for (const hook of activeWebhooks) {
      const subscribedEvents = hook.events || ['payment.verified'];
      if (!subscribedEvents.includes(event) && !subscribedEvents.includes('*')) {
        continue;
      }

      const deliveryId = crypto.randomUUID();
      await db.insert(webhookDeliveries).values({
        id: deliveryId,
        webhookId: hook.id,
        transactionId: transactionId || null,
        event,
        payload: payload as any,
        status: 'QUEUED',
        attempts: 0,
      });

      // Fire in-process async delivery
      setImmediate(() => {
        deliverAttempt(deliveryId, hook.url, hook.signingSecret, payload, 1).catch((err) => {
          logger.error(`Error launching webhook attempt: ${err.message}`);
        });
      });
    }
  } catch (error) {
    logger.error('Error dispatching payment webhooks:', error);
  }
}

export async function registerWebhook(
  url: string,
  events: string[] = ['payment.verified'],
  merchantId?: string
) {
  const signingSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const [record] = await db.insert(webhooks).values({
    id: crypto.randomUUID(),
    merchantId: merchantId || null,
    url,
    signingSecret,
    events,
    isActive: true,
  }).returning();

  return record;
}

export async function listWebhooks(merchantId?: string) {
  if (merchantId) {
    return db.query.webhooks.findMany({
      where: eq(webhooks.merchantId, merchantId),
      orderBy: [desc(webhooks.createdAt)],
    });
  }
  return db.query.webhooks.findMany({
    orderBy: [desc(webhooks.createdAt)],
  });
}

export async function listWebhookDeliveries(webhookId?: string, limit: number = 20) {
  if (webhookId) {
    return db.query.webhookDeliveries.findMany({
      where: eq(webhookDeliveries.webhookId, webhookId),
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit,
    });
  }
  return db.query.webhookDeliveries.findMany({
    orderBy: [desc(webhookDeliveries.createdAt)],
    limit,
  });
}

export async function deleteWebhook(id: string, merchantId?: string) {
  const conditions = [eq(webhooks.id, id)];
  if (merchantId) {
    conditions.push(eq(webhooks.merchantId, merchantId));
  }
  return db.delete(webhooks).where(conditions.length === 1 ? conditions[0] : and(...conditions)).returning();
}
