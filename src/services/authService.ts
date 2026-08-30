import crypto from 'crypto';
import { db } from '../db';
import { merchants, subscriptionPayments, apiKeys } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import logger from '../utils/logger';
import { isValidEmail, validatePasswordStrength, timingSafeEqualString } from '../utils/security';

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_SECRET || 'chek_jwt_secret_signing_key_902104';

export const SUPER_ADMIN_EMAIL = 'abitieyuel@gmail.com';
export const SUPER_ADMIN_PASS = 'Joelget@4';

export interface MerchantUser {
  id: string;
  email: string;
  name: string;
  businessName: string;
  role: string; // 'super_admin' | 'merchant'
  plan: string; // 'free' | 'unlimited' | 'enterprise'
  planExpiresAt?: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface SubscriptionRecord {
  id: string;
  merchantId: string;
  plan: string;
  billingCycle: string;
  amount: string;
  currency: string;
  provider: string; // 'TELEBIRR' | 'CBE'
  reference: string;
  status: string;
  validUntil: Date | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ─── In-Memory Fallback Registry ─────────────────────────────────────────────
const inMemoryMerchants: Map<string, MerchantUser & { passwordHash: string }> = new Map();
const inMemorySubscriptions: SubscriptionRecord[] = [];
const inMemoryResetTokens: Map<string, { tokenHash: string; expiresAt: number }> = new Map();

// ─── Password Hashing (Scrypt + 16-byte random salt) ──────────────────────────

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
    const keyBuf = Buffer.from(key, 'hex');
    if (keyBuf.length !== derivedKey.length) {
      crypto.timingSafeEqual(derivedKey, derivedKey);
      return false;
    }
    return crypto.timingSafeEqual(keyBuf, derivedKey);
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
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!timingSafeEqualString(signature, expectedSignature)) {
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

// ─── Single Super Admin Provisioning ─────────────────────────────────────────

export async function seedAdminUserIfNotExists(): Promise<void> {
  const adminEmail = SUPER_ADMIN_EMAIL.toLowerCase().trim();
  const adminPass = SUPER_ADMIN_PASS;
  const adminName = 'Eyuel Abitie';
  const adminBiz = 'Chek System Operations';

  const defaultAdmin: MerchantUser & { passwordHash: string } = {
    id: 'super-admin-root-001',
    email: adminEmail,
    passwordHash: hashPassword(adminPass),
    name: adminName,
    businessName: adminBiz,
    role: 'super_admin',
    plan: 'unlimited',
    planExpiresAt: null,
    isActive: true,
    createdAt: new Date(),
  };

  inMemoryMerchants.set(adminEmail, defaultAdmin);

  try {
    const existing = await db.query.merchants.findFirst({
      where: eq(merchants.email, adminEmail),
    });

    if (!existing) {
      await db.insert(merchants).values({
        id: defaultAdmin.id,
        email: adminEmail,
        passwordHash: defaultAdmin.passwordHash,
        name: adminName,
        businessName: defaultAdmin.businessName,
        role: 'super_admin',
        plan: 'unlimited',
        isActive: true,
      });
      logger.info(`Single Super Admin initialized: ${adminEmail}`);
    } else if (existing.role !== 'super_admin') {
      await db.update(merchants)
        .set({ role: 'super_admin', passwordHash: defaultAdmin.passwordHash })
        .where(eq(merchants.email, adminEmail));
    }
  } catch (err: any) {
    logger.info(`Seeded in-memory Super Admin (${adminEmail}): ${err.message}`);
  }
}

// ─── Merchant Registration & Login ───────────────────────────────────────────

export async function registerMerchant(input: {
  email: string;
  password: string;
  name?: string;
  businessName?: string;
}): Promise<{ merchant: MerchantUser; token: string; rawApiKey: string }> {
  if (!input.email || typeof input.email !== 'string') {
    throw new Error('Email address is required.');
  }

  const emailClean = input.email.toLowerCase().trim();
  if (!isValidEmail(emailClean)) {
    throw new Error('Please provide a valid email address.');
  }

  if (emailClean === SUPER_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('This email is reserved for Super Admin.');
  }

  const pwCheck = validatePasswordStrength(input.password);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.reason || 'Password must be at least 8 characters long.');
  }

  const passwordHash = hashPassword(input.password);
  const plan = 'free';
  const role = 'merchant';
  const displayName = input.name?.trim() || emailClean.split('@')[0];
  const businessName = input.businessName?.trim() || `${displayName}'s Store`;
  const id = crypto.randomUUID();
  const now = new Date();

