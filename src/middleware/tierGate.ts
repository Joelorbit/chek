import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { workspaces } from '../db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getWorkspaceContext } from '../utils/workspaceContext';
import {
  addMonths,
  getBatchMaxReferences,
  getMonthlyImageCredits,
  getNotificationChannelLimit,
  getVerificationMonthlyQuota,
  getWebhookLimit,
  type WorkspaceTier,
} from '../config/plans';
import { getBillingConfig, type BillingConfig } from '../config/billingConfig';
import { isTrustedBillingPaymentVerification } from '../utils/trustedInternalOperation';

const APP_URL = process.env.VERITAS_APP_URL ?? 'https://veritas.et';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAccount(req: Request): {
  tier: WorkspaceTier;
  grandfathered: boolean;
  verificationCredits: number;
  verificationCreditsMonthly: number;
  verificationCreditsResetAt: Date | null;
  paidUntil: Date | null;
  planTermMonths: number | null;
  imageCredits: number;
  imageCreditsMonthly: number;
  imageCreditsResetAt: Date | null;
  creditHolder: 'workspace';
  creditHolderId: string;
} {
  const context = getWorkspaceContext(req);
  if (context) {
    return {
      tier: context.workspace.tier,
      grandfathered: context.workspace.grandfathered,
      verificationCredits: context.workspace.verificationCredits,
      verificationCreditsMonthly: context.workspace.verificationCreditsMonthly,
      verificationCreditsResetAt: context.workspace.verificationCreditsResetAt,
      paidUntil: context.workspace.paidUntil,
      planTermMonths: context.workspace.planTermMonths,
      imageCredits: context.workspace.imageCredits,
      imageCreditsMonthly: context.workspace.imageCreditsMonthly,
      imageCreditsResetAt: context.workspace.imageCreditsResetAt,
      creditHolder: 'workspace',
      creditHolderId: context.workspace.id,
    };
  }
  
  // Fallback for backward compatibility
  const apiKeyData = (req as any).apiKeyData;
  const ws = apiKeyData?.workspace;
  return {
    tier: ws?.tier ?? 'FREE',
    grandfathered: ws?.grandfathered ?? false,
    verificationCredits: ws?.verificationCredits ?? 0,
    verificationCreditsMonthly: ws?.verificationCreditsMonthly ?? 0,
    verificationCreditsResetAt: ws?.verificationCreditsResetAt ?? null,
    paidUntil: ws?.paidUntil ?? null,
    planTermMonths: ws?.planTermMonths ?? null,
    imageCredits: ws?.imageCredits ?? 0,
    imageCreditsMonthly: ws?.imageCreditsMonthly ?? 0,
    imageCreditsResetAt: ws?.imageCreditsResetAt ?? null,
    creditHolder: 'workspace',
    creditHolderId: ws?.id ?? apiKeyData?.workspaceId ?? '',
  };
}

