import { Request, Response, NextFunction } from 'express';
import { getRequestIp } from '../utils/requestIp';
import { db } from '../db';
import { verifiedTransactions, merchants } from '../db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getMerchantById } from '../services/authService';
import logger from '../utils/logger';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
  skipAdmins?: boolean;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, message = 'Too many requests. Rate limit exceeded.', skipAdmins = true } = options;
  const store = new Map<string, { count: number; windowStart: number }>();

  // Cleanup expired windows every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of store.entries()) {
      if (now - val.windowStart > windowMs * 2) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skipAdmins && ((req as any).isAdmin || (req as any).isSuperAdmin)) {
      return next();
    }

    const apiKeyId = (req as any).apiKeyData?.id;
    const clientIp = getRequestIp(req) || 'unknown';
    const rateLimitKey = apiKeyId ? `key:${apiKeyId}` : `ip:${clientIp}`;

    const now = Date.now();
    const entry = store.get(rateLimitKey);

    if (!entry || now - entry.windowStart >= windowMs) {
      store.set(rateLimitKey, { count: 1, windowStart: now });
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      return next();
    }

    entry.count++;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + windowMs) / 1000));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
      return;
    }

    next();
  };
}

// 1. General API rate limiter (300 requests / min per key or IP)
export const rateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'API rate limit exceeded. Max 300 requests per minute.',
});

// 2. Auth rate limiter (15 attempts per 15 mins to prevent credential brute-force)
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
  skipAdmins: false,
});

// 3. Public Anonymous Sandbox Limiter: Strictly 20 checks/hr per IP
export const publicSandboxRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Anonymous sandbox limit reached (20 checks/hour). Create a free account for 250 checks/month.',
  skipAdmins: true,
});

// In-memory monthly quota tracker cache
const inMemoryMonthlyUsage = new Map<string, { monthKey: string; count: number }>();

/**
 * Enforces Free Merchant Monthly Quota (250 checks / month)
 * Unlimited accounts and Super Admins bypass this limit.
 */
export async function enforceMerchantMonthlyQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Super Admins bypass
  if ((req as any).isAdmin || (req as any).isSuperAdmin) {
    return next();
  }

  // Anonymous Sandbox requests bypass merchant quota (handled by publicSandboxRateLimiter)
  if ((req as any).isSandbox && !(req as any).merchantId) {
    return publicSandboxRateLimiter(req, res, next);
  }

  const merchantId = (req as any).merchantId;
  if (!merchantId) {
    return publicSandboxRateLimiter(req, res, next);
  }

  try {
    const merchant = await getMerchantById(merchantId);
    const plan = (merchant?.plan || 'free').toLowerCase();

    // Unlimited tier has unmetered access
    if (plan === 'unlimited') {
      res.setHeader('X-Quota-Limit', 'unlimited');
      res.setHeader('X-Quota-Plan', 'unlimited');
      return next();
    }

    // Free tier: 250 checks per calendar month
    const FREE_LIMIT = 250;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let currentUsage = 0;

    try {
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(verifiedTransactions)
        .where(
          and(
            eq(verifiedTransactions.merchantId, merchantId),
            gte(verifiedTransactions.verifiedAt, startOfMonth)
          )
        );

      currentUsage = Number(countResult?.count || 0);
    } catch {
      // Memory fallback if DB query fails
      const cached = inMemoryMonthlyUsage.get(merchantId);
      if (cached && cached.monthKey === monthKey) {
        currentUsage = cached.count;
      } else {
        currentUsage = 0;
      }
    }

    res.setHeader('X-Quota-Limit', FREE_LIMIT);
    res.setHeader('X-Quota-Used', currentUsage);
    res.setHeader('X-Quota-Remaining', Math.max(0, FREE_LIMIT - currentUsage));
    res.setHeader('X-Quota-Plan', 'free');

    if (currentUsage >= FREE_LIMIT) {
      logger.warn(`Merchant ${merchantId} reached Free monthly quota (${currentUsage}/${FREE_LIMIT})`);
      res.status(429).json({
        success: false,
        error: `Monthly verification quota reached (250/month). Upgrade to the Unlimited Plan (4,000 ETB) for unmetered checks.`,
        code: 'MONTHLY_QUOTA_EXCEEDED',
        quota: {
          used: currentUsage,
          limit: FREE_LIMIT,
          plan: 'free',
        },
      });
      return;
    }

    // Increment in-memory counter
    const cached = inMemoryMonthlyUsage.get(merchantId);
    if (cached && cached.monthKey === monthKey) {
      cached.count++;
    } else {
      inMemoryMonthlyUsage.set(merchantId, { monthKey, count: currentUsage + 1 });
    }

    next();
  } catch (err: any) {
    logger.error('Error enforcing monthly quota:', err);
    next();
  }
}