  // Generate initial production API Key for immediate usage
  const rawSecret = crypto.randomBytes(24).toString('hex');
  const rawApiKey = `sk_live_${rawSecret}`;
  const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
  const prefix = `sk_live_${rawSecret.substring(0, 6)}...`;
  const apiKeyId = crypto.randomUUID();

  let record: MerchantUser;

  try {
    const existing = await db.query.merchants.findFirst({
      where: eq(merchants.email, emailClean),
    });

    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const [dbRecord] = await db.insert(merchants).values({
      id,
      email: emailClean,
      passwordHash,
      name: displayName,
      businessName,
      role,
      plan,
      isActive: true,
      createdAt: now,
    }).returning();

    record = dbRecord;

    // Insert Default API Key
    await db.insert(apiKeys).values({
      id: apiKeyId,
      merchantId: id,
      name: 'Default Production Key',
      keyHash,
      prefix,
      isActive: true,
      createdAt: now,
    });
  } catch (dbErr: any) {
    if (dbErr.message?.includes('already exists')) {
      throw dbErr;
    }
    // In-memory fallback
    if (inMemoryMerchants.has(emailClean)) {
      throw new Error('An account with this email already exists.');
    }

    record = {
      id,
      email: emailClean,
      name: displayName,
      businessName,
      role,
      plan,
      planExpiresAt: null,
      isActive: true,
      createdAt: now,
    };

    inMemoryMerchants.set(emailClean, { ...record, passwordHash });
  }

  const token = signToken({
    id: record.id,
    email: record.email,
    role: record.role,
    name: record.name,
    businessName: record.businessName,
    plan: record.plan,
  });

  return { merchant: record, token, rawApiKey };
}

export async function loginMerchant(
  email: string,
  password: string
): Promise<{ merchant: MerchantUser; token: string }> {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const emailClean = email.toLowerCase().trim();

  // 1. Single Super Admin Login
  if (emailClean === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (password === SUPER_ADMIN_PASS) {
      const superAdminUser: MerchantUser = {
        id: 'super-admin-root-001',
        email: SUPER_ADMIN_EMAIL,
        name: 'Eyuel Abitie',
        businessName: 'Chek System Operations',
        role: 'super_admin',
        plan: 'unlimited',
        planExpiresAt: null,
        isActive: true,
        createdAt: new Date(),
      };
      const token = signToken(superAdminUser as any);
      return { merchant: superAdminUser, token };
    } else {
      throw new Error('Invalid credentials.');
    }
  }

  // 2. Standard Merchant Login
  let merchant: (MerchantUser & { passwordHash?: string }) | undefined;

  try {
    const dbRecord = await db.query.merchants.findFirst({
      where: eq(merchants.email, emailClean),
    });
    if (dbRecord) merchant = dbRecord;
  } catch {}

  if (!merchant) {
    merchant = inMemoryMerchants.get(emailClean);
  }

  if (!merchant || !merchant.passwordHash || !verifyPassword(password, merchant.passwordHash)) {
    throw new Error('Invalid email address or password.');
  }

  if (!merchant.isActive) {
    throw new Error('Your account has been deactivated. Please contact platform support.');
  }

  const token = signToken({
    id: merchant.id,
    email: merchant.email,
    role: merchant.role,
    name: merchant.name,
    businessName: merchant.businessName,
    plan: merchant.plan,
  });

  return { merchant, token };
}

export async function getMerchantById(id: string): Promise<MerchantUser | null> {
  if (id === 'super-admin-root-001') {
    return {
      id: 'super-admin-root-001',
      email: SUPER_ADMIN_EMAIL,
      name: 'Eyuel Abitie',
      businessName: 'Chek System Operations',
      role: 'super_admin',
      plan: 'unlimited',
      planExpiresAt: null,
      isActive: true,
      createdAt: new Date(),
    };
  }

  try {
    const record = await db.query.merchants.findFirst({
      where: eq(merchants.id, id),
    });
    if (record) return record as MerchantUser;
  } catch {}

  for (const m of inMemoryMerchants.values()) {
    if (m.id === id) return m;
  }
  return null;
}

// ─── Forgot & Reset Password Workflow ─────────────────────────────────────────

