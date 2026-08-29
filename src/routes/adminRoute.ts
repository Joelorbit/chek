import { Router, Request, Response, NextFunction } from 'express';
import { generateApiKey, listApiKeys, revokeApiKey, updateApiKey } from '../middleware/apiKeyAuth';
import { registerWebhook, listWebhooks, deleteWebhook, dispatchPaymentWebhook, listWebhookDeliveries } from '../queues/webhookQueue';
import { registerMerchant, loginMerchant, verifyToken, seedAdminUserIfNotExists, MerchantUser } from '../services/authService';
import { runSmartVerify } from '../services/verifyUniversal';
import { db } from '../db';
import { verifiedTransactions, apiKeys, webhooks, webhookDeliveries, merchants } from '../db/schema';
import { desc, sql, ilike, or, eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import logger from '../utils/logger';

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chek_admin_super_secret_key_902104';

// Seed super admin on boot
seedAdminUserIfNotExists().catch(console.error);

// ─── AUTH MIDDLEWARE FOR ADMIN / MERCHANT CONSOLE ────────────────────────────

const authenticateConsoleUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // 1. Check Master Admin Key
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey || req.query.key;
  if (adminKey === ADMIN_SECRET) {
    (req as any).isAdmin = true;
    return next();
  }

  // 2. Check JWT Bearer / Session Token
  const authHeader = req.headers['authorization'] || req.headers['x-session-token'];
  const token = typeof authHeader === 'string'
    ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader).trim()
    : null;

  if (token) {
    const payload = verifyToken(token);
    if (payload && payload.id) {
      (req as any).merchantUser = payload;
      (req as any).merchantId = payload.id;
      if (payload.role === 'admin') (req as any).isAdmin = true;
      return next();
    }
  }

  res.status(401).json({ success: false, error: 'Unauthorized. Please log in or provide valid admin key.' });
};

