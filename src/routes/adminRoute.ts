import { Router, Request, Response, NextFunction } from 'express';
import { generateApiKey, listApiKeys, revokeApiKey, updateApiKey } from '../middleware/apiKeyAuth';
import { registerWebhook, listWebhooks, deleteWebhook, dispatchPaymentWebhook } from '../queues/webhookQueue';
import { runSmartVerify } from '../services/verifyUniversal';
import { db } from '../db';
import { verifiedTransactions, apiKeys, webhooks, webhookDeliveries } from '../db/schema';
import { desc, sql, ilike, or, eq } from 'drizzle-orm';
import crypto from 'crypto';
import logger from '../utils/logger';

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'chek_admin_super_secret_key_902104';

// Admin auth check middleware
const checkAdminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey || req.query.key;
  if (adminKey !== ADMIN_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized. Invalid admin access key.' });
    return;
  }
  next();
};

// ─── ADMIN DASHBOARD UI (HTML - Clean White Theme) ───────────────────────────

router.get('/', (req: Request, res: Response): void => {
  const urlKey = (req.query.key as string) || (req.query.adminKey as string) || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chek — Ethiopian Payment Verification Console</title>
  
  <!-- Fonts: Outfit (Headings) + Plus Jakarta Sans (Body) + JetBrains Mono (Code) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
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
              700: '#047857',
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

  <!-- ADMIN AUTH LOCK OVERLAY -->
  <div id="authLockOverlay" class="fixed inset-0 z-50 bg-white/95 backdrop-blur-md flex items-center justify-center p-4">
    <div class="bg-white border border-zinc-200 p-8 rounded-3xl max-w-md w-full shadow-2xl shadow-zinc-200/80 text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-2xl shadow-sm text-amber-600 mb-4">
        <i class="ph-bold ph-lock-key"></i>
      </div>
      <h2 class="text-2xl font-bold font-heading text-zinc-900">Chek Console Authentication</h2>
      <p class="text-xs text-zinc-500 mt-1 mb-6">Enter your Admin Secret Key to access live verification metrics and payment controls.</p>
      
      <div class="space-y-3">
        <div class="relative">
          <input id="modalAdminKey" type="password" placeholder="Enter ADMIN_SECRET..." value="${urlKey}" class="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm text-zinc-900 outline-none focus:border-amber-500 transition font-mono pl-10 focus:bg-white" />
          <i class="ph ph-key absolute left-3.5 top-3.5 text-zinc-400 text-lg"></i>
        </div>
        <p id="authErrorMsg" class="text-xs text-rose-600 font-medium hidden">Invalid admin key. Access denied.</p>
        <button onclick="loginWithKey()" class="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 py-3 rounded-xl font-bold text-sm transition shadow-md shadow-amber-500/20 flex items-center justify-center gap-2">
          <span>Unlock Console</span>
          <i class="ph-bold ph-arrow-right"></i>
        </button>
      </div>
      <p class="text-[11px] text-zinc-400 mt-6 font-mono">Default: chek_admin_super_secret_key_902104</p>
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

  <!-- MAIN APPLICATION LAYOUT -->
  <div id="mainApp" class="max-w-7xl mx-auto p-4 md:p-8 opacity-0 transition-opacity duration-300">
    
    <!-- Top Navigation Header -->
    <header class="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-8 border-b border-zinc-200 gap-4">
      <div class="flex items-center gap-3.5">
        <div class="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center font-bold shadow-sm text-amber-600">
          <!-- Custom SVG Icon -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="w-6 h-6 fill-current text-amber-600">
            <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
          </svg>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-bold font-heading tracking-tight text-zinc-900">Chek Console</h1>
            <span class="text-[11px] font-mono bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-semibold">Production v3.1</span>
          </div>
          <p class="text-xs text-zinc-500 font-medium">Telebirr • Commercial Bank of Ethiopia (CBE)</p>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="flex items-center gap-3">
        <a href="/" class="text-xs text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition flex items-center gap-1.5 font-semibold">
          <i class="ph ph-house text-sm"></i>
          <span>Landing Page</span>
        </a>
        <div class="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-1.5 rounded-2xl text-xs text-zinc-700">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="font-mono text-zinc-600 font-medium">PostgreSQL Live</span>
        </div>
        <button onclick="logoutAdmin()" class="bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 hover:text-zinc-900 text-xs px-3 py-2 rounded-xl transition flex items-center gap-1.5 font-medium" title="Lock Dashboard">
          <i class="ph ph-sign-out text-sm"></i>
          <span>Lock</span>
        </button>
      </div>
    </header>

    <!-- Key Insight Cards (Shadcn White) -->
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
          <p class="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Total Settled Volume</p>
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
          <span id="statApiKeys" class="font-mono text-zinc-700 font-semibold">0</span> API Keys • <span id="statWebhooks" class="font-mono text-zinc-700 font-semibold">0</span> Webhooks
        </p>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex border-b border-zinc-200 gap-1 mb-6 text-sm font-medium">
      <button onclick="switchTab('analytics')" id="tab-analytics" class="px-4 py-2.5 border-b-2 border-amber-500 text-amber-600 font-semibold flex items-center gap-2 transition">
        <i class="ph ph-chart-line-up text-base"></i>
        <span>Insights</span>
      </button>
      <button onclick="switchTab('studio')" id="tab-studio" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition">
        <i class="ph ph-lightning text-base"></i>
        <span>Verification Studio</span>
      </button>
      <button onclick="switchTab('payments')" id="tab-payments" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition">
        <i class="ph ph-table text-base"></i>
        <span>Payments Feed</span>
      </button>
      <button onclick="switchTab('apikeys')" id="tab-apikeys" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition">
        <i class="ph ph-key text-base"></i>
        <span>API Keys</span>
      </button>
      <button onclick="switchTab('webhooks')" id="tab-webhooks" class="px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition">
        <i class="ph ph-webhooks-logo text-base"></i>
        <span>Webhooks</span>
      </button>
    </div>

    <!-- TAB 1: Insights & Charts -->
    <section id="panel-analytics" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- 7-Day Volume Trend Line Chart -->
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

        <!-- Provider Distribution Doughnut Chart -->
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
            <button onclick="runStudioVerify()" id="btnStudioVerify" class="bg-amber-500 hover:bg-amber-400 text-zinc-950 px-5 py-2.5 rounded-xl font-bold text-xs transition shadow-md shadow-amber-500/20 flex items-center gap-2">
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
            <!-- Populated via JS -->
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
          <button onclick="filterProvider('ALL')" id="btn-filter-all" class="bg-amber-500 text-zinc-950 text-xs px-3.5 py-2 rounded-xl font-bold transition">All</button>
          <button onclick="filterProvider('TELEBIRR')" id="btn-filter-telebirr" class="bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl font-semibold transition">Telebirr</button>
          <button onclick="filterProvider('CBE')" id="btn-filter-cbe" class="bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200 text-xs px-3.5 py-2 rounded-xl font-semibold transition">CBE</button>
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
              </tr>
            </thead>
            <tbody id="paymentsTableBody" class="divide-y divide-zinc-100 font-mono text-xs">
              <tr><td colspan="7" class="p-8 text-center text-zinc-400">Loading verified payments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 4: API Keys with Creation AND Editing -->
    <section id="panel-apikeys" class="hidden space-y-6">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 border border-zinc-200 rounded-2xl gap-4 shadow-sm">
        <div>
          <h3 class="font-bold font-heading text-zinc-900">Create New API Key</h3>
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

    <!-- TAB 5: Webhooks -->
    <section id="panel-webhooks" class="hidden space-y-6">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 border border-zinc-200 rounded-2xl gap-4 shadow-sm">
        <div>
          <h3 class="font-bold font-heading text-zinc-900">Register Payment Webhook</h3>
          <p class="text-xs text-zinc-500">Chek sends signed HMAC SHA-256 HTTP POST notifications whenever a payment verifies.</p>
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
    </section>

  </div>

  <script>
    let currentAdminKey = localStorage.getItem('chek_admin_key') || '${urlKey}' || '';
    let selectedProviderFilter = 'ALL';
    let currentApiKeys = [];

    let volumeChartInstance = null;
    let providerChartInstance = null;
    let modeChartInstance = null;

    async function loginWithKey() {
      const key = (document.getElementById('modalAdminKey').value || currentAdminKey).trim();
      if (!key) return;

      try {
        const res = await fetch('/admin/api/metrics', {
          headers: { 'x-admin-key': key }
        });
        const data = await res.json();
        
        if (data.success) {
          currentAdminKey = key;
          localStorage.setItem('chek_admin_key', currentAdminKey);
          document.getElementById('authLockOverlay').classList.add('hidden');
          document.getElementById('mainApp').classList.remove('opacity-0');
          document.getElementById('authErrorMsg').classList.add('hidden');
          loadAll();
        } else {
          document.getElementById('authErrorMsg').classList.remove('hidden');
        }
      } catch (err) {
        document.getElementById('authErrorMsg').classList.remove('hidden');
      }
    }

    function logoutAdmin() {
      localStorage.removeItem('chek_admin_key');
      currentAdminKey = '';
      document.getElementById('authLockOverlay').classList.remove('hidden');
      document.getElementById('mainApp').classList.add('opacity-0');
    }

    function getHeaders() {
      return {
        'Content-Type': 'application/json',
        'x-admin-key': currentAdminKey
      };
    }

    function switchTab(tab) {
      ['analytics', 'studio', 'payments', 'apikeys', 'webhooks'].forEach(t => {
        document.getElementById('panel-' + t).classList.add('hidden');
        document.getElementById('tab-' + t).className = 'px-4 py-2.5 border-b-2 border-transparent text-zinc-500 hover:text-zinc-900 flex items-center gap-2 transition';
      });
      document.getElementById('panel-' + tab).classList.remove('hidden');
      document.getElementById('tab-' + tab).className = 'px-4 py-2.5 border-b-2 border-amber-500 text-amber-600 font-semibold flex items-center gap-2 transition';

      if (tab === 'analytics') loadMetrics();
      if (tab === 'payments') loadPayments();
      if (tab === 'apikeys') loadApiKeys();
      if (tab === 'webhooks') loadWebhooks();
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
          tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-zinc-400">No verified transactions recorded yet.</td></tr>';
          return;
        }
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
            </tr>
          \`;
        }).join('');
      } catch (err) { console.error(err); }
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
        document.getElementById('generatedKeyField').value = data.key;
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
      alert('Sending test payment.verified webhook event to destination...');
      await fetch('/admin/api/webhooks/' + id + '/test', { method: 'POST', headers: getHeaders() });
      alert('Webhook dispatched successfully!');
    }

    async function removeWebhook(id) {
      if (!confirm('Delete this webhook?')) return;
      await fetch('/admin/api/webhooks/' + id, { method: 'DELETE', headers: getHeaders() });
      loadWebhooks();
      loadMetrics();
    }

    function loadAll() {
      loadMetrics();
      loadPayments();
      loadApiKeys();
      loadWebhooks();
    }

    if (currentAdminKey) {
      loginWithKey();
    }
  </script>
</body>
</html>`;

  res.send(html);
});

