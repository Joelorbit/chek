import crypto from 'crypto';
import { db } from '../db';
import { merchants } from '../db/schema';
import { eq } from 'drizzle-orm';
import logger from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_SECRET || 'chek_jwt_secret_signing_key_902104';

export interface MerchantUser {
  id: string;
  email: string;
  name: string;
  businessName: string;
  role: string;
  plan: string;
  isActive: boolean;
  createdAt: Date;
}

// ─── Password Hashing ─────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  try {
    const [salt, key] = combinedHash.split(':');
    if (!salt || !key) return false;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
  } catch {
    return false;
  }
}

// ─── JWT Creation & Verification ──────────────────────────────────────────────

export function signToken(payload: Record<string, unknown>, expiresInHours: number = 72): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInHours * 3600,
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

// ─── Merchant Operations ──────────────────────────────────────────────────────

export async function registerMerchant(input: {
  email: string;
  password: string;
  name?: string;
  businessName?: string;
  role?: string;
}): Promise<{ merchant: MerchantUser; token: string }> {
  const existing = await db.query.merchants.findFirst({
    where: eq(merchants.email, input.email.toLowerCase().trim()),
  });

  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const passwordHash = hashPassword(input.password);
  const [record] = await db.insert(merchants).values({
    email: input.email.toLowerCase().trim(),
    passwordHash,
    name: input.name?.trim() || 'Merchant',
    businessName: input.businessName?.trim() || 'My Business',
    role: input.role || 'merchant',
    plan: 'pro',
    isActive: true,
  }).returning();

  const token = signToken({
    id: record.id,
    email: record.email,
    role: record.role,
    name: record.name,
    businessName: record.businessName,
  });

  return { merchant: record, token };
}

export async function loginMerchant(
  email: string,
  password: string
): Promise<{ merchant: MerchantUser; token: string }> {
  const merchant = await db.query.merchants.findFirst({
    where: eq(merchants.email, email.toLowerCase().trim()),
  });

  if (!merchant || !verifyPassword(password, merchant.passwordHash)) {
    throw new Error('Invalid email or password.');
  }

  if (!merchant.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  const token = signToken({
    id: merchant.id,
    email: merchant.email,
    role: merchant.role,
    name: merchant.name,
    businessName: merchant.businessName,
  });

  return { merchant, token };
}

export async function seedAdminUserIfNotExists(): Promise<void> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@chek.et';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const adminName = 'System Admin';

    const existing = await db.query.merchants.findFirst({
      where: eq(merchants.email, adminEmail.toLowerCase().trim()),
    });

    if (!existing) {
      const passwordHash = hashPassword(adminPass);
      await db.insert(merchants).values({
        email: adminEmail.toLowerCase().trim(),
        passwordHash,
        name: adminName,
        businessName: 'Chek Platform Administration',
        role: 'admin',
        plan: 'enterprise',
        isActive: true,
      });
      logger.info(`✅ Default super admin created: ${adminEmail}`);
    }
  } catch (err: any) {
    logger.warn(`Could not seed default admin user: ${err.message}`);
  }
}