export async function createPasswordResetToken(email: string): Promise<{ success: boolean; resetToken?: string; message: string }> {
  const emailClean = email.toLowerCase().trim();
  if (!isValidEmail(emailClean)) {
    throw new Error('Invalid email address.');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

  inMemoryResetTokens.set(emailClean, { tokenHash, expiresAt });

  logger.info(`[AUTH] Password reset token generated for ${emailClean}`);

  return {
    success: true,
    resetToken: rawToken,
    message: `Password reset instructions sent to ${emailClean}. Token valid for 1 hour.`,
  };
}

export async function resetPasswordWithToken(
  email: string,
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const emailClean = email.toLowerCase().trim();
  const tokenData = inMemoryResetTokens.get(emailClean);

  if (!tokenData || tokenData.expiresAt < Date.now()) {
    throw new Error('Invalid or expired password reset token.');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (!timingSafeEqualString(tokenHash, tokenData.tokenHash)) {
    throw new Error('Invalid password reset token.');
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.valid) {
    throw new Error(pwCheck.reason || 'Password must be at least 8 characters long.');
  }

  const newHash = hashPassword(newPassword);

  const memUser = inMemoryMerchants.get(emailClean);
  if (memUser) {
    memUser.passwordHash = newHash;
    inMemoryMerchants.set(emailClean, memUser);
  }

  try {
    await db.update(merchants)
      .set({ passwordHash: newHash })
      .where(eq(merchants.email, emailClean));
  } catch (err) {
    logger.warn('Failed updating password in DB, updated memory store.');
  }

  inMemoryResetTokens.delete(emailClean);

  return {
    success: true,
    message: 'Your password has been successfully updated. You can now sign in.',
  };
}

// ─── 4,000 ETB Unlimited Plan & Subscription Engine ──────────────────────────

export async function processSubscriptionPayment(input: {
  merchantId: string;
  plan: 'free' | 'unlimited';
  billingCycle: 'monthly' | 'annual';
  amount: number;
  provider: string; // 'TELEBIRR' | 'CBE'
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; subscription: SubscriptionRecord; message: string }> {
  const daysToAdd = input.billingCycle === 'annual' ? 365 : 30;
  const validUntil = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
  const subId = crypto.randomUUID();
  const now = new Date();

  const record: SubscriptionRecord = {
    id: subId,
    merchantId: input.merchantId,
    plan: input.plan.toLowerCase(),
    billingCycle: input.billingCycle,
    amount: input.amount.toFixed(2),
    currency: 'ETB',
    provider: input.provider.toUpperCase(),
    reference: input.reference.trim(),
    status: 'COMPLETED',
    validUntil,
    metadata: input.metadata || {},
    createdAt: now,
  };

  try {
    await db.insert(subscriptionPayments).values({
      id: record.id,
      merchantId: record.merchantId,
      plan: record.plan,
      billingCycle: record.billingCycle,
      amount: record.amount,
      currency: record.currency,
      provider: record.provider,
      reference: record.reference,
      status: record.status,
      validUntil: record.validUntil,
      metadata: record.metadata,
      createdAt: record.createdAt,
    });

    await db.update(merchants)
      .set({
        plan: record.plan,
        planExpiresAt: validUntil,
      })
      .where(eq(merchants.id, input.merchantId));

    logger.info(`Subscription upgraded: Merchant ${input.merchantId} -> ${record.plan} (${input.billingCycle})`);
  } catch (dbErr: any) {
    logger.warn(`Database offline during subscription payment, updating memory: ${dbErr.message}`);
    inMemorySubscriptions.push(record);

    for (const [key, m] of inMemoryMerchants.entries()) {
      if (m.id === input.merchantId) {
        m.plan = record.plan;
        m.planExpiresAt = validUntil;
        inMemoryMerchants.set(key, m);
        break;
      }
    }
  }

  return {
    success: true,
    subscription: record,
    message: `🎉 Account successfully upgraded to UNLIMITED Plan (4,000 ETB)! Active until ${validUntil.toLocaleDateString()}.`,
  };
}

export async function listSubscriptionsForMerchant(merchantId: string): Promise<SubscriptionRecord[]> {
  try {
    const list = await db.query.subscriptionPayments.findMany({
      where: eq(subscriptionPayments.merchantId, merchantId),
      orderBy: [desc(subscriptionPayments.createdAt)],
    });
    if (list && list.length > 0) return list as any;
  } catch {}

  return inMemorySubscriptions.filter(s => s.merchantId === merchantId);
}

export async function listAllSubscriptions(): Promise<SubscriptionRecord[]> {
  try {
    const list = await db.query.subscriptionPayments.findMany({
      orderBy: [desc(subscriptionPayments.createdAt)],
    });
    if (list && list.length > 0) return list as any;
  } catch {}

  return [...inMemorySubscriptions].reverse();
}