async function syncWorkspacePlanState(
  account: ReturnType<typeof resolveAccount>,
): Promise<BillingConfig> {
  const now = new Date();
  const billingConfig = await getBillingConfig();
  const freeQuota = getVerificationMonthlyQuota('FREE', account.grandfathered, billingConfig);
  const freeImageCredits = getMonthlyImageCredits('FREE', billingConfig);

  if (account.tier !== 'FREE' && account.paidUntil && now >= account.paidUntil) {
    await db
      .update(workspaces)
      .set({
        tier: 'FREE',
        paidUntil: null,
        planTermMonths: null,
        verificationCredits: freeQuota,
        verificationCreditsMonthly: freeQuota,
        verificationCreditsResetAt: addMonths(now, 1),
        imageCredits: freeImageCredits,
        imageCreditsMonthly: freeImageCredits,
        imageCreditsResetAt: addMonths(now, 1),
      })
      .where(eq(workspaces.id, account.creditHolderId));

    account.tier = 'FREE';
    account.paidUntil = null;
    account.planTermMonths = null;
    account.verificationCredits = freeQuota;
    account.verificationCreditsMonthly = freeQuota;
    account.verificationCreditsResetAt = addMonths(now, 1);
    account.imageCredits = freeImageCredits;
    account.imageCreditsMonthly = freeImageCredits;
    account.imageCreditsResetAt = addMonths(now, 1);
  }

  const expectedVerificationQuota = getVerificationMonthlyQuota(account.tier, account.grandfathered, billingConfig);
  if (!account.verificationCreditsResetAt) {
    const creditsToSet = account.verificationCredits > 0 ? account.verificationCredits : expectedVerificationQuota;
    const resetDate = addMonths(now, 1);

    await db
      .update(workspaces)
      .set({
        verificationCreditsMonthly: expectedVerificationQuota,
        verificationCredits: creditsToSet,
        verificationCreditsResetAt: resetDate,
      })
      .where(eq(workspaces.id, account.creditHolderId));

    account.verificationCredits = creditsToSet;
    account.verificationCreditsMonthly = expectedVerificationQuota;
    account.verificationCreditsResetAt = resetDate;
  } else if (now >= account.verificationCreditsResetAt) {
    const resetDate = addMonths(now, 1);

    await db
      .update(workspaces)
      .set({
        verificationCredits: expectedVerificationQuota,
        verificationCreditsMonthly: expectedVerificationQuota,
        verificationCreditsResetAt: resetDate,
      })
      .where(eq(workspaces.id, account.creditHolderId));

    account.verificationCredits = expectedVerificationQuota;
    account.verificationCreditsMonthly = expectedVerificationQuota;
    account.verificationCreditsResetAt = resetDate;
  }

  const monthlyImageCredits = getMonthlyImageCredits(account.tier, billingConfig);
  if (!account.imageCreditsResetAt) {
    const resetDate = addMonths(now, 1);

    await db
      .update(workspaces)
      .set({
        imageCreditsMonthly: monthlyImageCredits,
        imageCredits: sql`${workspaces.imageCredits} + ${monthlyImageCredits}`,
        imageCreditsResetAt: resetDate,
      })
      .where(eq(workspaces.id, account.creditHolderId));

    account.imageCredits += monthlyImageCredits;
    account.imageCreditsMonthly = monthlyImageCredits;
    account.imageCreditsResetAt = resetDate;
  } else if (now >= account.imageCreditsResetAt) {
    const resetDate = addMonths(now, 1);

    await db
      .update(workspaces)
      .set({
        imageCredits: monthlyImageCredits,
        imageCreditsMonthly: monthlyImageCredits,
        imageCreditsResetAt: resetDate,
      })
      .where(eq(workspaces.id, account.creditHolderId));

    account.imageCredits = monthlyImageCredits;
    account.imageCreditsMonthly = monthlyImageCredits;
    account.imageCreditsResetAt = resetDate;
  }

  return billingConfig;
}

async function getSyncedPlanState(req: Request): Promise<{
  account: ReturnType<typeof resolveAccount>;
  billingConfig: BillingConfig;
}> {
  const cached = (req as any).resolvedPlanState as {
    account: ReturnType<typeof resolveAccount>;
    billingConfig: BillingConfig;
  } | undefined;
  if (cached) return cached;

  const account = resolveAccount(req);
  const billingConfig = await syncWorkspacePlanState(account);
  const state = { account, billingConfig };
  (req as any).resolvedPlanState = state;
  return state;
}

function getVerificationUnits(req: Request): number | null {
  const routeBase = req.baseUrl;

  if (routeBase === '/verify-batch') {
    const references = req.body?.references;
    if (!Array.isArray(references) || references.length === 0) {
      return null;
    }
    return references.length;
  }

  if (req.method === 'GET') {
    return typeof req.query.reference === 'string' && req.query.reference.trim().length > 0 ? 1 : null;
  }

  return typeof req.body?.reference === 'string' && req.body.reference.trim().length > 0 ? 1 : null;
}

function parsePermissions(apiKeyData: any): string[] {
  const raw = apiKeyData?.permissions;
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as string[]; } catch { /* fall through */ }
  }
  return ['verify']; // Safe default
}