// ─── ADMIN REST APIS ─────────────────────────────────────────────────────────

router.get('/api/metrics', checkAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(verifiedTransactions);
    const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` }).from(verifiedTransactions);
    const [{ activeKeys }] = await db.select({ activeKeys: sql<number>`count(*)::int` }).from(apiKeys).where(sql`is_active = true`);
    const [{ activeWebhooks }] = await db.select({ activeWebhooks: sql<number>`count(*)::int` }).from(webhooks).where(sql`is_active = true`);

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ todayCount }] = await db.select({ todayCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(sql`verified_at >= ${today.toISOString()}::timestamptz`);

    const [{ todayVolume }] = await db.select({ todayVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` })
      .from(verifiedTransactions)
      .where(sql`verified_at >= ${today.toISOString()}::timestamptz`);

    // Telebirr vs CBE stats
    const [{ telebirrCount }] = await db.select({ telebirrCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.provider, 'TELEBIRR'));

    const [{ telebirrVolume }] = await db.select({ telebirrVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.provider, 'TELEBIRR'));

    const [{ cbeCount }] = await db.select({ cbeCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.provider, 'CBE'));

    const [{ cbeVolume }] = await db.select({ cbeVolume: sql<string>`coalesce(sum(${verifiedTransactions.amount}), 0)` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.provider, 'CBE'));

    // Verification Mode counts
    const [{ liveApiCount }] = await db.select({ liveApiCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.verificationMode, 'LIVE_API'));

    const [{ localTextCount }] = await db.select({ localTextCount: sql<number>`count(*)::int` })
      .from(verifiedTransactions)
      .where(eq(verifiedTransactions.verificationMode, 'LOCAL_TEXT'));

    // Daily Trends (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyRows = await db.select({
      day: sql<string>`to_char(verified_at, 'Mon DD')`,
      volume: sql<number>`coalesce(sum(amount), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
      .from(verifiedTransactions)
      .where(sql`verified_at >= ${sevenDaysAgo.toISOString()}::timestamptz`)
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

router.post('/api/verify', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
      res.status(400).json({ success: false, error: 'Missing verification input.' });
      return;
    }

    const trimmed = input.trim();
    const result = await runSmartVerify({
      reference: trimmed.includes(' ') ? undefined : trimmed,
      receiptText: trimmed.includes(' ') ? trimmed : undefined,
    });

    if (result.success && result.data) {
      // Save verified result to database
      const txId = crypto.randomUUID();
      const verifiedAt = new Date();
      const d = result.data;
      const amountVal = d.settledAmount || d.amount || d.totalPaidAmount || '0.00';
      const cleanAmount = parseFloat(String(amountVal).replace(/[^0-9.]/g, '')) || 0;

      await db.insert(verifiedTransactions).values({
        id: txId,
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
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/transactions', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string)?.trim();
    const providerFilter = (req.query.provider as string)?.trim()?.toUpperCase();

    let conditions: any[] = [];

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
      .limit(50);

    const rows = conditions.length > 0
      ? await query.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`)
      : await query;

    res.json({ success: true, transactions: rows });
  } catch (err: any) {
    logger.error('Error fetching admin transactions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/api-keys', checkAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const keys = await listApiKeys();
    res.json({ success: true, keys });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/api-keys', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    const generated = await generateApiKey(name || 'Default App');
    res.json({ success: true, ...generated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/api/api-keys/:id', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;
    const updated = await updateApiKey(id, { name, isActive });
    res.json({ success: true, key: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/api-keys/:id', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const revoked = await revokeApiKey(id);
    res.json({ success: revoked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/webhooks', checkAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const hooks = await listWebhooks();
    res.json({ success: true, webhooks: hooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, events } = req.body;
    const hook = await registerWebhook(url, events);
    res.json({ success: true, webhook: hook });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/webhooks/:id/test', checkAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    await dispatchPaymentWebhook('payment.verified', {
      event: 'payment.verified',
      transaction: {
        id: crypto.randomUUID(),
        reference: 'TEST_WEBHOOK_REF',
        provider: 'TELEBIRR',
        amount: 500,
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

router.delete('/api/webhooks/:id', checkAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await deleteWebhook(id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
