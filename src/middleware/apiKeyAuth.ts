import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { db } from '../db';
import { apiKeys, merchants } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { verifyToken } from '../services/authService';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chek_admin_super_secret_key_902104';

// ─── Key generation ────────────────────────────────────────────────────────────

export const generateApiKey = async (name: string = 'Default App', merchantId?: string) => {
  const rawSecret = crypto.randomBytes(24).toString('hex');
  const rawKey = `sk_live_${rawSecret}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const prefix = `sk_live_${rawSecret.substring(0, 6)}...`;

  const keyId = crypto.randomUUID();
  const [record] = await db.insert(apiKeys).values({
    id: keyId,
    merchantId: merchantId || null,
    name,
    keyHash,
    prefix,
    isActive: true,
  }).returning();

  return { apiKeyRecord: record, rawKey };
};

// ─── Key validation ────────────────────────────────────────────────────────────

export const validateApiKey = async (incomingKey: string) => {
  try {
    const incomingHash = crypto.createHash('sha256').update(incomingKey.trim()).digest('hex');
    const keyData = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.isActive, true),
        eq(apiKeys.keyHash, incomingHash)
      ),
    });
    return keyData || null;
  } catch (error) {
    logger.error('Error validating API key:', error);
    return null;
  }
};

// ─── Auth middleware ───────────────────────────────────────────────────────────

export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Public endpoints
  if (
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/ready' ||
    req.path.startsWith('/docs') ||
    req.path.startsWith('/api-docs') ||
    req.path.startsWith('/apidocs') ||
    req.path.startsWith('/doc') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  // Admin secret bypass
  const adminKey = req.headers['x-admin-key'] as string | undefined;
  if (adminKey && adminKey === ADMIN_SECRET) {
    (req as any).isAdmin = true;
    return next();
  }

  // Check Bearer / JWT Session
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const payload = verifyToken(token);
    if (payload) {
      (req as any).merchantUser = payload;
      return next();
    }
  }

  const apiKeyHeader = req.headers['x-api-key'] || (req.query.apiKey as string);
  if (!apiKeyHeader) {
    logger.warn(`Unauthorized request without API key: ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      error: 'API key is required. Pass header x-api-key: sk_live_...'
    });
  }

  const keyString = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const keyData = await validateApiKey(keyString);

  if (!keyData) {
    logger.warn('Invalid or revoked API key attempt.');
    return res.status(403).json({
      success: false,
      error: 'Invalid or revoked API key.'
    });
  }

  // Update last used timestamp in background
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyData.id))
    .catch((err) => logger.error('Failed to update apiKey lastUsedAt:', err));

  (req as any).apiKeyData = keyData;
  next();
};

export const listApiKeys = async (merchantId?: string) => {
  if (merchantId) {
    return db.query.apiKeys.findMany({
      where: eq(apiKeys.merchantId, merchantId),
      orderBy: [desc(apiKeys.createdAt)],
    });
  }
  return db.query.apiKeys.findMany({
    orderBy: [desc(apiKeys.createdAt)],
  });
};

export const revokeApiKey = async (id: string, merchantId?: string) => {
  const conditions = [eq(apiKeys.id, id)];
  if (merchantId) {
    conditions.push(eq(apiKeys.merchantId, merchantId));
  }

  return db.update(apiKeys)
    .set({ isActive: false })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .returning();
};

export const updateApiKey = async (id: string, updates: { name?: string; isActive?: boolean }, merchantId?: string) => {
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.isActive !== undefined) payload.isActive = updates.isActive;

  const conditions = [eq(apiKeys.id, id)];
  if (merchantId) {
    conditions.push(eq(apiKeys.merchantId, merchantId));
  }

  const [updated] = await db.update(apiKeys)
    .set(payload)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .returning();

  return updated;
};