// ─── HTML DASHBOARD UI ───────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response): void => {
  const urlKey = (req.query.key as string) || (req.query.adminKey as string) || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chek — Ethiopian Payment Verification Hub</title>
  
  <!-- Fonts: Outfit + Plus Jakarta Sans + JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Phosphor Icons -->
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            amber: {
              50: '#fffbeb',
              100: '#fef3c7',
              500: '#f59e0b',
              600: '#d97706',
              700: '#b45309',
            },
            brand: {
              50: '#ecfdf5',
              500: '#10b981',
              600: '#059669',
            }
          },
          fontFamily: {
            heading: ['Outfit', 'sans-serif'],
            body: ['Plus Jakarta Sans', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #ffffff; color: #09090b; }
    h1, h2, h3, h4, h5, h6, .font-heading { font-family: 'Outfit', sans-serif; }
    code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
    
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f4f4f5; }
    ::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: #a1a1aa; }
  </style>
</head>
<body class="bg-white text-zinc-900 antialiased min-h-screen selection:bg-amber-500/20 selection:text-amber-900">

  <!-- COMMAND PALETTE MODAL (Ctrl + K) -->
  <div id="cmdPaletteOverlay" class="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-sm flex items-start justify-center pt-20 p-4 hidden">
    <div class="bg-white border border-zinc-200 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
      <div class="flex items-center px-4 border-b border-zinc-200">
        <i class="ph ph-magnifying-glass text-zinc-400 text-lg mr-2"></i>
        <input id="cmdPaletteInput" oninput="filterConsoleCmdResults()" type="text" placeholder="Type a command, action, or search references..." class="w-full py-3.5 text-xs text-zinc-900 outline-none font-sans bg-transparent" />
        <span class="text-[10px] font-mono text-zinc-400 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md">ESC</span>
      </div>
      
      <div id="cmdResultsList" class="p-2 max-h-80 overflow-y-auto space-y-1 text-xs">
        <button onclick="switchTab('studio'); closeCmdPalette();" class="cmd-item w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-left">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-lightning text-amber-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Verify Payment Reference / SMS</p>
              <p class="text-[11px] text-zinc-500">Open live verification studio</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Action</span>
        </button>

        <button onclick="switchTab('apikeys'); closeCmdPalette();" class="cmd-item w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-left">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-key text-amber-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Generate New API Key</p>
              <p class="text-[11px] text-zinc-500">Create client integration key</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Action</span>
        </button>

        <button onclick="switchTab('payments'); closeCmdPalette();" class="cmd-item w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-left">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-table text-sky-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Payments Ledger & Feed</p>
              <p class="text-[11px] text-zinc-500">Search and filter verified transactions</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">View</span>
        </button>

        <button onclick="exportPaymentsCsv(); closeCmdPalette();" class="cmd-item w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-left">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-download-simple text-emerald-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Export Payments to CSV</p>
              <p class="text-[11px] text-zinc-500">Download Excel / accounting spreadsheet</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Export</span>
        </button>

        <button onclick="switchTab('webhooks'); closeCmdPalette();" class="cmd-item w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-left">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-webhooks-logo text-purple-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Webhooks & Delivery Logs</p>
              <p class="text-[11px] text-zinc-500">Inspect real-time HTTP delivery logs</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">View</span>
        </button>

        <a href="/docs" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-book-open text-blue-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Open API Documentation (/docs)</p>
              <p class="text-[11px] text-zinc-500">Complete Telegram, Node.js & Python SDK docs</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Docs</span>
        </a>
      </div>
    </div>
  </div>

  <!-- AUTH MODAL OVERLAY (Login / Register / Secret Key) -->
  <div id="authLockOverlay" class="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-md flex items-center justify-center p-4">
    <div class="bg-white border border-zinc-200 p-8 rounded-3xl max-w-md w-full shadow-2xl text-center">
      
      <div class="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-sm mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="w-7 h-7 fill-current text-amber-600">
          <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
        </svg>
      </div>

      <h2 class="text-2xl font-bold font-heading text-zinc-900" id="authModalTitle">Welcome to Chek Console</h2>
      <p class="text-xs text-zinc-500 mt-1 mb-5" id="authModalSubtitle">Sign in to your merchant account or enter your admin key.</p>

      <!-- Auth Tabs: Sign In / Register / Secret Key -->
      <div class="flex bg-zinc-100 p-1 rounded-xl mb-4 text-xs font-semibold text-zinc-600">
        <button onclick="setAuthMode('login')" id="btnAuthTabLogin" class="flex-1 py-1.5 rounded-lg bg-white shadow-sm text-zinc-900">Sign In</button>
        <button onclick="setAuthMode('register')" id="btnAuthTabRegister" class="flex-1 py-1.5 rounded-lg hover:text-zinc-900">Register</button>
        <button onclick="setAuthMode('key')" id="btnAuthTabKey" class="flex-1 py-1.5 rounded-lg hover:text-zinc-900">Admin Key</button>
      </div>

      <!-- FORM: Sign In -->
      <form id="formLogin" onsubmit="handleLogin(event)" class="space-y-3">
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Email</label>
          <input id="loginEmail" type="email" required placeholder="admin@chek.et" value="admin@chek.et" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Password</label>
          <input id="loginPass" type="password" required placeholder="••••••••" value="admin123" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <p id="loginErrorMsg" class="text-xs text-rose-600 font-medium hidden text-left"></p>
        <button type="submit" class="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 py-2.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center justify-center gap-1.5">
          <span>Sign In to Dashboard</span>
          <i class="ph-bold ph-arrow-right"></i>
        </button>
      </form>

      <!-- FORM: Register -->
      <form id="formRegister" onsubmit="handleRegister(event)" class="space-y-3 hidden">
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Business Name</label>
          <input id="regBizName" type="text" required placeholder="My Store / Bot" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Work Email</label>
          <input id="regEmail" type="email" required placeholder="you@company.com" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Password</label>
          <input id="regPass" type="password" required placeholder="Minimum 6 characters" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <p id="regErrorMsg" class="text-xs text-rose-600 font-medium hidden text-left"></p>
        <button type="submit" class="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 py-2.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center justify-center gap-1.5">
          <span>Create Free Account</span>
          <i class="ph-bold ph-arrow-right"></i>
        </button>
      </form>

      <!-- FORM: Admin Key Bypass -->
      <form id="formKey" onsubmit="handleKeyLogin(event)" class="space-y-3 hidden">
        <div class="text-left">
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Admin Master Secret Key</label>
          <input id="keyInput" type="password" placeholder="chek_admin_super_secret_key_..." value="${urlKey || 'chek_admin_super_secret_key_902104'}" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 font-mono outline-none focus:border-amber-500 focus:bg-white" />
        </div>
        <p id="keyErrorMsg" class="text-xs text-rose-600 font-medium hidden text-left">Invalid admin secret key.</p>
        <button type="submit" class="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 py-2.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center justify-center gap-1.5">
          <span>Unlock with Key</span>
          <i class="ph-bold ph-arrow-right"></i>
        </button>
      </form>
      
    </div>
  </div>

  <!-- EDIT API KEY MODAL -->
  <div id="editKeyModal" class="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white border border-zinc-200 p-6 rounded-2xl max-w-md w-full shadow-2xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold font-heading text-zinc-900 flex items-center gap-2">
          <i class="ph-bold ph-pencil-simple text-amber-600"></i>
          <span>Edit API Key</span>
        </h3>
        <button onclick="closeEditModal()" class="text-zinc-400 hover:text-zinc-700"><i class="ph ph-x text-lg"></i></button>
      </div>
      <input type="hidden" id="editKeyId" />
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Application Name</label>
          <input id="editKeyName" type="text" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-zinc-700 mb-1">Status</label>
          <select id="editKeyStatus" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 font-sans focus:bg-white">
            <option value="true">Active (Enabled)</option>
            <option value="false">Revoked (Disabled)</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeEditModal()" class="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold rounded-xl transition">Cancel</button>
          <button onclick="saveKeyEdit()" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-xl shadow-sm transition">Save Changes</button>
        </div>
      </div>
    </div>
  </div>

  <!-- TRANSACTION DETAIL MODAL -->
  <div id="txDetailModal" class="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white border border-zinc-200 p-6 rounded-2xl max-w-lg w-full shadow-2xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold font-heading text-zinc-900 flex items-center gap-2">
          <i class="ph-bold ph-receipt text-amber-600"></i>
          <span>Transaction Inspector</span>
        </h3>
        <button onclick="closeTxModal()" class="text-zinc-400 hover:text-zinc-700"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div id="txDetailContent" class="bg-zinc-50 border border-zinc-200 p-4 rounded-xl font-mono text-xs text-zinc-800 overflow-x-auto max-h-96">
      </div>
      <div class="flex justify-end pt-4">
        <button onclick="closeTxModal()" class="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold rounded-xl">Close</button>
      </div>
    </div>
  </div>

  <!-- MAIN APPLICATION LAYOUT -->
  <div id="mainApp" class="max-w-7xl mx-auto p-4 md:p-8 opacity-0 transition-opacity duration-300">
    
    <!-- Top Header with Brand & Merchant Switcher -->
    <header class="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-8 border-b border-zinc-200 gap-4">
      <div class="flex items-center gap-3.5">
        <div class="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center font-bold shadow-sm text-amber-600">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="w-6 h-6 fill-current text-amber-600">
            <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
          </svg>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-bold font-heading tracking-tight text-zinc-900" id="headerBizName">Chek Hub</h1>
            <span class="text-[11px] font-mono bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-semibold" id="headerRoleBadge">PRO</span>
          </div>
          <p class="text-xs text-zinc-500 font-medium" id="headerUserEmail">Telebirr • Commercial Bank of Ethiopia (CBE)</p>
        </div>
      </div>

      <!-- Quick Command Search Trigger & Action Bar -->
      <div class="flex items-center gap-2.5">
        <button onclick="openCmdPalette()" class="flex items-center gap-3 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 px-3 py-1.5 rounded-xl text-xs text-zinc-500 transition shadow-sm font-medium">
          <span class="flex items-center gap-1.5">
            <i class="ph ph-magnifying-glass text-sm"></i>
            <span>Quick search / actions...</span>
          </span>
          <kbd class="font-mono text-[10px] bg-white border border-zinc-200 text-zinc-400 px-1.5 py-0.5 rounded shadow-sm">Ctrl K</kbd>
        </button>

        <a href="/docs" class="text-xs text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition flex items-center gap-1.5 font-semibold">
          <i class="ph ph-book-open text-sm"></i>
          <span>Docs</span>
        </a>
        <div class="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-1.5 rounded-2xl text-xs text-zinc-700">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="font-mono text-zinc-600 font-medium">Supabase Live</span>
        </div>
        <button onclick="handleLogout()" class="bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 hover:text-zinc-900 text-xs px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 font-medium" title="Log Out">
          <i class="ph ph-sign-out text-sm"></i>
          <span>Log Out</span>
        </button>
      </div>
    </header>

    <!-- Key Insight Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-white border border-zinc-200/90 p-5 rounded-2xl relative overflow-hidden shadow-sm">
        <div class="flex justify-between items-start">
          <p class="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Total Verified</p>
          <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm border border-emerald-100">
            <i class="ph-bold ph-check-circle"></i>
          </div>
        </div>
        <h3 id="statTotalTx" class="text-3xl font-bold font-heading text-zinc-900 mt-2">--</h3>
        <p class="text-xs text-emerald-600 mt-1.5 flex items-center gap-1 font-medium font-mono">
          <span id="statTodayCount">0 today</span> • <span id="statSuccessRate">100% success</span>
        </p>
      </div>

      <div class="bg-white border border-zinc-200/90 p-5 rounded-2xl relative overflow-hidden shadow-sm">
        <div class="flex justify-between items-start">
          <p class="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Settled Volume</p>
          <div class="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-sm border border-amber-100">
            <i class="ph-bold ph-coins"></i>
          </div>
        </div>
        <h3 id="statVolume" class="text-3xl font-bold font-heading text-zinc-900 mt-2">-- ETB</h3>
        <p class="text-xs text-zinc-500 mt-1.5 font-medium">
          <span id="statTodayVolume" class="text-amber-600 font-semibold font-mono">0.00 ETB</span> today
        </p>
      </div>

      <div class="bg-white border border-zinc-200/90 p-5 rounded-2xl relative overflow-hidden shadow-sm">
        <div class="flex justify-between items-start">
          <p class="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Telebirr vs CBE</p>
          <div class="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center text-sm border border-sky-100">
            <i class="ph-bold ph-bank"></i>
          </div>
        </div>
        <h3 id="statProviderRatio" class="text-2xl font-bold font-heading text-zinc-900 mt-2">-- / --</h3>
        <p class="text-xs text-zinc-500 mt-1.5 font-medium">
          <span class="text-sky-600 font-semibold font-mono" id="statTelebirrCount">0</span> Telebirr • <span class="text-purple-600 font-semibold font-mono" id="statCbeCount">0</span> CBE
        </p>
      </div>

      <div class="bg-white border border-zinc-200/90 p-5 rounded-2xl relative overflow-hidden shadow-sm">
        <div class="flex justify-between items-start">
          <p class="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Active Integrations</p>
          <div class="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center text-sm border border-teal-100">
            <i class="ph-bold ph-plug"></i>
          </div>
        </div>
        <h3 id="statIntegrations" class="text-3xl font-bold font-heading text-zinc-900 mt-2">--</h3>
        <p class="text-xs text-zinc-500 mt-1.5 font-medium">
          <span id="statApiKeys" class="font-mono text-zinc-700 font-semibold">0</span> Keys • <span id="statWebhooks" class="font-mono text-zinc-700 font-semibold">0</span> Webhooks
        </p>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex border-b border-zinc-200 gap-1 mb-6 text-sm font-medium overflow-x-auto">
      <button onclick="switchTab('analytics')" id="tab-analytics" class="px-4 py-2.5 border-b-2 border-amber-500 text-amber-600 font-semibold flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-chart-line-up text-base"></i>
        <span>Insights</span>
      </button>
      <button onclick="switchTab('studio')" id="tab-studio" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-lightning text-base"></i>
        <span>Verification Studio</span>
      </button>
      <button onclick="switchTab('payments')" id="tab-payments" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-table text-base"></i>
        <span>Payments Ledger</span>
      </button>
      <button onclick="switchTab('apikeys')" id="tab-apikeys" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-key text-base"></i>
        <span>API Keys</span>
      </button>
      <button onclick="switchTab('webhooks')" id="tab-webhooks" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-webhooks-logo text-base"></i>
        <span>Webhooks & Logs</span>
      </button>
      <button onclick="switchTab('merchants')" id="tab-merchants" class="hidden px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-users text-base"></i>
        <span>Merchants</span>
      </button>
      <a href="/docs" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap">
        <i class="ph ph-book-open text-base"></i>
        <span>Docs Portal</span>
      </a>
    </div>

    <!-- TAB 1: Insights & Charts -->
    <section id="panel-analytics" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 bg-white border border-zinc-200 p-5 rounded-2xl shadow-sm">
          <div class="flex justify-between items-center mb-4">
            <div>
              <h3 class="text-sm font-bold font-heading text-zinc-900">7-Day Verification Volume</h3>
              <p class="text-xs text-zinc-500">Total Ethiopian Birr processed daily</p>
            </div>
            <span class="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-lg font-mono font-medium flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Live PostgreSQL
            </span>
          </div>
          <div class="h-64">
            <canvas id="dailyVolumeChart"></canvas>
          </div>
        </div>

        <div class="bg-white border border-zinc-200 p-5 rounded-2xl flex flex-col justify-between shadow-sm">
          <div>
            <h3 class="text-sm font-bold font-heading text-zinc-900 mb-1">Provider Distribution</h3>
            <p class="text-xs text-zinc-500 mb-4">Transaction volume ratio</p>
            <div class="h-48 flex items-center justify-center">
              <canvas id="providerPieChart"></canvas>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-100 text-xs">
            <div class="bg-zinc-50 p-2.5 rounded-xl border border-zinc-200/60">
              <p class="text-zinc-500 font-medium">Telebirr</p>
              <p id="pieTelebirrVal" class="font-bold text-sky-600 font-mono mt-0.5">--</p>
            </div>
            <div class="bg-zinc-50 p-2.5 rounded-xl border border-zinc-200/60">
              <p class="text-zinc-500 font-medium">CBE</p>
              <p id="pieCbeVal" class="font-bold text-purple-600 font-mono mt-0.5">--</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart Row 2: Verification Mode & Speed -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white border border-zinc-200 p-5 rounded-2xl shadow-sm">
          <h3 class="text-sm font-bold font-heading text-zinc-900 mb-1">Verification Method Breakdown</h3>
          <p class="text-xs text-zinc-500 mb-4">Live API Scrapes vs Local SMS / Receipt Text</p>
          <div class="h-56">
            <canvas id="modeBarChart"></canvas>
          </div>
        </div>

        <div class="bg-white border border-zinc-200 p-5 rounded-2xl flex flex-col justify-between shadow-sm">
          <div>
            <h3 class="text-sm font-bold font-heading text-zinc-900 mb-1">Latency & Benchmarks</h3>
            <p class="text-xs text-zinc-500 mb-4">Speed per verification route</p>
            
            <div class="space-y-3.5">
              <div class="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                <div class="flex justify-between text-xs mb-1.5 font-medium">
                  <span class="text-zinc-700">Local SMS / Text Parser</span>
                  <span class="text-emerald-600 font-bold font-mono">1 – 4 ms</span>
                </div>
                <div class="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-emerald-500 h-1.5 rounded-full" style="width: 98%"></div>
                </div>
              </div>

              <div class="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                <div class="flex justify-between text-xs mb-1.5 font-medium">
                  <span class="text-zinc-700">Live Telebirr Portal Lookup</span>
                  <span class="text-sky-600 font-bold font-mono">1.8 – 2.4 s</span>
                </div>
                <div class="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-sky-500 h-1.5 rounded-full" style="width: 85%"></div>
                </div>
              </div>

              <div class="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                <div class="flex justify-between text-xs mb-1.5 font-medium">
                  <span class="text-zinc-700">Live CBE Mobile App Token API</span>
                  <span class="text-purple-600 font-bold font-mono">600 – 900 ms</span>
                </div>
                <div class="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-purple-500 h-1.5 rounded-full" style="width: 92%"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: Verification Studio -->
    <section id="panel-studio" class="hidden space-y-6">
      <div class="bg-white border border-zinc-200 p-6 rounded-2xl shadow-sm">
        <div class="max-w-2xl">
          <h3 class="text-lg font-bold font-heading text-zinc-900">Live Payment Verification Studio</h3>
          <p class="text-xs text-zinc-500 mt-1 mb-4">Paste any 10-digit Telebirr reference (e.g. <code>DHS78S7FQN</code>), CBE token, or full customer SMS receipt text below to verify in real-time.</p>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-zinc-700 mb-1.5">Reference ID or Raw SMS Message</label>
            <textarea id="studioInput" rows="3" placeholder="Enter reference (e.g. DHS78S7FQN) or paste full SMS receipt message..." class="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 text-sm text-zinc-900 outline-none focus:border-amber-500 transition font-mono focus:bg-white"></textarea>
          </div>

          <div class="flex items-center gap-3">
            <button onclick="runStudioVerify()" id="btnStudioVerify" class="bg-amber-500 hover:bg-amber-400 text-zinc-950 px-5 py-2.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-2">
              <i class="ph-bold ph-lightning"></i>
              <span>Verify Payment</span>
            </button>
            <button onclick="clearStudio()" class="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2.5 rounded-xl text-xs font-semibold transition">Clear</button>
          </div>
        </div>

        <!-- Studio Result Card -->
        <div id="studioResultContainer" class="hidden mt-6 pt-6 border-t border-zinc-200">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Verification Output</h4>
          <div id="studioResultCard" class="bg-zinc-50 border border-zinc-200 p-5 rounded-2xl font-mono text-xs overflow-x-auto text-zinc-800">
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 3: Verified Payments Feed -->
    <section id="panel-payments" class="hidden space-y-4">
      <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div class="relative flex-1 max-w-md">
          <input id="searchInput" oninput="loadPayments()" type="text" placeholder="Search reference, payer, bank..." class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs text-zinc-900 outline-none focus:border-amber-500 transition pl-10 font-sans focus:bg-white" />
          <i class="ph ph-magnifying-glass absolute left-3.5 top-3 text-zinc-400 text-sm"></i>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="filterProvider('ALL')" id="btn-filter-all" class="bg-amber-500 text-zinc-950 text-xs px-3.5 py-2 rounded-xl font-bold transition shadow-sm">All</button>
          <button onclick="filterProvider('TELEBIRR')" id="btn-filter-telebirr" class="bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl font-semibold transition">Telebirr</button>
          <button onclick="filterProvider('CBE')" id="btn-filter-cbe" class="bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl font-semibold transition">CBE</button>
          <button onclick="exportPaymentsCsv()" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 font-semibold">
            <i class="ph ph-download-simple"></i>
            <span>Export CSV</span>
          </button>
          <button onclick="loadPayments()" class="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ml-1 font-medium">
            <i class="ph ph-arrow-clockwise"></i>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div class="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-zinc-700">
            <thead class="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-500 uppercase font-mono">
              <tr>
                <th class="p-4">Reference</th>
                <th class="p-4">Provider</th>
                <th class="p-4">Amount</th>
                <th class="p-4">Payer</th>
                <th class="p-4">Receiver</th>
                <th class="p-4">Mode</th>
                <th class="p-4">Verified At</th>
                <th class="p-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody id="paymentsTableBody" class="divide-y divide-zinc-100 font-mono text-xs">
              <tr><td colspan="8" class="p-8 text-center text-zinc-400">Loading verified payments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 4: API Keys -->
    <section id="panel-apikeys" class="hidden space-y-6">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 border border-zinc-200 rounded-2xl gap-4 shadow-sm">
        <div>
          <h3 class="font-bold font-heading text-zinc-900">Generate API Key</h3>
          <p class="text-xs text-zinc-500">Keys grant client applications permission to verify payments via <code>POST /verify</code>.</p>
        </div>
        <div class="flex gap-2 w-full sm:w-auto">
          <input id="newKeyName" type="text" placeholder="App Name (e.g. Telegram Bot)" class="bg-zinc-50 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl outline-none text-zinc-900 flex-1 sm:w-60 focus:bg-white" />
          <button onclick="createApiKey()" class="bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs px-4 py-2 rounded-xl font-bold transition whitespace-nowrap shadow-sm">+ Generate Key</button>
        </div>
      </div>

      <div id="newKeyBanner" class="hidden bg-amber-50 border border-amber-200 p-5 rounded-2xl">
        <p class="text-xs text-amber-800 font-semibold flex items-center gap-1.5">
          <i class="ph-bold ph-check-circle text-base text-amber-600"></i>
          <span>New API Key Generated! Copy it now (only shown once):</span>
        </p>
        <div class="flex items-center gap-2 mt-2.5">
          <input id="generatedKeyField" readonly class="w-full bg-white border border-amber-300 text-amber-900 font-mono text-xs p-2.5 rounded-xl outline-none" />
          <button onclick="copyGeneratedKey()" class="bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs px-4 py-2.5 rounded-xl font-bold flex items-center gap-1.5 shadow-sm">
            <i class="ph ph-copy"></i>
            <span>Copy</span>
          </button>
        </div>
      </div>

      <div class="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <table class="w-full text-left text-sm text-zinc-700 font-mono text-xs">
          <thead class="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
            <tr>
              <th class="p-4">App Name</th>
              <th class="p-4">Key Prefix</th>
              <th class="p-4">Status</th>
              <th class="p-4">Created</th>
              <th class="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody id="apiKeysTableBody" class="divide-y divide-zinc-100">
            <tr><td colspan="5" class="p-6 text-center text-zinc-400">Loading API keys...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- TAB 5: Webhooks & Delivery Logs -->
    <section id="panel-webhooks" class="hidden space-y-6">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 border border-zinc-200 rounded-2xl gap-4 shadow-sm">
        <div>
          <h3 class="font-bold font-heading text-zinc-900">Register Webhook Endpoint</h3>
          <p class="text-xs text-zinc-500">Receive signed HMAC SHA-256 HTTP POST notifications whenever a payment confirms.</p>
        </div>
        <div class="flex gap-2 w-full sm:w-auto">
          <input id="newWebhookUrl" type="url" placeholder="https://your-app.com/api/payment-webhook" class="bg-zinc-50 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl outline-none text-zinc-900 flex-1 sm:w-80 focus:bg-white" />
          <button onclick="createWebhook()" class="bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs px-4 py-2 rounded-xl font-bold transition whitespace-nowrap shadow-sm">+ Register</button>
        </div>
      </div>

      <div class="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <table class="w-full text-left text-sm text-zinc-700 font-mono text-xs">
          <thead class="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
            <tr>
              <th class="p-4">Target URL</th>
              <th class="p-4">Signing Secret</th>
              <th class="p-4">Events</th>
              <th class="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody id="webhooksTableBody" class="divide-y divide-zinc-100">
            <tr><td colspan="4" class="p-6 text-center text-zinc-400">Loading webhooks...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Recent Delivery Logs -->
      <div class="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
        <div class="flex justify-between items-center mb-4">
          <h4 class="text-sm font-bold font-heading text-zinc-900">Recent Webhook Deliveries & Status Logs</h4>
          <button onclick="loadWebhookDeliveries()" class="text-xs text-zinc-500 hover:text-zinc-900 font-semibold"><i class="ph ph-arrow-clockwise"></i> Refresh</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs font-mono text-zinc-700">
            <thead class="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
              <tr>
                <th class="p-3">Event</th>
                <th class="p-3">Status</th>
                <th class="p-3">HTTP Code</th>
                <th class="p-3">Attempts</th>
                <th class="p-3">Delivered At</th>
              </tr>
            </thead>
            <tbody id="webhookDeliveriesTableBody" class="divide-y divide-zinc-100">
              <tr><td colspan="5" class="p-4 text-center text-zinc-400">No delivery attempts recorded yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 6: Super Admin Merchants & Businesses Tab -->
    <section id="panel-merchants" class="hidden space-y-6">
      <div class="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h3 class="text-sm font-bold font-heading text-zinc-900">Platform Merchants & Registered Businesses</h3>
            <p class="text-xs text-zinc-500">Super Administrator controls</p>
          </div>
          <button onclick="loadMerchants()" class="text-xs text-zinc-500 hover:text-zinc-900 font-semibold"><i class="ph ph-arrow-clockwise"></i> Refresh</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs font-mono text-zinc-700">
            <thead class="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
              <tr>
                <th class="p-3">Business Name</th>
                <th class="p-3">Email</th>
                <th class="p-3">Role</th>
                <th class="p-3">Plan</th>
                <th class="p-3">Status</th>
                <th class="p-3">Created</th>
                <th class="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody id="merchantsTableBody" class="divide-y divide-zinc-100">
              <tr><td colspan="7" class="p-4 text-center text-zinc-400">Loading merchants...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

  </div>

  <script>
    let currentToken = localStorage.getItem('chek_session_token') || '';
    let currentAdminKey = localStorage.getItem('chek_admin_key') || '${urlKey}' || '';
    let currentUser = null;
    let selectedProviderFilter = 'ALL';
    let currentApiKeys = [];
    let currentTransactions = [];

    let volumeChartInstance = null;
    let providerChartInstance = null;
    let modeChartInstance = null;

    function openCmdPalette() {
      document.getElementById('cmdPaletteOverlay').classList.remove('hidden');
      document.getElementById('cmdPaletteInput').value = '';
      filterConsoleCmdResults();
      setTimeout(() => document.getElementById('cmdPaletteInput').focus(), 50);
    }

    function closeCmdPalette() {
      document.getElementById('cmdPaletteOverlay').classList.add('hidden');
    }

    function filterConsoleCmdResults() {
      const q = document.getElementById('cmdPaletteInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.cmd-item');
      items.forEach(item => {
        const text = item.innerText.toLowerCase();
        item.classList.toggle('hidden', q && !text.includes(q));
      });
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmdPalette();
      }
      if (e.key === 'Escape') {
        closeCmdPalette();
      }
    });

    document.getElementById('cmdPaletteOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'cmdPaletteOverlay') closeCmdPalette();
    });

    function setAuthMode(mode) {
      document.getElementById('formLogin').classList.toggle('hidden', mode !== 'login');
      document.getElementById('formRegister').classList.toggle('hidden', mode !== 'register');
      document.getElementById('formKey').classList.toggle('hidden', mode !== 'key');

      document.getElementById('btnAuthTabLogin').className = mode === 'login' ? 'flex-1 py-1.5 rounded-lg bg-white shadow-sm text-zinc-900' : 'flex-1 py-1.5 rounded-lg hover:text-zinc-900';
      document.getElementById('btnAuthTabRegister').className = mode === 'register' ? 'flex-1 py-1.5 rounded-lg bg-white shadow-sm text-zinc-900' : 'flex-1 py-1.5 rounded-lg hover:text-zinc-900';
      document.getElementById('btnAuthTabKey').className = mode === 'key' ? 'flex-1 py-1.5 rounded-lg bg-white shadow-sm text-zinc-900' : 'flex-1 py-1.5 rounded-lg hover:text-zinc-900';
    }

    async function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPass').value;
      const errEl = document.getElementById('loginErrorMsg');
      errEl.classList.add('hidden');

      try {
        const res = await fetch('/admin/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
          currentToken = data.token;
          currentUser = data.merchant;
          localStorage.setItem('chek_session_token', currentToken);
          unlockDashboard();
        } else {
          errEl.innerText = data.error || 'Login failed';
          errEl.classList.remove('hidden');
        }
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      const businessName = document.getElementById('regBizName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPass').value;
      const errEl = document.getElementById('regErrorMsg');
      errEl.classList.add('hidden');

      try {
        const res = await fetch('/admin/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessName, email, password })
        });
        const data = await res.json();
        if (data.success) {
          currentToken = data.token;
          currentUser = data.merchant;
          localStorage.setItem('chek_session_token', currentToken);
          unlockDashboard();
        } else {
          errEl.innerText = data.error || 'Registration failed';
          errEl.classList.remove('hidden');
        }
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      }
    }

    async function handleKeyLogin(e) {
      e.preventDefault();
      const key = document.getElementById('keyInput').value.trim();
      const errEl = document.getElementById('keyErrorMsg');
      errEl.classList.add('hidden');

      try {
        const res = await fetch('/admin/api/metrics', {
          headers: { 'x-admin-key': key }
        });
        const data = await res.json();
        if (data.success) {
          currentAdminKey = key;
          localStorage.setItem('chek_admin_key', currentAdminKey);
          currentUser = { name: 'Master Administrator', businessName: 'Platform Console', role: 'admin', email: 'Super Admin' };
          unlockDashboard();
        } else {
          errEl.classList.remove('hidden');
        }
      } catch (err) {
        errEl.classList.remove('hidden');
      }
    }

    function unlockDashboard() {
      document.getElementById('authLockOverlay').classList.add('hidden');
      document.getElementById('mainApp').classList.remove('opacity-0');

      if (currentUser) {
        document.getElementById('headerBizName').innerText = currentUser.businessName || 'Chek Hub';
        document.getElementById('headerUserEmail').innerText = currentUser.email || 'Merchant';
        document.getElementById('headerRoleBadge').innerText = (currentUser.role || 'Pro').toUpperCase();

        if (currentUser.role === 'admin') {
          document.getElementById('tab-merchants').classList.remove('hidden');
        }
      }

      loadAll();
    }

    function handleLogout() {
      localStorage.removeItem('chek_session_token');
      localStorage.removeItem('chek_admin_key');
      currentToken = '';
      currentAdminKey = '';
      currentUser = null;
      document.getElementById('authLockOverlay').classList.remove('hidden');
      document.getElementById('mainApp').classList.add('opacity-0');
    }

    function getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
      if (currentAdminKey) headers['x-admin-key'] = currentAdminKey;
      return headers;
    }

    function switchTab(tab) {
      ['analytics', 'studio', 'payments', 'apikeys', 'webhooks', 'merchants'].forEach(t => {
        const el = document.getElementById('panel-' + t);
        const tabBtn = document.getElementById('tab-' + t);
        if (el) el.classList.add('hidden');
        if (tabBtn) tabBtn.className = 'px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition whitespace-nowrap';
      });
      const activePanel = document.getElementById('panel-' + tab);
      const activeTabBtn = document.getElementById('tab-' + tab);
      if (activePanel) activePanel.classList.remove('hidden');
      if (activeTabBtn) activeTabBtn.className = 'px-4 py-2.5 border-b-2 border-amber-500 text-amber-600 font-semibold flex items-center gap-2 transition whitespace-nowrap';

      if (tab === 'analytics') loadMetrics();
      if (tab === 'payments') loadPayments();
      if (tab === 'apikeys') loadApiKeys();
      if (tab === 'webhooks') { loadWebhooks(); loadWebhookDeliveries(); }
      if (tab === 'merchants') loadMerchants();
    }

    function filterProvider(p) {
      selectedProviderFilter = p;
      ['all', 'telebirr', 'cbe'].forEach(k => {
        const btn = document.getElementById('btn-filter-' + k);
        if (k === p.toLowerCase()) {
          btn.className = 'bg-amber-500 text-zinc-950 text-xs px-3.5 py-2 rounded-xl font-bold transition shadow-sm';
        } else {
          btn.className = 'bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl font-semibold transition';
        }
      });
      loadPayments();
    }

    async function loadMetrics() {
      try {
        const res = await fetch('/admin/api/metrics', { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) return;

        const m = data.metrics;
        document.getElementById('statTotalTx').innerText = m.totalCount.toLocaleString();
        document.getElementById('statVolume').innerText = parseFloat(m.totalVolume).toLocaleString() + ' ETB';
        document.getElementById('statTodayCount').innerText = m.todayCount + ' today';
        document.getElementById('statTodayVolume').innerText = parseFloat(m.todayVolume).toLocaleString() + ' ETB';
        document.getElementById('statProviderRatio').innerText = m.telebirrCount + ' / ' + m.cbeCount;
        document.getElementById('statTelebirrCount').innerText = m.telebirrCount;
        document.getElementById('statCbeCount').innerText = m.cbeCount;
        document.getElementById('statIntegrations').innerText = (m.activeKeys + m.activeWebhooks).toString();
        document.getElementById('statApiKeys').innerText = m.activeKeys;
        document.getElementById('statWebhooks').innerText = m.activeWebhooks;

        renderDailyVolumeChart(m.dailyTrends);
        renderProviderPieChart(m.telebirrCount, m.cbeCount, m.telebirrVolume, m.cbeVolume);
        renderModeBarChart(m.liveApiCount, m.localTextCount);
      } catch (err) { console.error(err); }
    }

    function renderDailyVolumeChart(trends) {
      const ctx = document.getElementById('dailyVolumeChart').getContext('2d');
      if (volumeChartInstance) volumeChartInstance.destroy();

      const labels = trends.map(t => t.date);
      const volumes = trends.map(t => t.volume);
      const counts = trends.map(t => t.count);

      volumeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Volume (ETB)',
              data: volumes,
              borderColor: '#d97706',
              backgroundColor: 'rgba(217, 119, 6, 0.08)',
              tension: 0.3,
              fill: true,
              borderWidth: 2.5,
              yAxisID: 'y'
            },
            {
              label: 'Count',
              data: counts,
              borderColor: '#0284c7',
              backgroundColor: 'transparent',
              borderDash: [3, 3],
              tension: 0.3,
              borderWidth: 2,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#475569', font: { family: 'Plus Jakarta Sans', size: 11 } } }
          },
          scales: {
            x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 10 } } },
            y: { grid: { color: '#f1f5f9' }, ticks: { color: '#d97706', font: { size: 10 } }, position: 'left' },
            y1: { grid: { drawOnChartArea: false }, ticks: { color: '#0284c7', font: { size: 10 } }, position: 'right' }
          }
        }
      });
    }

    function renderProviderPieChart(telebirrCount, cbeCount, telebirrVol, cbeVol) {
      const ctx = document.getElementById('providerPieChart').getContext('2d');
      if (providerChartInstance) providerChartInstance.destroy();

      document.getElementById('pieTelebirrVal').innerText = parseFloat(telebirrVol).toLocaleString() + ' ETB';
      document.getElementById('pieCbeVal').innerText = parseFloat(cbeVol).toLocaleString() + ' ETB';

      providerChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Telebirr', 'CBE'],
          datasets: [{
            data: [telebirrCount || 1, cbeCount || 0],
            backgroundColor: ['#0284c7', '#9333ea'],
            borderColor: '#ffffff',
            borderWidth: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#475569', font: { size: 11 } } }
          },
          cutout: '72%'
        }
      });
    }

    function renderModeBarChart(liveCount, textCount) {
      const ctx = document.getElementById('modeBarChart').getContext('2d');
      if (modeChartInstance) modeChartInstance.destroy();

      modeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Live Scrape', 'Local SMS Text'],
          datasets: [{
            label: 'Total Verifications',
            data: [liveCount, textCount],
            backgroundColor: ['#0284c7', '#10b981'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 11 } } },
            y: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    async function loadPayments() {
      const q = document.getElementById('searchInput').value.trim();
      try {
        const res = await fetch('/admin/api/transactions?q=' + encodeURIComponent(q) + '&provider=' + selectedProviderFilter, { headers: getHeaders() });
        const data = await res.json();
        const tbody = document.getElementById('paymentsTableBody');
        if (!data.success || !data.transactions.length) {
          tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-zinc-400">No verified transactions recorded yet.</td></tr>';
          return;
        }
        currentTransactions = data.transactions;
        tbody.innerHTML = data.transactions.map(tx => {
          const isTelebirr = tx.provider === 'TELEBIRR';
          const badgeClass = isTelebirr
            ? 'bg-sky-50 text-sky-700 border border-sky-200'
            : 'bg-purple-50 text-purple-700 border border-purple-200';

          return \`
            <tr class="hover:bg-zinc-50/80 transition">
              <td class="p-4 font-bold text-zinc-900 font-mono">\${tx.reference}</td>
              <td class="p-4"><span class="px-2.5 py-0.5 rounded-full \${badgeClass} text-xs font-semibold">\${tx.provider}</span></td>
              <td class="p-4 font-bold text-amber-600 font-mono">\${parseFloat(tx.amount).toFixed(2)} ETB</td>
              <td class="p-4 text-zinc-800 font-sans font-medium">\${tx.payer || '—'}</td>
              <td class="p-4 text-zinc-600 font-sans">\${tx.receiver || '—'}</td>
              <td class="p-4 text-zinc-500 text-xs font-mono">\${tx.verificationMode}</td>
              <td class="p-4 text-zinc-500 text-xs font-mono">\${new Date(tx.verifiedAt).toLocaleString()}</td>
              <td class="p-4 text-right">
                <button onclick="inspectTransaction('\${tx.id}')" class="text-amber-600 hover:text-amber-700 text-xs font-semibold">Inspect</button>
              </td>
            </tr>
          \`;
        }).join('');
      } catch (err) { console.error(err); }
    }

    function inspectTransaction(id) {
      const tx = currentTransactions.find(t => t.id === id);
      if (!tx) return;
      document.getElementById('txDetailContent').innerHTML = '<pre>' + JSON.stringify(tx, null, 2) + '</pre>';
      document.getElementById('txDetailModal').classList.remove('hidden');
    }

    function closeTxModal() {
      document.getElementById('txDetailModal').classList.add('hidden');
    }

    function exportPaymentsCsv() {
      if (!currentTransactions.length) return alert('No transactions to export.');
      let csv = 'ID,Reference,Provider,Amount (ETB),Payer,Receiver,Status,Mode,Verified At\\n';
      currentTransactions.forEach(t => {
        csv += \`"\${t.id}","\${t.reference}","\${t.provider}",\${t.amount},"\${t.payer || ''}","\${t.receiver || ''}","\${t.status}","\${t.verificationMode}","\${t.verifiedAt}"\\n\`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chek-verified-transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }

    async function runStudioVerify() {
      const input = document.getElementById('studioInput').value.trim();
      if (!input) return alert('Enter a reference number or paste SMS text');

      const btn = document.getElementById('btnStudioVerify');
      btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i><span>Verifying...</span>';
      btn.disabled = true;

      try {
        const res = await fetch('/admin/api/verify', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ input })
        });
        const data = await res.json();
        
        const container = document.getElementById('studioResultContainer');
        const card = document.getElementById('studioResultCard');
        container.classList.remove('hidden');

        if (data.success) {
          card.innerHTML = '<div class="text-emerald-700 font-bold mb-2 flex items-center gap-1.5"><i class="ph-bold ph-check-circle text-base text-emerald-600"></i> Payment Verified Successfully!</div><pre class="text-zinc-800">' + JSON.stringify(data.data || data, null, 2) + '</pre>';
        } else {
          card.innerHTML = '<div class="text-rose-700 font-bold mb-2 flex items-center gap-1.5"><i class="ph-bold ph-x-circle text-base text-rose-600"></i> Verification Failed: ' + (data.error || 'Unknown error') + '</div><pre class="text-zinc-500">' + JSON.stringify(data, null, 2) + '</pre>';
        }

        loadMetrics();
        loadPayments();
      } catch (err) {
        alert('Verification error: ' + err.message);
      } finally {
        btn.innerHTML = '<i class="ph-bold ph-lightning"></i><span>Verify Payment</span>';
        btn.disabled = false;
      }
    }

    function clearStudio() {
      document.getElementById('studioInput').value = '';
      document.getElementById('studioResultContainer').classList.add('hidden');
    }

    async function loadApiKeys() {
      try {
        const res = await fetch('/admin/api/api-keys', { headers: getHeaders() });
        const data = await res.json();
        const tbody = document.getElementById('apiKeysTableBody');
        if (!data.success || !data.keys.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-zinc-400">No API keys generated yet.</td></tr>';
          return;
        }
        currentApiKeys = data.keys;
        tbody.innerHTML = data.keys.map(k => \`
          <tr class="hover:bg-zinc-50/80">
            <td class="p-4 font-bold text-zinc-900 font-sans">\${k.name}</td>
            <td class="p-4 text-amber-700 font-mono font-medium">\${k.prefix}</td>
            <td class="p-4"><span class="px-2 py-0.5 rounded-full \${k.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'} text-xs font-semibold">\${k.isActive ? 'Active' : 'Revoked'}</span></td>
            <td class="p-4 text-zinc-500 text-xs font-mono">\${new Date(k.createdAt).toLocaleDateString()}</td>
            <td class="p-4 text-right">
              <button onclick="openEditModal('\${k.id}')" class="text-amber-600 hover:text-amber-700 text-xs font-semibold mr-3"><i class="ph-bold ph-pencil-simple"></i> Edit</button>
              \${k.isActive ? \`<button onclick="revokeKey('\${k.id}')" class="text-rose-600 hover:text-rose-700 text-xs font-semibold">Revoke</button>\` : ''}
            </td>
          </tr>
        \`).join('');
      } catch (err) { console.error(err); }
    }

    function openEditModal(id) {
      const key = currentApiKeys.find(k => k.id === id);
      if (!key) return;
      document.getElementById('editKeyId').value = key.id;
      document.getElementById('editKeyName').value = key.name;
      document.getElementById('editKeyStatus').value = key.isActive ? 'true' : 'false';
      document.getElementById('editKeyModal').classList.remove('hidden');
    }

    function closeEditModal() {
      document.getElementById('editKeyModal').classList.add('hidden');
    }

    async function saveKeyEdit() {
      const id = document.getElementById('editKeyId').value;
      const name = document.getElementById('editKeyName').value.trim();
      const isActive = document.getElementById('editKeyStatus').value === 'true';

      const res = await fetch('/admin/api/api-keys/' + id, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ name, isActive })
      });
      const data = await res.json();
      if (data.success) {
        closeEditModal();
        loadApiKeys();
        loadMetrics();
      } else {
        alert('Failed to update key: ' + data.error);
      }
    }

    async function createApiKey() {
      const name = document.getElementById('newKeyName').value.trim() || 'New App';
      const res = await fetch('/admin/api/api-keys', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('newKeyBanner').classList.remove('hidden');
        document.getElementById('generatedKeyField').value = data.rawKey || data.key;
        document.getElementById('newKeyName').value = '';
        loadApiKeys();
        loadMetrics();
      }
    }

    function copyGeneratedKey() {
      const f = document.getElementById('generatedKeyField');
      f.select();
      navigator.clipboard.writeText(f.value);
      alert('API Key copied to clipboard!');
    }

    async function revokeKey(id) {
      if (!confirm('Revoke this API Key? Client apps using it will lose access immediately.')) return;
      await fetch('/admin/api/api-keys/' + id, { method: 'DELETE', headers: getHeaders() });
      loadApiKeys();
      loadMetrics();
    }

    async function loadWebhooks() {
      try {
        const res = await fetch('/admin/api/webhooks', { headers: getHeaders() });
        const data = await res.json();
        const tbody = document.getElementById('webhooksTableBody');
        if (!data.success || !data.webhooks.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-zinc-400">No webhooks configured yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.webhooks.map(w => \`
          <tr class="hover:bg-zinc-50/80">
            <td class="p-4 text-zinc-900 font-mono text-xs font-semibold">\${w.url}</td>
            <td class="p-4 text-zinc-500 font-mono text-xs">\${w.signingSecret.slice(0, 10)}...</td>
            <td class="p-4 text-emerald-700 text-xs font-mono font-medium">\${(w.events || []).join(', ')}</td>
            <td class="p-4 text-right">
              <button onclick="testWebhook('\${w.id}')" class="text-sky-600 hover:text-sky-700 text-xs font-semibold mr-3">Test Ping</button>
              <button onclick="removeWebhook('\${w.id}')" class="text-rose-600 hover:text-rose-700 text-xs font-semibold">Delete</button>
            </td>
          </tr>
        \`).join('');
      } catch (err) { console.error(err); }
    }

    async function loadWebhookDeliveries() {
      try {
        const res = await fetch('/admin/api/webhooks/deliveries', { headers: getHeaders() });
        const data = await res.json();
        const tbody = document.getElementById('webhookDeliveriesTableBody');
        if (!data.success || !data.deliveries.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-zinc-400">No webhook delivery logs recorded yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.deliveries.map(d => \`
          <tr class="hover:bg-zinc-50/80">
            <td class="p-3 text-zinc-900 font-mono">\${d.event}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded-full \${d.status === 'SUCCEEDED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'} text-[11px] font-bold">\${d.status}</span></td>
            <td class="p-3 text-zinc-700 font-mono">\${d.statusCode || '—'}</td>
            <td class="p-3 text-zinc-500">\${d.attempts}</td>
            <td class="p-3 text-zinc-500">\${new Date(d.createdAt).toLocaleString()}</td>
          </tr>
        \`).join('');
      } catch (err) { console.error(err); }
    }

    async function createWebhook() {
      const url = document.getElementById('newWebhookUrl').value.trim();
      if (!url) return alert('Enter a valid webhook URL');
      await fetch('/admin/api/webhooks', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ url })
      });
      document.getElementById('newWebhookUrl').value = '';
      loadWebhooks();
      loadMetrics();
    }

    async function testWebhook(id) {
      alert('Sending test payment.verified event to destination...');
      await fetch('/admin/api/webhooks/' + id + '/test', { method: 'POST', headers: getHeaders() });
      alert('Webhook dispatched successfully! Refreshing delivery logs.');
      loadWebhookDeliveries();
    }

    async function removeWebhook(id) {
      if (!confirm('Delete this webhook?')) return;
      await fetch('/admin/api/webhooks/' + id, { method: 'DELETE', headers: getHeaders() });
      loadWebhooks();
      loadMetrics();
    }

    async function loadMerchants() {
      try {
        const res = await fetch('/admin/api/merchants', { headers: getHeaders() });
        const data = await res.json();
        const tbody = document.getElementById('merchantsTableBody');
        if (!data.success || !data.merchants.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-zinc-400">No merchants registered yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.merchants.map(m => \`
          <tr class="hover:bg-zinc-50/80">
            <td class="p-3 font-bold text-zinc-900 font-sans">\${m.businessName}</td>
            <td class="p-3 text-zinc-600">\${m.email}</td>
            <td class="p-3 font-mono text-[11px] uppercase">\${m.role}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold uppercase">\${m.plan}</span></td>
            <td class="p-3"><span class="px-2 py-0.5 rounded-full \${m.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'} text-[11px] font-bold">\${m.isActive ? 'ACTIVE' : 'SUSPENDED'}</span></td>
            <td class="p-3 text-zinc-500 text-[11px]">\${new Date(m.createdAt).toLocaleDateString()}</td>
            <td class="p-3 text-right">
              <button onclick="toggleMerchantActive('\${m.id}', \${!m.isActive})" class="\${m.isActive ? 'text-rose-600 hover:text-rose-700' : 'text-emerald-600 hover:text-emerald-700'} font-semibold text-xs">\${m.isActive ? 'Suspend' : 'Activate'}</button>
            </td>
          </tr>
        \`).join('');
      } catch (err) { console.error(err); }
    }

    async function toggleMerchantActive(id, isActive) {
      if (!confirm((isActive ? 'Activate' : 'Suspend') + ' this merchant account?')) return;
      await fetch('/admin/api/merchants/' + id, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ isActive })
      });
      loadMerchants();
    }

    function loadAll() {
      loadMetrics();
      loadPayments();
      loadApiKeys();
      loadWebhooks();
      loadWebhookDeliveries();
    }

    // Auto-login check
    if (currentToken) {
      fetch('/admin/api/auth/me', { headers: getHeaders() })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            currentUser = d.merchant;
            unlockDashboard();
          } else {
            handleLogout();
          }
        })
        .catch(() => handleLogout());
    } else if (currentAdminKey) {
      fetch('/admin/api/metrics', { headers: getHeaders() })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            currentUser = { name: 'Master Administrator', businessName: 'Platform Console', role: 'admin', email: 'Super Admin' };
            unlockDashboard();
          }
        });
    }
  </script>
</body>
</html>`;

  res.send(html);
});

// ─── AUTH REST APIS ──────────────────────────────────────────────────────────

router.post('/api/auth/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, businessName } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required.' });
      return;
    }
    const result = await registerMerchant({ email, password, name, businessName });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required.' });
      return;
    }
    const result = await loginMerchant(email, password);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