function hasPermission(req: Request, permission: string): boolean {
  const apiKeyData = (req as any).apiKeyData;
  const context = getWorkspaceContext(req);
  
  if (context?.source === 'dashboard') {
    return true;
  }
  
  if (apiKeyData) {
    return parsePermissions(apiKeyData).includes(permission);
  }
  
  return false;
}

export const permissionGate = (permission: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const context = getWorkspaceContext(req);
    if (!context) { next(); return; }

    const { account, billingConfig } = await getSyncedPlanState(req);

    if (permission !== 'verify') {
      if (account.tier === 'FREE') {
        const configuredForFree =
          (permission === 'verify-batch' && getBatchMaxReferences('FREE', billingConfig) > 0)
          || (req.baseUrl === '/webhooks' && getWebhookLimit('FREE', billingConfig) > 0)
          || (req.baseUrl === '/notifications' && getNotificationChannelLimit('FREE', billingConfig) > 0);
        if (!configuredForFree) {
          res.status(402).json({
            success: false,
            error: 'This feature is not included in this plan.',
            upgrade: `${APP_URL}/dashboard/billing`,
          });
          return;
        }
      }
    }

    const apiKeyData = (req as any).apiKeyData;
    if (context.source === 'api_key' && !hasPermission(req, permission)) {
      res.status(403).json({
        success: false,
        error: `This API key does not have the '${permission}' permission. Update the key's permissions in the dashboard.`,
        manageKeys: `${APP_URL}/dashboard`,
      });
      return;
    }

    next();
  };

export const proGate = permissionGate('verify-batch');

export const verifyImageGate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const context = getWorkspaceContext(req);
  if (!context) { next(); return; }

  const { account } = await getSyncedPlanState(req);

  if (account.imageCreditsMonthly <= 0) {
    res.status(402).json({
      success: false,
      error: 'Image verification is not included in this plan.',
      upgrade: `${APP_URL}/dashboard/billing`,
    });
    return;
  }

  const apiKeyData = (req as any).apiKeyData;
  if (context.source === 'api_key' && !hasPermission(req, 'verify-image')) {
    res.status(403).json({
      success: false,
      error: "This API key does not have the 'verify-image' permission.",
      manageKeys: `${APP_URL}/dashboard`,
    });
    return;
  }

  if (account.imageCredits <= 0) {
    res.status(402).json({
      success: false,
      error: 'Out of image credits. Top up at veritas.et/dashboard/billing',
      topUp: `${APP_URL}/dashboard/billing`,
    });
    return;
  }

  (req as any).resolvedAccount = account;
  next();
};

export const verifyQuotaGate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (isTrustedBillingPaymentVerification(req)) {
    next();
    return;
  }

  const context = getWorkspaceContext(req);
  if (!context) { next(); return; }

  const units = getVerificationUnits(req);
  if (!units || units <= 0) {
    next();
    return;
  }

  const { account, billingConfig } = await getSyncedPlanState(req);

  if (req.baseUrl === '/verify-batch') {
    const maxReferences = getBatchMaxReferences(account.tier, billingConfig);
    if (maxReferences <= 0) {
      next();
      return;
    }
    if (maxReferences > 0 && units > maxReferences) {
      res.status(400).json({
        success: false,
        error: `Batch size exceeds maximum of ${maxReferences} references.`,
      });
      return;
    }
  }

  if (account.tier === 'BUSINESS' && billingConfig.businessUnlimitedVerifications) {
    next();
    return;
  }

  if (account.verificationCredits < units) {
    res.status(402).json({
      success: false,
      error: `Monthly verification quota reached. ${account.verificationCredits} verification${account.verificationCredits === 1 ? '' : 's'} left.`,
      upgrade: `${APP_URL}/dashboard/billing`,
    });
    return;
  }

  const result = await db
    .update(workspaces)
    .set({
      verificationCredits: sql`${workspaces.verificationCredits} - ${units}`,
    })
    .where(
      and(
        eq(workspaces.id, account.creditHolderId),
        gte(workspaces.verificationCredits, units)
      )
    );

  next();
};
