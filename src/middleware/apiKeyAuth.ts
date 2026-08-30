import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { db } from '../db';
import { apiKeys, merchants } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { verifyToken } from '../services/authService';
import { timingSafeEqualString } from '../utils/security';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chek_admin_super_secret_key_902104';

export interface ApiKeyRecord {
  id: string;
  merchantId: string | null;
  name: string;
  keyHash: string;
  prefix: string;
  isActive: boolean;
  lastUsedAt?: Date | null;
  createdAt: Date;
}

const inMemoryApiKeys = new Map<string, ApiKeyRecord>();

// ─── Key generation ────────────────────────────────────────────────────────────

export const generateApiKey = async (name: string = 'Production Key', merchantId?: string) => {
  const rawSecret = crypto.randomBytes(24).toString('hex');
  const rawKey = `sk_live_${rawSecret}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const prefix = `sk_live_${rawSecret.substring(0, 6)}...`;

  const keyId = crypto.randomUUID();
  const record: ApiKeyRecord = {
    id: keyId,
    merchantId: merchantId || null,
    name,
    keyHash,
    prefix,
    isActive: true,
    createdAt: new Date(),
  };

  try {
    const [dbRecord] = await db.insert(apiKeys).values(record as any).returning();
    return { apiKeyRecord: dbRecord || record, apiKey: rawKey, rawKey };
  } catch {
    inMemoryApiKeys.set(keyId, record);
    return { apiKeyRecord: record, apiKey: rawKey, rawKey };
  }
};

// ─── Key validation ────────────────────────────────────────────────────────────

export const validateApiKey = async (incomingKey: string) => {
  try {
    if (!incomingKey || typeof incomingKey !== 'string') return null;
    const incomingHash = crypto.createHash('sha256').update(incomingKey.trim()).digest('hex');
    
    try {
      const keyData = await db.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.isActive, true),
          eq(apiKeys.keyHash, incomingHash)
        ),
      });
      if (keyData) return keyData;
    } catch {}

    // In-memory fallback
    for (const k of inMemoryApiKeys.values()) {
      if (k.isActive && k.keyHash === incomingHash) {
        return k;
      }
    }

    return null;
  } catch (error) {
    logger.error('Error validating API key:', error);
    return null;
  }
};

// ─── Auth middleware ───────────────────────────────────────────────────────────

export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Public endpoints & static assets
  if (
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/ready' ||
    req.path === '/status' ||
    req.path.startsWith('/docs') ||
    req.path.startsWith('/api-docs') ||
    req.path.startsWith('/apidocs') ||
    req.path.startsWith('/doc') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  // Admin secret bypass (timing-safe check)
  const adminKey = (req.headers['x-admin-key'] as string) || (req.query.adminKey as string);
  if (adminKey && timingSafeEqualString(adminKey, ADMIN_SECRET)) {
    (req as any).isAdmin = true;
    return next();
  }

  // Check Cookie or Bearer / JWT Session
  const cookieToken = req.cookies?.chek_session || (req as any).signedCookies?.chek_session;
  const authHeader = req.headers['authorization'] || req.headers['x-session-token'];
  const rawToken = typeof authHeader === 'string'
    ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader).trim()
    : (typeof cookieToken === 'string' ? cookieToken : null);

  if (rawToken) {
    const payload = verifyToken(rawToken);
    if (payload && payload.id) {
      (req as any).merchantUser = payload;
      (req as any).merchantId = payload.id;
      if (payload.role === 'admin' || payload.role === 'super_admin') (req as any).isAdmin = true;
      return next();
    }
  }

  const apiKeyHeader = req.headers['x-api-key'] || (req.query.apiKey as string);
  if (!apiKeyHeader) {
    // Allow public sandbox verifications on /verify and /verify-image
    if (req.path === '/verify' || req.path === '/verify-image') {
      (req as any).isSandbox = true;
      return next();
    }

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
  try {
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyData.id))
      .catch(() => {});
  } catch {}

  (req as any).apiKeyData = keyData;
  (req as any).merchantId = keyData.merchantId;
  next();
};

export const listApiKeys = async (merchantId?: string) => {
  try {
    if (merchantId) {
      return await db.query.apiKeys.findMany({
        where: eq(apiKeys.merchantId, merchantId),
        orderBy: [desc(apiKeys.createdAt)],
      });
    }
    return await db.query.apiKeys.findMany({
      orderBy: [desc(apiKeys.createdAt)],
    });
  } catch {
    const list = Array.from(inMemoryApiKeys.values());
    if (merchantId) {
      return list.filter(k => k.merchantId === merchantId);
    }
    return list;
  }
};

export const revokeApiKey = async (id: string, merchantId?: string) => {
  try {
    const conditions = [eq(apiKeys.id, id)];
    if (merchantId) {
      conditions.push(eq(apiKeys.merchantId, merchantId));
    }
    const res = await db.update(apiKeys)
      .set({ isActive: false })
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .returning();
    return res.length > 0;
  } catch {
    const found = inMemoryApiKeys.get(id);
    if (found && (!merchantId || found.merchantId === merchantId)) {
      found.isActive = false;
      return true;
    }
    return false;
  }
};

export const updateApiKey = async (id: string, name: string, merchantId?: string) => {
  try {
    const conditions = [eq(apiKeys.id, id)];
    if (merchantId) {
      conditions.push(eq(apiKeys.merchantId, merchantId));
    }
    const [updated] = await db.update(apiKeys)
      .set({ name })
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .returning();
    return updated;
  } catch {
    const found = inMemoryApiKeys.get(id);
    if (found && (!merchantId || found.merchantId === merchantId)) {
      found.name = name;
      return found;
    }
    return null;
  }
};
