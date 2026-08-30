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

export interface WebhookRecord {
  id: string;
  merchantId: string | null;
  url: string;
  signingSecret: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  transactionId?: string | null;
  event: string;
  payload: any;
  status: 'QUEUED' | 'SUCCEEDED' | 'RETRYING' | 'FAILED';
  statusCode?: number | null;
  responseBody?: string | null;
  attempts: number;
  lastError?: string | null;
  deliveredAt?: Date | null;
  createdAt: Date;
}

// In-memory fallback stores
const inMemoryWebhooks = new Map<string, WebhookRecord>();
const inMemoryDeliveries = new Map<string, WebhookDeliveryRecord>();

export function buildSignature(payload: unknown, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
}

async function deliverAttempt(deliveryId: string, webhookUrl: string, secret: string, payload: unknown, attempt: number) {
  try {
    const signature = buildSignature(payload, secret);
    const start = performance.now();
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Chek-Signature': `sha256=${signature}`,
        'User-Agent': 'Chek-Webhook-Engine/3.1',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const latency = Math.round(performance.now() - start);

    try {
      await db.update(webhookDeliveries)
        .set({
          status: 'SUCCEEDED',
          statusCode: response.status,
          responseBody: typeof response.data === 'string' ? response.data.slice(0, 2000) : JSON.stringify(response.data).slice(0, 2000),
          attempts: attempt,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    } catch {
      const del = inMemoryDeliveries.get(deliveryId);
      if (del) {
        del.status = 'SUCCEEDED';
        del.statusCode = response.status;
        del.responseBody = typeof response.data === 'string' ? response.data.slice(0, 2000) : JSON.stringify(response.data).slice(0, 2000);
        del.attempts = attempt;
        del.deliveredAt = new Date();
      }
    }

    logger.info(`Webhook successfully delivered to ${webhookUrl} in ${latency}ms [delivery=${deliveryId}]`);
  } catch (err: any) {
    const status = err.response?.status || null;
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 2000) : null;
    const errorMessage = err.message || 'Network error';

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1] || 10_000;
      try {
        await db.update(webhookDeliveries)
          .set({
            status: 'RETRYING',
            statusCode: status,
            responseBody: body,
            attempts: attempt,
            lastError: errorMessage,
          })
          .where(eq(webhookDeliveries.id, deliveryId));
      } catch {
        const del = inMemoryDeliveries.get(deliveryId);
        if (del) {
          del.status = 'RETRYING';
          del.statusCode = status;
          del.responseBody = body;
          del.attempts = attempt;
          del.lastError = errorMessage;
        }
      }

      logger.warn(`Webhook failed, retrying in ${delay}ms [delivery=${deliveryId}, attempt=${attempt}] ${errorMessage}`);
      setTimeout(() => {
        deliverAttempt(deliveryId, webhookUrl, secret, payload, attempt + 1).catch(() => {});
      }, delay);
    } else {
      try {
        await db.update(webhookDeliveries)
          .set({
            status: 'FAILED',
            statusCode: status,
            responseBody: body,
            attempts: attempt,
            lastError: errorMessage,
          })
          .where(eq(webhookDeliveries.id, deliveryId));
      } catch {
        const del = inMemoryDeliveries.get(deliveryId);
        if (del) {
          del.status = 'FAILED';
          del.statusCode = status;
          del.responseBody = body;
          del.attempts = attempt;
          del.lastError = errorMessage;
        }
      }

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
    let activeWebhooks: any[] = [];
    try {
      const conditions = [eq(webhooks.isActive, true)];
      if (merchantId) {
        conditions.push(eq(webhooks.merchantId, merchantId));
      }

      activeWebhooks = await db.query.webhooks.findMany({
        where: conditions.length === 1 ? conditions[0] : and(...conditions),
      });
    } catch {
      activeWebhooks = Array.from(inMemoryWebhooks.values()).filter(
        h => h.isActive && (!merchantId || h.merchantId === merchantId)
      );
    }

    if (activeWebhooks.length === 0) return;

    for (const hook of activeWebhooks) {
      const subscribedEvents = hook.events || ['payment.verified'];
      if (!subscribedEvents.includes(event) && !subscribedEvents.includes('*')) {
        continue;
      }

      const deliveryId = crypto.randomUUID();
      const deliveryRecord: WebhookDeliveryRecord = {
        id: deliveryId,
        webhookId: hook.id,
        transactionId: transactionId || null,
        event,
        payload,
        status: 'QUEUED',
        attempts: 0,
        createdAt: new Date(),
      };

      try {
        await db.insert(webhookDeliveries).values(deliveryRecord as any);
      } catch {
        inMemoryDeliveries.set(deliveryId, deliveryRecord);
      }

      // Fire async delivery
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
  const id = crypto.randomUUID();
  const record: WebhookRecord = {
    id,
    merchantId: merchantId || null,
    url,
    signingSecret,
    events,
    isActive: true,
    createdAt: new Date(),
  };

  try {
    const [dbRecord] = await db.insert(webhooks).values(record as any).returning();
    return dbRecord || record;
  } catch {
    inMemoryWebhooks.set(id, record);
    return record;
  }
}

export async function listWebhooks(merchantId?: string) {
  try {
    if (merchantId) {
      return await db.query.webhooks.findMany({
        where: eq(webhooks.merchantId, merchantId),
        orderBy: [desc(webhooks.createdAt)],
      });
    }
    return await db.query.webhooks.findMany({
      orderBy: [desc(webhooks.createdAt)],
    });
  } catch {
    const list = Array.from(inMemoryWebhooks.values());
    if (merchantId) {
      return list.filter(w => w.merchantId === merchantId);
    }
    return list;
  }
}

export async function listWebhookDeliveries(webhookId?: string, limit: number = 50) {
  try {
    if (webhookId) {
      return await db.query.webhookDeliveries.findMany({
        where: eq(webhookDeliveries.webhookId, webhookId),
        orderBy: [desc(webhookDeliveries.createdAt)],
        limit,
      });
    }
    return await db.query.webhookDeliveries.findMany({
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit,
    });
  } catch {
    const list = Array.from(inMemoryDeliveries.values());
    if (webhookId) {
      return list.filter(d => d.webhookId === webhookId).slice(0, limit);
    }
    return list.slice(0, limit);
  }
}

export async function deleteWebhook(id: string, merchantId?: string) {
  try {
    const conditions = [eq(webhooks.id, id)];
    if (merchantId) {
      conditions.push(eq(webhooks.merchantId, merchantId));
    }
    return await db.delete(webhooks).where(conditions.length === 1 ? conditions[0] : and(...conditions)).returning();
  } catch {
    const found = inMemoryWebhooks.get(id);
    if (found && (!merchantId || found.merchantId === merchantId)) {
      inMemoryWebhooks.delete(id);
      return [found];
    }
    return [];
  }
}

/**
 * Triggers a real test webhook dispatch to verify merchant server receiving capability
 */
export async function triggerTestWebhook(id: string, merchantId?: string) {
  let hook: WebhookRecord | undefined;
  try {
    const conditions = [eq(webhooks.id, id)];
    if (merchantId) conditions.push(eq(webhooks.merchantId, merchantId));
    hook = await db.query.webhooks.findFirst({
      where: conditions.length === 1 ? conditions[0] : and(...conditions),
    }) as any;
  } catch {
    hook = inMemoryWebhooks.get(id);
  }

  if (!hook) {
    throw new Error('Webhook endpoint not found or unauthorized.');
  }

  const deliveryId = crypto.randomUUID();
  const testPayload: WebhookPayload = {
    event: 'payment.verified',
    transaction: {
      id: crypto.randomUUID(),
      reference: 'DHS78S7FQN',
      provider: 'TELEBIRR',
      amount: 4000.00,
      payer: 'Abebe Kebede (0911****12)',
      receiver: 'Chek Merchant Store',
      status: 'COMPLETED',
      verifiedAt: new Date().toISOString(),
      verificationMode: 'LIVE_ETHIO_TELECOM',
      metadata: { test: true, environment: 'production' },
    },
    timestamp: new Date().toISOString(),
  };

  const signature = buildSignature(testPayload, hook.signingSecret);
  const start = performance.now();

  try {
    const res = await axios.post(hook.url, testPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Chek-Signature': `sha256=${signature}`,
        'User-Agent': 'Chek-Webhook-Engine/3.1',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const latencyMs = Math.round(performance.now() - start);
    const deliveryRecord: WebhookDeliveryRecord = {
      id: deliveryId,
      webhookId: hook.id,
      transactionId: testPayload.transaction.id,
      event: 'payment.verified',
      payload: testPayload,
      status: 'SUCCEEDED',
      statusCode: res.status,
      responseBody: typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500),
      attempts: 1,
      deliveredAt: new Date(),
      createdAt: new Date(),
    };

    try {
      await db.insert(webhookDeliveries).values(deliveryRecord as any);
    } catch {
      inMemoryDeliveries.set(deliveryId, deliveryRecord);
    }

    return {
      success: true,
      statusCode: res.status,
      latencyMs,
      signature: `sha256=${signature}`,
      responseBody: typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500),
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    const statusCode = err.response?.status || 0;
    const responseBody = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : null;
    const errorMessage = err.message || 'Connection failed';

    const deliveryRecord: WebhookDeliveryRecord = {
      id: deliveryId,
      webhookId: hook.id,
      transactionId: testPayload.transaction.id,
      event: 'payment.verified',
      payload: testPayload,
      status: 'FAILED',
      statusCode,
      responseBody,
      attempts: 1,
      lastError: errorMessage,
      createdAt: new Date(),
    };

    try {
      await db.insert(webhookDeliveries).values(deliveryRecord as any);
    } catch {
      inMemoryDeliveries.set(deliveryId, deliveryRecord);
    }

    return {
      success: false,
      statusCode,
      latencyMs,
      signature: `sha256=${signature}`,
      error: errorMessage,
      responseBody,
    };
  }
}
