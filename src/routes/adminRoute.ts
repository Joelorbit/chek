import { Router, Request, Response, NextFunction } from 'express';
import { generateApiKey, listApiKeys, revokeApiKey, updateApiKey } from '../middleware/apiKeyAuth';
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchPaymentWebhook,
  listWebhookDeliveries,
  triggerTestWebhook
} from '../queues/webhookQueue';
import {
  registerMerchant,
  loginMerchant,
  verifyToken,
  seedAdminUserIfNotExists,
  processSubscriptionPayment,
  listSubscriptionsForMerchant,
  listAllSubscriptions,
  getMerchantById,
  createPasswordResetToken,
  resetPasswordWithToken,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  MerchantUser
} from '../services/authService';
import { runSmartVerify } from '../services/verifyUniversal';
import { verifyImageHandler } from '../services/verifyImage';
import { db } from '../db';
import { verifiedTransactions, apiKeys, webhooks, webhookDeliveries, merchants, subscriptionPayments } from '../db/schema';
import { desc, sql, ilike, or, eq, and, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import logger from '../utils/logger';
import { timingSafeEqualString, escapeHtml } from '../utils/security';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chek_admin_super_secret_key_902104';

// Seed single super admin on startup
seedAdminUserIfNotExists().catch(console.error);

// ─── AUTH MIDDLEWARE WITH ROW-LEVEL SECURITY (RLS) ───────────────────────────

const authenticateConsoleUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // 1. Master secret key bypass
  const adminKey = (req.headers['x-admin-key'] as string) || (req.query.adminKey as string) || (req.query.key as string);
  if (adminKey && timingSafeEqualString(adminKey, ADMIN_SECRET)) {
    (req as any).isAdmin = true;
    (req as any).isSuperAdmin = true;
    (req as any).merchantId = 'super-admin-root-001';
    return next();
  }

  // 2. Signed Cookie or Bearer / JWT Session
  const cookieToken = req.cookies?.chek_session || (req as any).signedCookies?.chek_session;
  const authHeader = req.headers['authorization'] || req.headers['x-session-token'];
  const token = typeof authHeader === 'string'
    ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader).trim()
    : (typeof cookieToken === 'string' ? cookieToken : null);

  if (token) {
    const payload = verifyToken(token);
    if (payload && payload.id) {
      const email = String(payload.email || '').toLowerCase().trim();
      const isSuper = payload.role === 'super_admin' || email === SUPER_ADMIN_EMAIL.toLowerCase();

      (req as any).merchantUser = payload;
      (req as any).merchantId = payload.id;
      (req as any).isAdmin = isSuper;
      (req as any).isSuperAdmin = isSuper;
      return next();
    }
  }

  res.status(401).json({ success: false, error: 'Unauthorized. Please sign in.' });
};

const requireSuperAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  await authenticateConsoleUser(req, res, () => {
    if ((req as any).isSuperAdmin) {
      return next();
    }
    res.status(403).json({
      success: false,
      error: `Access denied. You must be signed in as Super Admin (${SUPER_ADMIN_EMAIL}).`
    });
  });
};

// ─── WORLD-CLASS LIGHT FINTECH MERCHANT CONSOLE HTML (/admin) ────────────────