router.get('/api/auth/me', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantUser = (req as any).merchantUser;
    if (merchantUser && merchantUser.id) {
      const merchant = await db.query.merchants.findFirst({
        where: eq(merchants.id, merchantUser.id),
      });
      res.json({ success: true, merchant });
      return;
    }

    if ((req as any).isAdmin) {
      res.json({
        success: true,
        merchant: {
          id: 'master-admin',
          name: 'Master Admin',
          businessName: 'Chek Platform Administration',
          email: 'admin@chek.et',
          role: 'admin',
          plan: 'enterprise',
        }
      });
      return;
    }

    res.status(401).json({ success: false, error: 'Not authenticated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SUPER ADMIN MERCHANTS MANAGEMENT ────────────────────────────────────────

router.get('/api/merchants', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(req as any).isAdmin) {
      res.status(403).json({ success: false, error: 'Access restricted to Super Administrators.' });
      return;
    }

    const merchantList = await db.query.merchants.findMany({
      orderBy: [desc(merchants.createdAt)],
    });

    res.json({
      success: true,
      merchants: merchantList.map(m => ({
        id: m.id,
        name: m.name,
        businessName: m.businessName,
        email: m.email,
        role: m.role,
        plan: m.plan,
        isActive: m.isActive,
        createdAt: m.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/api/merchants/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(req as any).isAdmin) {
      res.status(403).json({ success: false, error: 'Access restricted to Super Administrators.' });
      return;
    }

    const { id } = req.params;
    const { isActive, plan, role } = req.body;

    const payload: any = {};
    if (isActive !== undefined) payload.isActive = isActive;
    if (plan !== undefined) payload.plan = plan;
    if (role !== undefined) payload.role = role;

    const [updated] = await db.update(merchants)
      .set(payload)
      .where(eq(merchants.id, id))
      .returning();

    res.json({ success: true, merchant: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CONSOLE DATA & METRICS REST APIS ────────────────────────────────────────

router.get('/api/metrics', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = (req as any).merchantId;
    const isAdmin = (req as any).isAdmin;

    const txConditions = (!isAdmin && merchantId) ? [eq(verifiedTransactions.merchantId, merchantId)] : [];
    const keyConditions = (!isAdmin && merchantId) ? [eq(apiKeys.merchantId, merchantId), eq(apiKeys.isActive, true)] : [eq(apiKeys.isActive, true)];
    const hookConditions = (!isAdmin && merchantId) ? [eq(webhooks.merchantId, merchantId), eq(webhooks.isActive, true)] : [eq(webhooks.isActive, true)];

    const txWhere = txConditions.length ? txConditions[0] : undefined;
    const keyWhere = keyConditions.length === 1 ? keyConditions[0] : and(...keyConditions);
    const hookWhere = hookConditions.length === 1 ? hookConditions[0] : and(...hookConditions);

    const [{ count }] = txWhere
      ? await db.select({ count: sql<number>`count(*)::int` }).from(verifiedTransactions).where(txWhere)
      : await db.select({ count: sql<number>`count(*)::int` }).from(verifiedTransactions);

    const [{ total }] = txWhere
      ? await db.select({ total: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` }).from(verifiedTransactions).where(txWhere)
      : await db.select({ total: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` }).from(verifiedTransactions);

    const [{ activeKeys }] = await db.select({ activeKeys: sql<number>`count(*)::int` }).from(apiKeys).where(keyWhere);
    const [{ activeWebhooks }] = await db.select({ activeWebhooks: sql<number>`count(*)::int` }).from(webhooks).where(hookWhere);

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySql = sql`verified_at >= ${today.toISOString()}::timestamptz`;
    const todayWhere = txWhere ? and(txWhere, todaySql) : todaySql;

    const [{ todayCount }] = await db.select({ todayCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(todayWhere);

    const [{ todayVolume }] = await db.select({ todayVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` })
      .from(verifiedTransactions)
      .where(todayWhere);

    // Telebirr vs CBE stats
    const tbWhere = txWhere ? and(txWhere, eq(verifiedTransactions.provider, 'TELEBIRR')) : eq(verifiedTransactions.provider, 'TELEBIRR');
    const cbeWhere = txWhere ? and(txWhere, eq(verifiedTransactions.provider, 'CBE')) : eq(verifiedTransactions.provider, 'CBE');

    const [{ telebirrCount }] = await db.select({ telebirrCount: sql<number>`count(*)::int` }).from(verifiedTransactions).where(tbWhere);
    const [{ telebirrVolume }] = await db.select({ telebirrVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` }).from(verifiedTransactions).where(tbWhere);

    const [{ cbeCount }] = await db.select({ cbeCount: sql<number>`count(*)::int` }).from(verifiedTransactions).where(cbeWhere);
    const [{ cbeVolume }] = await db.select({ cbeVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` }).from(verifiedTransactions).where(cbeWhere);

    // Verification Mode counts
    const liveWhere = txWhere ? and(txWhere, eq(verifiedTransactions.verificationMode, 'LIVE_API')) : eq(verifiedTransactions.verificationMode, 'LIVE_API');
    const textWhere = txWhere ? and(txWhere, eq(verifiedTransactions.verificationMode, 'LOCAL_TEXT')) : eq(verifiedTransactions.verificationMode, 'LOCAL_TEXT');

    const [{ liveApiCount }] = await db.select({ liveApiCount: sql<number>`count(*)::int` }).from(verifiedTransactions).where(liveWhere);
    const [{ localTextCount }] = await db.select({ localTextCount: sql<number>`count(*)::int` }).from(verifiedTransactions).where(textWhere);

    // Daily Trends (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const trendsSql = sql`verified_at >= ${sevenDaysAgo.toISOString()}::timestamptz`;
    const trendsWhere = txWhere ? and(txWhere, trendsSql) : trendsSql;

    const dailyRows = await db.select({
      day: sql<string>`to_char(verified_at, 'Mon DD')`,
      volume: sql<number>`coalesce(sum(amount), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
      .from(verifiedTransactions)
      .where(trendsWhere)
      .groupBy(sql`to_char(verified_at, 'Mon DD'), date_trunc('day', verified_at)`)
      .orderBy(sql`date_trunc('day', verified_at) asc`);

    const dailyTrends = dailyRows.map(r => ({
      date: r.day,
      volume: r.volume,
      count: r.count,
    }));

    res.json({
      success: true,
      metrics: {
        totalCount: count || 0,
        totalVolume: total || '0.00',
        todayCount: todayCount || 0,
        todayVolume: todayVolume || '0.00',
        telebirrCount: telebirrCount || 0,
        telebirrVolume: telebirrVolume || '0.00',
        cbeCount: cbeCount || 0,
        cbeVolume: cbeVolume || '0.00',
        liveApiCount: liveApiCount || 0,
        localTextCount: localTextCount || 0,
        activeKeys: activeKeys || 0,
        activeWebhooks: activeWebhooks || 0,
        dailyTrends: dailyTrends.length ? dailyTrends : [
          { date: 'Today', volume: parseFloat(todayVolume || '0'), count: todayCount || 0 }
        ]
      }
    });
  } catch (err: any) {
    logger.error('Error fetching admin metrics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/verify', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
      res.status(400).json({ success: false, error: 'Missing verification input.' });
      return;
    }

    const merchantId = (req as any).merchantId || null;
    const trimmed = input.trim();
    const result = await runSmartVerify({
      reference: trimmed.includes(' ') ? undefined : trimmed,
      receiptText: trimmed.includes(' ') ? trimmed : undefined,
    });

    if (result.success && result.data) {
      const txId = crypto.randomUUID();
      const verifiedAt = new Date();
      const d = result.data;
      const amountVal = d.settledAmount || d.amount || d.totalPaidAmount || '0.00';
      const cleanAmount = parseFloat(String(amountVal).replace(/[^0-9.]/g, '')) || 0;

      await db.insert(verifiedTransactions).values({
        id: txId,
        merchantId,
        reference: d.receiptNo || d.reference || trimmed,
        provider: result.provider || 'TELEBIRR',
        amount: cleanAmount.toFixed(2),
        payer: d.payerName || d.payer || 'Customer',
        receiver: d.creditedPartyName || d.receiver || 'Merchant',
        status: 'COMPLETED',
        verificationMode: d.verificationMode || (trimmed.includes(' ') ? 'LOCAL_TEXT' : 'LIVE_API'),
        rawText: trimmed.includes(' ') ? trimmed : null,
        metadata: { rawPayload: d },
        verifiedAt,
      }).catch(err => logger.warn(`Admin verify DB insert error: ${err.message}`));

      // Dispatch Webhook
      dispatchPaymentWebhook('payment.verified', {
        event: 'payment.verified',
        transaction: {
          id: txId,
          reference: d.receiptNo || d.reference || trimmed,
          provider: result.provider || 'TELEBIRR',
          amount: cleanAmount,
          payer: d.payerName || d.payer,
          receiver: d.creditedPartyName || d.receiver,
          status: 'COMPLETED',
          verifiedAt: verifiedAt.toISOString(),
          verificationMode: d.verificationMode || (trimmed.includes(' ') ? 'LOCAL_TEXT' : 'LIVE_API'),
          metadata: d,
        },
        timestamp: new Date().toISOString(),
      }, txId, merchantId).catch(err => logger.error('Error in webhook dispatch:', err));
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/transactions', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string)?.trim();
    const providerFilter = (req.query.provider as string)?.trim()?.toUpperCase();
    const merchantId = (req as any).merchantId;
    const isAdmin = (req as any).isAdmin;

    let conditions: any[] = [];

    if (!isAdmin && merchantId) {
      conditions.push(eq(verifiedTransactions.merchantId, merchantId));
    }

    if (q) {
      conditions.push(
        or(
          ilike(verifiedTransactions.reference, `%${q}%`),
          ilike(verifiedTransactions.payer, `%${q}%`),
          ilike(verifiedTransactions.receiver, `%${q}%`),
          ilike(verifiedTransactions.provider, `%${q}%`)
        )
      );
    }

    if (providerFilter && (providerFilter === 'TELEBIRR' || providerFilter === 'CBE')) {
      conditions.push(eq(verifiedTransactions.provider, providerFilter));
    }

    const query = db.select()
      .from(verifiedTransactions)
      .orderBy(desc(verifiedTransactions.verifiedAt))
      .limit(100);

    const rows = conditions.length > 0
      ? await query.where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : await query;

    res.json({ success: true, transactions: rows });
  } catch (err: any) {
    logger.error('Error fetching admin transactions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/api-keys', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = (req as any).isAdmin ? undefined : (req as any).merchantId;
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
    const generated = await generateApiKey(name || 'Default App', merchantId);
    res.json({ success: true, ...generated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/api/api-keys/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;
    const merchantId = (req as any).isAdmin ? undefined : (req as any).merchantId;
    const updated = await updateApiKey(id, { name, isActive }, merchantId);
    res.json({ success: true, key: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/api-keys/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const merchantId = (req as any).isAdmin ? undefined : (req as any).merchantId;
    const revoked = await revokeApiKey(id, merchantId);
    res.json({ success: revoked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/webhooks', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = (req as any).isAdmin ? undefined : (req as any).merchantId;
    const hooks = await listWebhooks(merchantId);
    res.json({ success: true, webhooks: hooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/webhooks/deliveries', authenticateConsoleUser, async (_req: Request, res: Response): Promise<void> => {
  try {
    const deliveries = await listWebhookDeliveries();
    res.json({ success: true, deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, events } = req.body;
    const merchantId = (req as any).merchantId || undefined;
    const hook = await registerWebhook(url, events, merchantId);
    res.json({ success: true, webhook: hook });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks/:id/test', authenticateConsoleUser, async (_req: Request, res: Response): Promise<void> => {
  try {
    await dispatchPaymentWebhook('payment.verified', {
      event: 'payment.verified',
      transaction: {
        id: crypto.randomUUID(),
        reference: 'TEST_WEBHOOK_REF_' + Math.floor(Math.random() * 10000),
        provider: 'TELEBIRR',
        amount: 250,
        payer: 'Test Customer',
        receiver: 'Test Merchant',
        status: 'COMPLETED',
        verifiedAt: new Date().toISOString(),
        verificationMode: 'LIVE_API',
        metadata: { test: true },
      },
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Test webhook event dispatched.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/webhooks/:id', authenticateConsoleUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const merchantId = (req as any).isAdmin ? undefined : (req as any).merchantId;
    const deleted = await deleteWebhook(id, merchantId);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