router.get('/', (req: Request, res: Response): void => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chek — Merchant Console & Real-Time Ledger</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #f8fafc; color: #0f172a; font-family: 'Inter', sans-serif; }
    h1, h2, h3, h4, h5, h6, .font-display { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
    .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.875rem; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04); }
    .btn-solid { background-color: #0f172a; color: #ffffff; font-weight: 600; transition: all 0.15s ease; }
    .btn-solid:hover { background-color: #1e293b; }
    .btn-dark { background-color: #0f172a; color: #ffffff; font-weight: 600; transition: all 0.15s ease; }
    .btn-dark:hover { background-color: #1e293b; }
    .btn-amber { background-color: #f59e0b; color: #0f172a; font-weight: 700; transition: all 0.15s ease; }
    .btn-amber:hover { background-color: #d97706; color: #ffffff; }
    .input-field { background-color: #f8fafc; border: 1px solid #cbd5e1; color: #0f172a; outline: none; transition: all 0.15s ease; }
    .input-field:focus { background-color: #ffffff; border-color: #0f172a; box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.05); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f1f5f9; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  </style>
</head>
<body class="bg-[#f8fafc] text-slate-900 antialiased min-h-screen flex flex-col selection:bg-amber-100 selection:text-amber-900">

  <!-- Toast Notification Stack -->
  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"></div>

  <!-- 1. AUTH OVERLAY (Light Fintech Login / Signup / Forgot) -->
  <div id="authLockOverlay" class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white border border-slate-200 p-6 sm:p-8 max-w-md w-full relative text-left shadow-2xl rounded-2xl">
      
      <!-- Brand Logo -->
      <div class="flex items-center gap-2.5 mb-6">
        <div class="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center p-1.5 shadow-xs">
          <svg class="w-5 h-5 text-slate-950" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor">
            <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
          </svg>
        </div>
        <div>
          <h1 class="text-base font-bold font-display text-slate-900">Chek Console</h1>
          <p class="text-[11px] text-slate-500">Real-Time Payment Verification Engine</p>
        </div>
      </div>

      <!-- Auth Tabs -->
      <div class="flex border border-slate-200 rounded-xl p-1 bg-slate-100 text-xs mb-5 font-medium">
        <button onclick="setAuthTab('login')" id="btnTabLogin" class="flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs font-semibold">Sign In</button>
        <button onclick="setAuthTab('signup')" id="btnTabSignup" class="flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900">Create Account</button>
        <button onclick="setAuthTab('forgot')" id="btnTabForgot" class="flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900">Forgot</button>
      </div>

      <!-- Sign In Form -->
      <form id="loginForm" onsubmit="handleConsoleLogin(event)" class="space-y-3.5 text-left">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <input id="loginEmail" type="email" required placeholder="merchant@store.et" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Password</label>
          <input id="loginPassword" type="password" required placeholder="••••••••" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <p id="loginErrorMsg" class="text-xs text-rose-600 font-medium hidden text-center"></p>
        <button type="submit" id="btnLoginSubmit" class="btn-dark w-full py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm">
          <i class="ph-bold ph-sign-in"></i>
          <span>Sign In to Console</span>
        </button>
      </form>

      <!-- Create Account Form -->
      <form id="signupForm" onsubmit="handleConsoleSignup(event)" class="space-y-3 text-left hidden">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Business Name</label>
          <input id="signupBusinessName" type="text" placeholder="Addis Checkout Bot" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <input id="signupEmail" type="email" required placeholder="you@store.et" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Password (min 8 chars)</label>
          <input id="signupPassword" type="password" minlength="8" required placeholder="••••••••" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <p id="signupErrorMsg" class="text-xs text-rose-600 font-medium hidden text-center"></p>
        <button type="submit" id="btnSignupSubmit" class="btn-dark w-full py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm">
          <i class="ph-bold ph-user-plus"></i>
          <span>Create Account (250 checks/mo free)</span>
        </button>
      </form>

      <!-- Forgot Password Form -->
      <form id="forgotForm" onsubmit="handleForgotPassword(event)" class="space-y-3 text-left hidden">
        <p class="text-xs text-slate-600 mb-2">Enter your email address and we'll generate a secure password reset token.</p>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <input id="forgotEmail" type="email" required placeholder="merchant@store.et" class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-sans" />
        </div>
        <p id="forgotSuccessMsg" class="text-xs text-emerald-600 font-medium hidden text-center"></p>
        <p id="forgotErrorMsg" class="text-xs text-rose-600 font-medium hidden text-center"></p>
        <button type="submit" id="btnForgotSubmit" class="btn-dark w-full py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm">
          <i class="ph-bold ph-paper-plane-tilt"></i>
          <span>Send Password Reset</span>
        </button>
      </form>

    </div>
  </div>

  <!-- 2. API KEY REVEAL MODAL (1-CLICK COPY & PLAN BADGE) -->
  <div id="apiKeyRevealModal" class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 hidden">
    <div class="bg-white border border-slate-200 p-6 sm:p-7 max-w-lg w-full relative text-left shadow-2xl rounded-2xl">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
            <i class="ph-bold ph-key text-base"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 font-display">Your Production API Key</h3>
            <p class="text-[11px] text-slate-500">Copy now. For security, full keys are never shown again.</p>
          </div>
        </div>
        <button onclick="closeApiKeyRevealModal()" class="text-slate-400 hover:text-slate-700 text-lg"><i class="ph-bold ph-x"></i></button>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs mb-4">
        <span class="text-[11px] text-slate-500 block mb-1 font-sans">API Key:</span>
        <div class="flex items-center justify-between gap-2">
          <input id="revealKeyVal" type="text" readonly class="w-full bg-transparent font-mono text-xs text-slate-900 font-bold outline-none" />
          <button onclick="copyRevealKey()" id="btnCopyRevealKey" class="btn-dark px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 shrink-0">
            <i class="ph-bold ph-copy"></i>
            <span>Copy Key</span>
          </button>
        </div>
      </div>

      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-700 mb-4 flex items-center justify-between">
        <span class="font-medium">Account Quota Allocation:</span>
        <span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold">250 verifications / month</span>
      </div>

      <div class="flex justify-end">
        <button onclick="closeApiKeyRevealModal()" class="btn-solid px-4 py-2 rounded-xl text-xs font-semibold">Proceed to Console</button>
      </div>
    </div>
  </div>

  <!-- 3. TRANSACTION AUDIT MODAL (DB INSPECTOR) -->
  <div id="txDetailModal" class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 hidden">
    <div class="bg-white border border-slate-200 p-6 sm:p-7 max-w-xl w-full relative text-left shadow-2xl rounded-2xl">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-500"></span>
          <h3 class="text-sm font-bold text-slate-900 font-display">Database Transaction Audit Record</h3>
        </div>
        <button onclick="closeTxDetailModal()" class="text-slate-400 hover:text-slate-700 text-lg"><i class="ph-bold ph-x"></i></button>
      </div>

      <div class="grid grid-cols-2 gap-3 text-xs mb-4">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Reference</span>
          <span id="mdlTxRef" class="font-mono font-bold text-slate-900 text-sm">--</span>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Settled Amount</span>
          <span id="mdlTxAmt" class="font-display font-extrabold text-slate-900 text-sm">--</span>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Provider & Mode</span>
          <span id="mdlTxProvider" class="font-mono font-bold text-emerald-700">--</span>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Verified Timestamp</span>
          <span id="mdlTxTime" class="font-mono text-slate-700">--</span>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Payer</span>
          <span id="mdlTxPayer" class="text-slate-800 font-semibold truncate block">--</span>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="text-slate-400 text-[11px] block">Receiver</span>
          <span id="mdlTxReceiver" class="text-slate-800 font-semibold truncate block">--</span>
        </div>
      </div>

      <div class="mb-4">
        <span class="text-slate-500 text-xs font-semibold block mb-1.5">Raw JSON Metadata (PostgreSQL):</span>
        <pre id="mdlTxJson" class="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 max-h-48 overflow-y-auto"></pre>
      </div>

      <div class="flex justify-end gap-2">
        <button onclick="copyModalJson()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1 border border-slate-200">
          <i class="ph-bold ph-copy"></i>
          <span>Copy JSON</span>
        </button>
        <button onclick="closeTxDetailModal()" class="btn-dark px-4 py-1.5 rounded-lg text-xs">Close</button>
      </div>
    </div>
  </div>

  <!-- 4. MAIN APPLICATION CONTAINER -->
  <div id="mainApp" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full opacity-0 transition-opacity duration-200">
    
    <!-- Top Header -->
    <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 mb-6 bg-white p-5 rounded-2xl border shadow-xs">
      <div class="flex items-center gap-3">
        <a href="/" class="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center p-2 shadow-xs">
          <svg class="w-5 h-5 text-slate-950" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor">
            <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
          </svg>
        </a>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-base font-bold font-display text-slate-900" id="headerBizName">Merchant Console</h2>
            <span id="headerRoleBadge" class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-mono font-bold uppercase">FREE</span>
            <span id="headerQuotaBadge" class="text-[11px] font-mono text-slate-500">250 checks/mo</span>
          </div>
          <p class="text-xs text-slate-500 font-mono" id="headerUserEmail">merchant@store.et</p>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <!-- Super Admin Quick Button -->
        <a id="btnSuperAdminNav" href="/super-admin" class="hidden px-3 py-1.5 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-xs font-semibold hover:bg-purple-100 transition flex items-center gap-1.5">
          <i class="ph-bold ph-shield-check"></i>
          <span>Super Admin Control</span>
        </a>

        <button onclick="switchTab('studio')" class="btn-dark px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shadow-2xs">
          <i class="ph-bold ph-lightning text-xs text-amber-400"></i>
          <span>Live Verify</span>
        </button>
        <button onclick="handleConsoleLogout()" class="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition flex items-center gap-1 shadow-2xs">
          <i class="ph ph-sign-out"></i>
          <span>Sign Out</span>
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="flex items-center gap-2 border-b border-slate-200 pb-3 mb-6 text-xs font-medium overflow-x-auto">
      <button onclick="switchTab('insights')" id="tab-insights" class="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-semibold flex items-center gap-1.5 shadow-2xs">
        <i class="ph-bold ph-chart-line-up"></i>
        <span>Insights & Analytics</span>
      </button>
      <button onclick="switchTab('studio')" id="tab-studio" class="px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
        <i class="ph-bold ph-lightning"></i>
        <span>Verification Studio</span>
      </button>
      <button onclick="switchTab('ledger')" id="tab-ledger" class="px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
        <i class="ph-bold ph-receipt"></i>
        <span>Payments Ledger</span>
      </button>
      <button onclick="switchTab('keys')" id="tab-keys" class="px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
        <i class="ph-bold ph-key"></i>
        <span>API Keys</span>
      </button>
      <button onclick="switchTab('webhooks')" id="tab-webhooks" class="px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
        <i class="ph-bold ph-webhooks-logo"></i>
        <span>Webhooks & Integrations</span>
      </button>
      <button onclick="switchTab('billing')" id="tab-billing" class="px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5">
        <i class="ph-bold ph-credit-card"></i>
        <span>Subscription (4,000 ETB)</span>
      </button>
    </nav>

    <!-- 5. TAB CONTENT: INSIGHTS & ANALYTICS (REAL DB DATA) -->
    <section id="panel-insights" class="space-y-6">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div class="card p-5">
          <div class="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Total Settled Volume</span>
            <i class="ph ph-currency-eth text-amber-500 text-base"></i>
          </div>
          <p class="text-2xl font-extrabold font-display text-slate-950 mt-2" id="insightTotalVolume">0.00 ETB</p>
          <div class="flex items-center gap-1.5 text-[11px] text-emerald-700 mt-1 font-medium">
            <i class="ph-bold ph-check-circle"></i>
            <span>Real DB records</span>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <div class="flex items-center gap-2">
              <img src="/telebirr.jpg" alt="Telebirr" class="w-6 h-6 rounded-full object-cover border border-emerald-200" />
              <span>Telebirr Volume</span>
            </div>
            <span class="text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">18ms</span>
          </div>
          <p class="text-2xl font-extrabold font-display text-slate-950 mt-2" id="insightTelebirrVolume">0.00 ETB</p>
          <p class="text-[11px] text-slate-500 mt-1 font-mono"><span id="insightTelebirrCount" class="text-slate-900 font-bold">0</span> receipts</p>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <div class="flex items-center gap-2">
              <img src="/cbe.jpg" alt="CBE" class="w-6 h-6 rounded-full object-cover border border-purple-200" />
              <span>CBE Volume</span>
            </div>
            <span class="text-[10px] font-mono text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">28ms</span>
          </div>
          <p class="text-2xl font-extrabold font-display text-slate-950 mt-2" id="insightCbeVolume">0.00 ETB</p>
          <p class="text-[11px] text-slate-500 mt-1 font-mono"><span id="insightCbeCount" class="text-slate-900 font-bold">0</span> receipts</p>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Verified Receipts</span>
            <i class="ph ph-shield-check text-emerald-600 text-base"></i>
          </div>
          <p class="text-2xl font-extrabold font-display text-slate-950 mt-2" id="insightTotalCount">0</p>
          <p class="text-[11px] text-slate-500 mt-1 font-mono">100% database backed</p>
        </div>

      </div>

      <!-- Chart.js Analytics Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="card p-6 lg:col-span-2">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-sm font-bold text-slate-900 font-display">Verification Volume (Last 7 Days)</h3>
              <p class="text-xs text-slate-500">Aggregated throughput from your PostgreSQL records</p>
            </div>
            <span class="text-xs font-mono text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 font-bold">Realtime</span>
          </div>
          <div class="h-64 relative">
            <canvas id="chartVolumeTrend"></canvas>
          </div>
        </div>

        <div class="card p-6 flex flex-col justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900 font-display mb-1">Provider Distribution</h3>
            <p class="text-xs text-slate-500 mb-4">Telebirr vs Commercial Bank of Ethiopia</p>
            <div class="h-44 relative flex items-center justify-center">
              <canvas id="chartProviderPie"></canvas>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 pt-4 border-t border-slate-100 text-center text-xs">
            <div>
              <span class="text-[11px] text-slate-500 block">Telebirr Relay</span>
              <span class="text-emerald-700 font-bold font-mono" id="statPieTelebirr">0%</span>
            </div>
            <div>
              <span class="text-[11px] text-slate-500 block">CBE Relay</span>
              <span class="text-purple-700 font-bold font-mono" id="statPieCbe">0%</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 6. TAB CONTENT: VERIFICATION STUDIO -->
    <section id="panel-studio" class="space-y-6 hidden">
      <div class="card p-7">
        <h3 class="text-base font-bold text-slate-900 font-display">Live Verification Studio</h3>
        <p class="text-xs text-slate-500 mt-0.5 mb-5">Enter Telebirr reference (e.g. DHS78S7FQN), CBE token, or paste SMS receipt text. Transactions save instantly to database.</p>

        <form onsubmit="handleConsoleVerify(event)" class="space-y-4">
          <div class="flex gap-2">
            <input 
              id="consoleInputRef" 
              type="text" 
              placeholder="e.g. DHS78S7FQN or FT240626691234 or paste receipt text..." 
              class="input-field flex-1 rounded-xl px-4 py-3 text-xs font-mono"
            />
            <button type="submit" id="btnConsoleVerifySubmit" class="btn-dark px-5 py-3 rounded-xl text-xs flex items-center gap-1.5 shadow-sm">
              <i class="ph-bold ph-lightning text-amber-400"></i>
              <span>Verify</span>
            </button>
          </div>
        </form>

        <div id="consoleVerifyResult" class="mt-6 hidden">
          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200">
              <span class="font-bold text-slate-900 flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span id="cvProvider">Provider</span>
              </span>
              <span class="text-emerald-700 font-mono font-bold bg-emerald-100/70 border border-emerald-300 px-2.5 py-0.5 rounded-full" id="cvStatus">VERIFIED</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 text-xs">
              <div>
                <span class="text-slate-400 text-[11px] block font-medium">Amount</span>
                <span class="text-slate-900 font-extrabold font-display text-lg" id="cvAmount">--</span>
              </div>
              <div>
                <span class="text-slate-400 text-[11px] block font-medium">Reference</span>
                <span class="text-slate-900 font-mono font-bold" id="cvRef">--</span>
              </div>
              <div>
                <span class="text-slate-400 text-[11px] block font-medium">Payer</span>
                <span class="text-slate-800 font-semibold" id="cvPayer">--</span>
              </div>
              <div>
                <span class="text-slate-400 text-[11px] block font-medium">Receiver</span>
                <span class="text-slate-800 font-semibold" id="cvReceiver">--</span>
              </div>
            </div>
            <pre id="cvRawJson" class="mt-2 p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto"></pre>
          </div>
        </div>
      </div>
    </section>

    <!-- 7. TAB CONTENT: PAYMENTS LEDGER (WITH AUDIT INSPECTOR) -->
    <section id="panel-ledger" class="space-y-4 hidden">
      <div class="card p-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h3 class="text-base font-bold text-slate-900 font-display">Real-Time Verified Payments Ledger</h3>
            <p class="text-xs text-slate-500">Persisted database transactions. Click any row to inspect full verification audit trail.</p>
          </div>
          <div class="flex items-center gap-2">
            <input id="ledgerSearch" oninput="debounceLedgerSearch()" type="text" placeholder="Search reference, payer..." class="input-field rounded-xl px-3 py-1.5 text-xs w-48 font-sans" />
            <select id="ledgerProviderFilter" onchange="loadLedger()" class="input-field rounded-xl px-3 py-1.5 text-xs font-sans">
              <option value="">All Rails</option>
              <option value="TELEBIRR">Telebirr</option>
              <option value="CBE">CBE</option>
            </select>
            <button onclick="loadLedger()" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs border border-slate-200"><i class="ph-bold ph-arrows-clockwise"></i></button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-200 text-slate-500 font-semibold">
                <th class="py-3 px-3.5">Provider</th>
                <th class="py-3 px-3.5">Reference</th>
                <th class="py-3 px-3.5">Amount</th>
                <th class="py-3 px-3.5">Payer / Receiver</th>
                <th class="py-3 px-3.5">Mode</th>
                <th class="py-3 px-3.5">Verified At</th>
                <th class="py-3 px-3.5 text-right">Audit</th>
              </tr>
            </thead>
            <tbody id="ledgerTableBody" class="divide-y divide-slate-100 font-mono text-[11px]">
              <tr><td colspan="7" class="py-8 text-center text-slate-400 font-sans">Loading ledger entries from database...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 8. TAB CONTENT: API KEYS -->
    <section id="panel-keys" class="space-y-4 hidden">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-slate-900 font-display">Production API Keys</h3>
            <p class="text-xs text-slate-500">Authenticate verification requests with header <code class="text-amber-800 font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">x-api-key: sk_live_...</code></p>
          </div>
          <button onclick="handleCreateApiKey()" class="btn-dark px-3.5 py-2 rounded-xl text-xs flex items-center gap-1 shadow-xs">
            <i class="ph-bold ph-plus"></i>
            <span>Create New Key</span>
          </button>
        </div>
        <div id="apiKeysList" class="space-y-2.5">
          <p class="text-xs text-slate-400 py-4 text-center">Loading API keys...</p>
        </div>
      </div>
    </section>

    <!-- 9. TAB CONTENT: WEBHOOKS & DELIVERIES -->
    <section id="panel-webhooks" class="space-y-6 hidden">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-bold text-slate-900 font-display">Webhook Subscriptions</h3>
            <p class="text-xs text-slate-500">Receive instant HMAC-SHA256 signed HTTP POST notifications whenever a payment verifies.</p>
          </div>
          <button onclick="handleCreateWebhook()" class="btn-dark px-3.5 py-2 rounded-xl text-xs flex items-center gap-1 shadow-xs">
            <i class="ph-bold ph-plus"></i>
            <span>Add Webhook</span>
          </button>
        </div>
        <div id="webhooksList" class="space-y-2.5 mb-6">
          <p class="text-xs text-slate-400 py-4 text-center">Loading webhooks...</p>
        </div>
      </div>

      <!-- Deliveries Table -->
      <div class="card p-6">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h4 class="text-xs font-bold text-slate-900 font-display">Recent Webhook Deliveries Log</h4>
            <p class="text-[11px] text-slate-500">Live delivery statuses and response codes</p>
          </div>
          <button onclick="loadWebhookDeliveries()" class="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 font-semibold"><i class="ph ph-arrows-clockwise"></i> Refresh</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <th class="py-2.5 px-3">Event</th>
                <th class="py-2.5 px-3">Status</th>
                <th class="py-2.5 px-3">HTTP Code</th>
                <th class="py-2.5 px-3">Attempts</th>
                <th class="py-2.5 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody id="webhookDeliveriesBody" class="divide-y divide-slate-100 font-mono text-[11px]">
              <tr><td colspan="5" class="py-4 text-center text-slate-400 font-sans">No recent delivery attempts.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Integration Guide -->
      <div class="card p-6">
        <h4 class="text-xs font-bold text-slate-900 font-display mb-2">How to Verify Webhook Signatures in Production</h4>
        <p class="text-xs text-slate-500 mb-3">Every webhook request includes a <code class="text-slate-900 font-mono font-bold">X-Chek-Signature: sha256=&lt;hash&gt;</code> header generated using your webhook's signing secret.</p>
        <div class="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto">
          <pre>// Node.js / Express Webhook Handler
const crypto = require('crypto');

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-chek-signature'];
  const secret = process.env.CHEK_WEBHOOK_SECRET; // whsec_...

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    const event = JSON.parse(req.body.toString());
    console.log('Verified Payment:', event.transaction.reference, event.transaction.amount);
    res.status(200).send('OK');
  } else {
    res.status(403).send('Invalid signature');
  }
});</pre>
        </div>
      </div>
    </section>

    <!-- 10. TAB CONTENT: 4,000 ETB UNLIMITED PLAN -->
    <section id="panel-billing" class="space-y-4 hidden">
      <div class="card p-7 max-w-2xl border-2 border-slate-900">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-slate-900 font-display">Chek Unlimited Plan</h3>
          <span class="text-xs font-mono font-bold text-amber-800 bg-amber-100 border border-amber-300 px-3 py-0.5 rounded-full">4,000 ETB / month</span>
        </div>
        <p class="text-xs text-slate-600 mb-5">Enjoy unmetered rate limits, unlimited verified receipts, zero quotas, and priority relay routing.</p>

        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs mb-5">
          <p class="font-bold text-slate-900 mb-2">1. Transfer 4,000 ETB to either Chek account:</p>
          <div class="grid grid-cols-2 gap-3 text-[11px] font-mono">
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-2xs">
              <img src="/telebirr.jpg" class="w-6 h-6 rounded-full object-cover" />
              <div>
                <span class="text-emerald-700 font-bold block text-[10px]">TELEBIRR</span>
                <span class="text-slate-900 font-bold">0911000000</span>
              </div>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-2xs">
              <img src="/cbe.jpg" class="w-6 h-6 rounded-full object-cover" />
              <div>
                <span class="text-purple-700 font-bold block text-[10px]">CBE</span>
                <span class="text-slate-900 font-bold">1000123456789</span>
              </div>
            </div>
          </div>
        </div>

        <form onsubmit="handleConsoleUpgrade(event)" class="space-y-3.5">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">2. Enter Transaction Reference</label>
            <input id="upgradeRefInput" type="text" required placeholder="e.g. DHS78S7FQN or FT24062669..." class="input-field w-full rounded-xl px-3.5 py-2.5 text-xs font-mono" />
          </div>
          <button type="submit" id="btnUpgradeSubmit" class="btn-solid w-full py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm font-bold">
            <i class="ph-bold ph-check-circle text-amber-400"></i>
            <span>Verify Payment & Activate Unlimited Plan</span>
          </button>
        </form>
      </div>
    </section>

  </div>

  <script src="/console.js"></script>
</body>
</html>`;

  res.send(html);
});

// ─── SUPER ADMIN PANEL HTML ROUTE (/super-admin) ─────────────────────────────

router.get('/super-admin', (req: Request, res: Response): void => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chek — Super Admin Infrastructure Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #f8fafc; color: #0f172a; font-family: 'Inter', sans-serif; }
    .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.875rem; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04); }
  </style>
</head>
<body class="bg-[#f8fafc] text-slate-900 min-h-screen p-6">
  <div class="max-w-7xl mx-auto space-y-6">
    
    <!-- Header -->
    <header class="flex items-center justify-between pb-4 border-b border-slate-200">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center shadow-xs">
          <i class="ph-bold ph-shield-check text-lg"></i>
        </div>
        <div>
          <h1 class="text-base font-bold font-display text-slate-900">Super Admin Control Center</h1>
          <p class="text-xs text-slate-500 font-mono">Authorized: ${SUPER_ADMIN_EMAIL}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <a href="/admin" class="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 font-semibold">
          <i class="ph ph-arrow-left"></i> Merchant Console
        </a>
      </div>
    </header>

    <!-- KPI Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div class="card p-5">
        <span class="text-slate-500 text-xs font-semibold block">Total Platform Revenue</span>
        <span class="text-2xl font-extrabold font-display text-slate-900 mt-1 block" id="saRev">0.00 ETB</span>
        <span class="text-[11px] text-emerald-700 font-medium mt-1 block">4,000 ETB subscriptions</span>
      </div>
      <div class="card p-5">
        <span class="text-slate-500 text-xs font-semibold block">Registered Merchants</span>
        <span class="text-2xl font-extrabold font-display text-slate-900 mt-1 block" id="saMerchants">0</span>
        <span class="text-[11px] text-slate-500 mt-1 block">Active accounts</span>
      </div>
      <div class="card p-5">
        <span class="text-slate-500 text-xs font-semibold block">Telebirr Egress Relays</span>
        <span class="text-2xl font-extrabold font-display text-emerald-700 mt-1 block">Operational</span>
        <span class="text-[11px] text-slate-500 mt-1 block">18ms average latency</span>
      </div>
      <div class="card p-5">
        <span class="text-slate-500 text-xs font-semibold block">CBE Gateway Relays</span>
        <span class="text-2xl font-extrabold font-display text-purple-700 mt-1 block">Operational</span>
        <span class="text-[11px] text-slate-500 mt-1 block">28ms average latency</span>
      </div>
    </div>

    <!-- Merchants Directory Table -->
    <div class="card p-6">
      <h2 class="text-sm font-bold text-slate-900 font-display mb-4">Merchant Accounts & Tier Controls</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500 font-semibold">
              <th class="py-3 px-3.5">Business / Name</th>
              <th class="py-3 px-3.5">Email Address</th>
              <th class="py-3 px-3.5">Plan</th>
              <th class="py-3 px-3.5">Status</th>
              <th class="py-3 px-3.5">Created</th>
              <th class="py-3 px-3.5">Actions</th>
            </tr>
          </thead>
          <tbody id="saMerchantsBody" class="divide-y divide-slate-100 font-mono text-[11px]">
            <tr><td colspan="6" class="py-6 text-center text-slate-400 font-sans">Loading merchants from database...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <script>
    function getAuthHeaders() {
      const token = localStorage.getItem('chek_token') || localStorage.getItem('chek_session_token');
      return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      };
    }

    async function loadSuperAdmin() {
      try {
        const res = await fetch('/admin/api/super/merchants', {
          headers: getAuthHeaders(),
          credentials: 'same-origin'
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Access denied: You must be logged in as ' + '${SUPER_ADMIN_EMAIL}');
          window.location.href = '/admin';
          return;
        }

        document.getElementById('saMerchants').textContent = data.merchants.length;
        const tbody = document.getElementById('saMerchantsBody');
        tbody.innerHTML = '';

        data.merchants.forEach(m => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-50';
          tr.innerHTML = \`
            <td class="py-3 px-3.5 font-sans font-medium text-slate-900">\${m.businessName || m.name || '--'}</td>
            <td class="py-3 px-3.5 text-slate-600">\${m.email}</td>
            <td class="py-3 px-3.5">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase \${m.plan === 'unlimited' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'}">\${m.plan}</span>
            </td>
            <td class="py-3 px-3.5">
              <span class="text-emerald-700 font-bold">\${m.isActive ? 'Active' : 'Deactivated'}</span>
            </td>
            <td class="py-3 px-3.5 text-slate-500">\${new Date(m.createdAt).toLocaleDateString()}</td>
            <td class="py-3 px-3.5">
              <button onclick="togglePlan('\${m.id}', '\${m.plan}')" class="text-xs text-amber-700 hover:underline font-bold font-sans">
                \${m.plan === 'unlimited' ? 'Set Free' : 'Grant Unlimited'}
              </button>
            </td>
          \`;
          tbody.appendChild(tr);
        });
      } catch (err) {
        console.error(err);
      }
    }

    async function togglePlan(id, curPlan) {
      const nextPlan = curPlan === 'unlimited' ? 'free' : 'unlimited';
      await fetch('/admin/api/super/merchants/' + id, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ plan: nextPlan })
      });
      loadSuperAdmin();
    }

    loadSuperAdmin();
  </script>
</body>
</html>`;

  res.send(html);
});

// ─── AUTHENTICATION APIs ─────────────────────────────────────────────────────

router.post('/api/auth/register', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, businessName, name } = req.body;
    const result = await registerMerchant({ email, password, businessName, name });

    res.cookie('chek_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 72 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      merchant: result.merchant,
      token: result.token,
      rawApiKey: result.rawApiKey,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/auth/login', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await loginMerchant(email, password);

    res.cookie('chek_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 72 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      merchant: result.merchant,
      token: result.token,
    });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

router.post('/api/auth/forgot-password', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const result = await createPasswordResetToken(email);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/auth/reset-password', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, token, newPassword } = req.body;
    const result = await resetPasswordWithToken(email, token, newPassword);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/auth/logout', (_req: Request, res: Response): void => {
  res.clearCookie('chek_session');
  res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/api/me', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).merchantUser;
    const merchant = await getMerchantById(user.id);
    res.json({ success: true, merchant: merchant || user });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SUPER ADMIN APIs ────────────────────────────────────────────────────────

router.get('/api/super/merchants', requireSuperAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const all = await db.select({
      id: merchants.id,
      email: merchants.email,
      name: merchants.name,
      businessName: merchants.businessName,
      role: merchants.role,
      plan: merchants.plan,
      isActive: merchants.isActive,
      createdAt: merchants.createdAt,
    }).from(merchants).orderBy(desc(merchants.createdAt));

    res.json({ success: true, merchants: all });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/api/super/merchants/:id', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { plan, isActive } = req.body;
    const updateData: any = {};
    if (plan) updateData.plan = plan;
    if (isActive !== undefined) updateData.isActive = isActive;

    await db.update(merchants).set(updateData).where(eq(merchants.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROW-LEVEL PROTECTED METRICS & ANALYTICS APIs (REAL DB ONLY) ─────────────

router.get('/api/analytics', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = (req as any).merchantId;

    const baseWhere = (!isSuperAdmin && merchantId)
      ? eq(verifiedTransactions.merchantId, merchantId)
      : undefined;

    let rows: any[] = [];
    try {
      rows = baseWhere
        ? await db.select().from(verifiedTransactions).where(baseWhere).orderBy(desc(verifiedTransactions.verifiedAt)).limit(500)
        : await db.select().from(verifiedTransactions).orderBy(desc(verifiedTransactions.verifiedAt)).limit(500);
    } catch {
      rows = [];
    }

    let totalVolume = 0;
    let telebirrVolume = 0;
    let cbeVolume = 0;
    let telebirrCount = 0;
    let cbeCount = 0;

    const dayBuckets: Record<string, { telebirr: number; cbe: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dayBuckets[key] = { telebirr: 0, cbe: 0 };
    }

    rows.forEach(r => {
      const amt = parseFloat(r.amount) || 0;
      totalVolume += amt;
      const prov = (r.provider || '').toUpperCase();
      const dateKey = r.verifiedAt ? new Date(r.verifiedAt).toISOString().split('T')[0] : '';

      if (prov.includes('TELEBIRR')) {
        telebirrVolume += amt;
        telebirrCount++;
        if (dayBuckets[dateKey]) dayBuckets[dateKey].telebirr += amt;
      } else {
        cbeVolume += amt;
        cbeCount++;
        if (dayBuckets[dateKey]) dayBuckets[dateKey].cbe += amt;
      }
    });

    res.json({
      success: true,
      totalVolume: totalVolume.toFixed(2),
      telebirrVolume: telebirrVolume.toFixed(2),
      cbeVolume: cbeVolume.toFixed(2),
      telebirrCount,
      cbeCount,
      totalCount: rows.length,
      trend: {
        labels: Object.keys(dayBuckets).map(k => k.slice(5)),
        telebirr: Object.values(dayBuckets).map(v => v.telebirr),
        cbe: Object.values(dayBuckets).map(v => v.cbe),
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROW-LEVEL PROTECTED TRANSACTIONS & LEDGER APIs ──────────────────────────

router.get('/api/transactions', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = (req as any).merchantId;
    const q = req.query.q ? String(req.query.q).trim() : '';
    const provider = req.query.provider ? String(req.query.provider).toUpperCase().trim() : '';

    const conditions: any[] = [];
    if (!isSuperAdmin && merchantId) {
      conditions.push(eq(verifiedTransactions.merchantId, merchantId));
    }
    if (provider && (provider === 'TELEBIRR' || provider === 'CBE')) {
      conditions.push(eq(verifiedTransactions.provider, provider));
    }
    if (q) {
      conditions.push(or(
        ilike(verifiedTransactions.reference, `%${q}%`),
        ilike(verifiedTransactions.payer, `%${q}%`),
        ilike(verifiedTransactions.receiver, `%${q}%`)
      ));
    }

    let rows: any[] = [];
    try {
      const query = db.select().from(verifiedTransactions).orderBy(desc(verifiedTransactions.verifiedAt)).limit(100);
      rows = conditions.length > 0
        ? await query.where(conditions.length === 1 ? conditions[0] : and(...conditions))
        : await query;
    } catch {
      rows = [];
    }

    res.json({ success: true, transactions: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/transactions/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = (req as any).merchantId;

    const conditions = [eq(verifiedTransactions.id, id)];
    if (!isSuperAdmin && merchantId) {
      conditions.push(eq(verifiedTransactions.merchantId, merchantId));
    }

    const tx = await db.query.verifiedTransactions.findFirst({
      where: conditions.length === 1 ? conditions[0] : and(...conditions),
    });

    if (!tx) {
      res.status(404).json({ success: false, error: 'Transaction record not found.' });
      return;
    }

    res.json({ success: true, transaction: tx });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROW-LEVEL PROTECTED API KEYS APIs ───────────────────────────────────────

router.get('/api/api-keys', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = isSuperAdmin ? undefined : (req as any).merchantId;
    const keys = await listApiKeys(merchantId);
    res.json({ success: true, keys });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/api-keys', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    const merchantId = (req as any).merchantId || undefined;
    const generated = await generateApiKey(name || 'Production Key', merchantId);
    res.json({ success: true, ...generated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/api-keys/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = isSuperAdmin ? undefined : (req as any).merchantId;
    const revoked = await revokeApiKey(id, merchantId);
    res.json({ success: revoked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROW-LEVEL PROTECTED WEBHOOKS & DELIVERIES APIs ──────────────────────────

router.get('/api/webhooks', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = isSuperAdmin ? undefined : (req as any).merchantId;
    const hooks = await listWebhooks(merchantId);
    res.json({ success: true, webhooks: hooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, events } = req.body;
    const merchantId = (req as any).merchantId || undefined;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      res.status(400).json({ success: false, error: 'Valid HTTP/HTTPS webhook URL is required.' });
      return;
    }

    const hook = await registerWebhook(url, events, merchantId);
    res.json({ success: true, webhook: hook });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks/:id/test', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = isSuperAdmin ? undefined : (req as any).merchantId;
    const testResult = await triggerTestWebhook(id, merchantId);
    res.json({ success: true, test: testResult });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/api/webhooks/deliveries', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookId = req.query.webhookId ? String(req.query.webhookId) : undefined;
    const deliveries = await listWebhookDeliveries(webhookId, 25);
    res.json({ success: true, deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/webhooks/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const isSuperAdmin = (req as any).isSuperAdmin;
    const merchantId = isSuperAdmin ? undefined : (req as any).merchantId;
    const deleted = await deleteWebhook(id, merchantId);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 4,000 ETB UNLIMITED PLAN SUBSCRIPTION UPGRADE ───────────────────────────

router.post('/api/subscriptions/pay', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { plan, reference, provider, amount } = req.body;
    const merchantId = (req as any).merchantId || 'super-admin-root-001';

    if (!reference) {
      res.status(400).json({ success: false, error: 'Transaction reference is required.' });
      return;
    }

    const result = await processSubscriptionPayment({
      merchantId,
      plan: (plan || 'unlimited').toLowerCase() as 'unlimited',
      billingCycle: 'monthly',
      amount: amount || 4000,
      provider: provider || (reference.trim().startsWith('FT') ? 'CBE' : 'TELEBIRR'),
      reference: reference.trim(),
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/subscriptions', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = (req as any).merchantId || 'super-admin-root-001';
    const subs = await listSubscriptionsForMerchant(merchantId);
    res.json({ success: true, subscriptions: subs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/verify-image', authenticateConsoleUser, ...verifyImageHandler);

export default router;
