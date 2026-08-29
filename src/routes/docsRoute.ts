import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response): void => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chek Documentation — Ethiopian Payment Verification API</title>
  
  <!-- Fonts: Outfit + Plus Jakarta Sans + JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Phosphor Icons -->
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>

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
    body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #ffffff; color: #09090b; scroll-behavior: smooth; }
    h1, h2, h3, h4, h5, h6, .font-heading { font-family: 'Outfit', sans-serif; }
    code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
    
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f4f4f5; }
    ::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: #a1a1aa; }
  </style>
</head>
<body class="bg-white text-zinc-900 antialiased min-h-screen selection:bg-amber-500/20 selection:text-amber-900">

  <!-- COMMAND PALETTE (Ctrl + K Modal) -->
  <div id="cmdPaletteOverlay" class="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-sm flex items-start justify-center pt-20 p-4 hidden">
    <div class="bg-white border border-zinc-200 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
      <div class="flex items-center px-4 border-b border-zinc-200">
        <i class="ph ph-magnifying-glass text-zinc-400 text-lg mr-2"></i>
        <input id="cmdPaletteInput" oninput="filterCmdResults()" type="text" placeholder="Search documentation, endpoints, guides... (type 'cbe', 'telebirr', 'webhook')" class="w-full py-3.5 text-xs text-zinc-900 outline-none font-sans bg-transparent" />
        <span class="text-[10px] font-mono text-zinc-400 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md">ESC</span>
      </div>
      
      <div id="cmdResultsList" class="p-2 max-h-80 overflow-y-auto space-y-1 text-xs">
        <a href="#quickstart" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-rocket text-amber-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Quickstart & API Keys</p>
              <p class="text-[11px] text-zinc-500">Authentication, base URLs, and your first verification</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Jump</span>
        </a>

        <a href="#universal-verify" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-lightning text-amber-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">POST /verify (Universal Endpoint)</p>
              <p class="text-[11px] text-zinc-500">Auto-routes Telebirr and CBE references or SMS text</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Endpoint</span>
        </a>

        <a href="#telebirr" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-device-mobile text-sky-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Telebirr Verification</p>
              <p class="text-[11px] text-zinc-500">10-digit transaction ID & natural Amharic/English SMS</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Guide</span>
        </a>

        <a href="#cbe" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-bank text-purple-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Commercial Bank of Ethiopia (CBE)</p>
              <p class="text-[11px] text-zinc-500">Mobile token API, legacy FT receipts, and VAT invoices</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Guide</span>
        </a>

        <a href="#webhooks" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-webhooks-logo text-emerald-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Webhooks & HMAC SHA-256</p>
              <p class="text-[11px] text-zinc-500">Real-time payment event delivery & signature validation</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Security</span>
        </a>

        <a href="#telegram-bot" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-paper-plane-tilt text-blue-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">Telegram Bot Tutorial</p>
              <p class="text-[11px] text-zinc-500">Complete bot script with automatic payment confirmation</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Tutorial</span>
        </a>

        <a href="#error-codes" onclick="closeCmdPalette()" class="cmd-item flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 transition text-zinc-800">
          <div class="flex items-center gap-2.5">
            <i class="ph-bold ph-warning-circle text-rose-500 text-base"></i>
            <div>
              <p class="font-semibold text-zinc-900">HTTP Status & Error Codes</p>
              <p class="text-[11px] text-zinc-500">200, 400, 401, 404, 422, 429, 502 reference</p>
            </div>
          </div>
          <span class="text-[10px] font-mono text-zinc-400">Reference</span>
        </a>
      </div>
      
      <div class="p-3 bg-zinc-50 border-t border-zinc-200 text-[11px] text-zinc-500 flex justify-between">
        <span>Use <kbd class="font-mono bg-white border border-zinc-200 px-1 rounded">↑</kbd> <kbd class="font-mono bg-white border border-zinc-200 px-1 rounded">↓</kbd> to navigate</span>
        <span>Press <kbd class="font-mono bg-white border border-zinc-200 px-1 rounded">ESC</kbd> to close</span>
      </div>
    </div>
  </div>

  <!-- Header Navigation -->
  <header class="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      
      <!-- Brand Logo -->
      <div class="flex items-center gap-3">
        <a href="/" class="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center font-bold text-amber-600 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="w-5 h-5 fill-current text-amber-600">
            <path d="M142 66.2C150.5 62.3 160.5 63.7 167.6 69.8L208 104.4L248.4 69.8C257.4 62.1 270.7 62.1 279.6 69.8L320 104.4L360.4 69.8C369.4 62.1 382.6 62.1 391.6 69.8L432 104.4L472.4 69.8C479.5 63.7 489.5 62.3 498 66.2C506.5 70.1 512 78.6 512 88L512 552C512 561.4 506.5 569.9 498 573.8C489.5 577.7 479.5 576.3 472.4 570.2L432 535.6L391.6 570.2C382.6 577.9 369.4 577.9 360.4 570.2L320 535.6L279.6 570.2C270.6 577.9 257.3 577.9 248.4 570.2L208 535.6L167.6 570.2C160.5 576.3 150.5 577.7 142 573.8C133.5 569.9 128 561.4 128 552L128 88C128 78.6 133.5 70.1 142 66.2zM232 200C218.7 200 208 210.7 208 224C208 237.3 218.7 248 232 248L408 248C421.3 248 432 237.3 432 224C432 210.7 421.3 200 408 200L232 200zM208 416C208 429.3 218.7 440 232 440L408 440C421.3 440 432 429.3 432 416C432 402.7 421.3 392 408 392L232 392C218.7 392 208 402.7 208 416zM232 296C218.7 296 208 306.7 208 320C208 333.3 218.7 344 232 344L408 344C421.3 344 432 333.3 432 320C432 306.7 421.3 296 408 296L232 296z"/>
          </svg>
        </a>
        <div class="flex items-center gap-2">
          <a href="/" class="text-base font-bold font-heading tracking-tight text-zinc-900">Chek</a>
          <span class="text-[11px] font-mono font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200 px-2 py-0.5 rounded-md">Docs</span>
        </div>
      </div>

      <!-- Search Trigger (Ctrl + K) -->
      <button onclick="openCmdPalette()" class="flex items-center gap-3 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 px-3 py-1.5 rounded-xl text-xs text-zinc-500 transition max-w-sm w-full mx-4 sm:w-72 justify-between shadow-sm">
        <span class="flex items-center gap-2">
          <i class="ph ph-magnifying-glass text-sm"></i>
          <span>Search documentation...</span>
        </span>
        <kbd class="font-mono text-[10px] bg-white border border-zinc-200 text-zinc-400 px-1.5 py-0.5 rounded shadow-sm">Ctrl K</kbd>
      </button>

      <!-- Action Buttons -->
      <div class="flex items-center gap-3">
        <a href="/admin" class="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition shadow-sm flex items-center gap-1.5">
          <span>Console</span>
          <i class="ph-bold ph-arrow-right"></i>
        </a>
      </div>
    </div>
  </header>

  <!-- Main Documentation Layout -->
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row gap-10">
    
    <!-- Sidebar Navigation -->
    <aside class="w-full md:w-64 shrink-0">
      <div class="sticky top-28 space-y-6 text-xs">
        <div>
          <p class="font-bold uppercase tracking-wider text-zinc-400 font-mono text-[11px] mb-2.5">Getting Started</p>
          <ul class="space-y-1 font-medium text-zinc-600">
            <li><a href="#quickstart" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">🚀 Quickstart</a></li>
            <li><a href="#authentication" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">🔑 Authentication</a></li>
            <li><a href="#rate-limits" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">⏱️ Rate Limits</a></li>
          </ul>
        </div>

        <div>
          <p class="font-bold uppercase tracking-wider text-zinc-400 font-mono text-[11px] mb-2.5">Verification Endpoints</p>
          <ul class="space-y-1 font-medium text-zinc-600">
            <li><a href="#universal-verify" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition font-mono">POST /verify</a></li>
            <li><a href="#batch-verify" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition font-mono">POST /verify-batch</a></li>
            <li><a href="#telebirr" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">Telebirr Engine</a></li>
            <li><a href="#cbe" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">CBE Engine</a></li>
          </ul>
        </div>

        <div>
          <p class="font-bold uppercase tracking-wider text-zinc-400 font-mono text-[11px] mb-2.5">Integrations & Guides</p>
          <ul class="space-y-1 font-medium text-zinc-600">
            <li><a href="#webhooks" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">⚡ Webhooks & HMAC</a></li>
            <li><a href="#telegram-bot" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">🤖 Telegram Bot Guide</a></li>
            <li><a href="#error-codes" class="block px-3 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition">⚠️ Error Codes Reference</a></li>
          </ul>
        </div>
      </div>
    </aside>

    <!-- Content Area -->
    <main class="flex-1 max-w-3xl space-y-14">
      
      <!-- Section: Quickstart -->
      <section id="quickstart" class="space-y-4">
        <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[11px] font-mono font-semibold border border-amber-200">
          <span>Overview</span>
        </div>
        <h1 class="text-3xl font-bold font-heading text-zinc-950">Developer Quickstart</h1>
        <p class="text-sm text-zinc-600 leading-relaxed">
          Chek verifies Ethiopian payments from <strong>Telebirr</strong> and the <strong>Commercial Bank of Ethiopia (CBE)</strong> in under 2 seconds. You can verify payments by sending a 10-character transaction reference, CBE Mobile receipt token, or pasting the full customer SMS text.
        </p>

        <div class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl">
          <p class="text-xs font-semibold text-zinc-900 mb-1">Base API URLs</p>
          <ul class="text-xs font-mono text-zinc-600 space-y-1">
            <li>• Local Server: <code class="text-zinc-900 bg-white px-1.5 py-0.5 rounded border border-zinc-200">http://localhost:3001</code></li>
            <li>• Production: <code class="text-zinc-900 bg-white px-1.5 py-0.5 rounded border border-zinc-200">https://your-domain.com</code></li>
          </ul>
        </div>
      </section>

      <!-- Section: Authentication -->
      <section id="authentication" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">Authentication</h2>
        <p class="text-sm text-zinc-600">
          All client requests require an API key in the <code class="bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono">x-api-key</code> header. You can generate keys from the <a href="/admin" class="text-amber-600 underline font-medium">Console</a>.
        </p>

        <pre class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs font-mono text-zinc-800 overflow-x-auto"><code>x-api-key: sk_live_your_api_key_here</code></pre>
      </section>

      <!-- Section: Universal Verification -->
      <section id="universal-verify" class="space-y-4 pt-8 border-t border-zinc-200">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-mono font-bold border border-emerald-200">POST</span>
          <h2 class="text-2xl font-bold font-heading text-zinc-900 font-mono">/verify</h2>
        </div>
        <p class="text-sm text-zinc-600">
          The universal endpoint auto-detects the payment provider (Telebirr vs CBE) based on pattern matching or receipt text content.
        </p>

        <div class="space-y-3">
          <p class="text-xs font-semibold text-zinc-800">Example Request (cURL):</p>
          <pre class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs font-mono text-zinc-800 overflow-x-auto"><code>curl -X POST http://localhost:3001/verify \
  -H "x-api-key: sk_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reference": "DHS78S7FQN"}'</code></pre>
        </div>

        <div class="space-y-3">
          <p class="text-xs font-semibold text-zinc-800">Example Verified Response (HTTP 200):</p>
          <pre class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs font-mono text-emerald-800 overflow-x-auto"><code>{
  "success": true,
  "provider": "TELEBIRR",
  "data": {
    "receiptNo": "DHS78S7FQN",
    "payerName": "Eyuel Getachew Angassa",
    "payerTelebirrNo": "2519****7061",
    "creditedPartyName": "Gelila Bekele Dibaba",
    "settledAmount": "200 Birr",
    "serviceFee": "1.74 Birr",
    "totalPaidAmount": "202 Birr",
    "transactionStatus": "Completed",
    "paymentDate": "28-08-2026 17:45:59",
    "verificationMode": "LIVE_API"
  },
  "httpStatus": 200
}</code></pre>
        </div>
      </section>

      <!-- Section: Telebirr Engine -->
      <section id="telebirr" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">Telebirr Verification</h2>
        <p class="text-sm text-zinc-600">
          Telebirr references are 10-character alphanumeric codes (e.g. <code class="bg-zinc-100 px-1 py-0.5 rounded text-xs font-mono">DHS78S7FQN</code>). Chek performs a live lookup against the Ethio Telecom receipt gateway with an instant fallback to local regex SMS parser.
        </p>

        <div class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs text-zinc-700 space-y-2">
          <p class="font-bold text-zinc-900">Supported Telebirr Formats:</p>
          <ul class="list-disc pl-4 space-y-1 font-mono text-[11px]">
            <li>10-char reference: <code>DHS78S7FQN</code></li>
            <li>Natural SMS notification: <code>"You have received 200 ETB from Eyuel Getachew on 28/08/2026. Txn ID: DHS78S7FQN"</code></li>
            <li>Structured key-value receipt text copied from mobile app.</li>
          </ul>
        </div>
      </section>

      <!-- Section: CBE Engine -->
      <section id="cbe" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">Commercial Bank of Ethiopia (CBE)</h2>
        <p class="text-sm text-zinc-600">
          CBE verifications support new Mobile App URL tokens (e.g. <code class="bg-zinc-100 px-1 py-0.5 rounded text-xs font-mono">https://mbreciept.cbe.com.et/TOKEN</code>), legacy FT references with payer account suffix, and official VAT invoice receipts.
        </p>

        <div class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs text-zinc-700 space-y-2">
          <p class="font-bold text-zinc-900">CBE Methods:</p>
          <ul class="list-disc pl-4 space-y-1 font-mono text-[11px]">
            <li>Mobile Token: <code>{"reference": "hfHCxGIt9KKGN61d55FL"}</code></li>
            <li>Legacy Reference + Suffix: <code>{"reference": "FT1234567890", "accountSuffix": "12345678"}</code></li>
            <li>SMS Receipt text: <code>{"receiptText": "Dear Customer, account 1000*** credited with ETB 500.00 by Abebe. Ref: FT..."}</code></li>
          </ul>
        </div>
      </section>

      <!-- Section: Webhooks -->
      <section id="webhooks" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">Webhooks & HMAC SHA-256</h2>
        <p class="text-sm text-zinc-600">
          Chek sends HTTP POST notifications with the <code class="bg-zinc-100 px-1 py-0.5 rounded text-xs font-mono">X-Chek-Signature</code> header whenever a payment confirms.
        </p>

        <pre class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs font-mono text-zinc-800 overflow-x-auto"><code>// Node.js Express Webhook Validator
import crypto from 'crypto';

app.post('/api/payment-webhook', (req, res) => {
  const signature = req.headers['x-chek-signature'];
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.CHEK_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const { transaction } = req.body;
  console.log('Payment Confirmed:', transaction.reference, transaction.amount);
  res.json({ received: true });
});</code></pre>
      </section>

      <!-- Section: Telegram Bot Guide -->
      <section id="telegram-bot" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">Telegram Bot Tutorial</h2>
        <p class="text-sm text-zinc-600">
          Here is a production-ready Telegram bot script using <code class="bg-zinc-100 px-1 py-0.5 rounded text-xs font-mono">telegraf</code> that lets customers pay you and automatically unlocks their order:
        </p>

        <pre class="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-xs font-mono text-zinc-800 overflow-x-auto"><code>import { Telegraf } from 'telegraf';
import axios from 'axios';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.length < 10) return;

  await ctx.reply('⏳ Verifying payment with bank network...');

  try {
    const res = await axios.post('http://localhost:3001/verify', {
      reference: text.includes(' ') ? undefined : text,
      receiptText: text.includes(' ') ? text : undefined
    }, {
      headers: { 'x-api-key': process.env.CHEK_API_KEY }
    });

    if (res.data.success) {
      const d = res.data.data;
      await ctx.reply(\`✅ Payment Verified!\n\n• Amount: \${d.settledAmount || d.amount} ETB\n• Payer: \${d.payerName || d.payer}\n• Ref: \${d.receiptNo || d.reference}\n\n🎉 Order unlocked!\`);
    } else {
      await ctx.reply(\`❌ Verification failed: \${res.data.error}\`);
    }
  } catch (err) {
    await ctx.reply('⚠️ Verification error. Please check reference.');
  }
});

bot.launch();</code></pre>
      </section>

      <!-- Section: Error Codes Reference -->
      <section id="error-codes" class="space-y-4 pt-8 border-t border-zinc-200">
        <h2 class="text-2xl font-bold font-heading text-zinc-900">HTTP Status & Error Codes</h2>
        
        <div class="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
          <table class="w-full text-left text-xs font-sans text-zinc-700">
            <thead class="bg-zinc-50 border-b border-zinc-200 font-mono text-zinc-500">
              <tr>
                <th class="p-3">Status</th>
                <th class="p-3">Meaning</th>
                <th class="p-3">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
              <tr>
                <td class="p-3 font-mono font-bold text-emerald-600">200 OK</td>
                <td class="p-3 font-semibold text-zinc-900">Verified</td>
                <td class="p-3 text-zinc-600">Transaction successfully verified on bank/telecom network.</td>
              </tr>
              <tr>
                <td class="p-3 font-mono font-bold text-amber-600">400 Bad Request</td>
                <td class="p-3 font-semibold text-zinc-900">Invalid Input</td>
                <td class="p-3 text-zinc-600">Missing reference, malformed token, or missing account suffix.</td>
              </tr>
              <tr>
                <td class="p-3 font-mono font-bold text-rose-600">401 Unauthorized</td>
                <td class="p-3 font-semibold text-zinc-900">Unauthorized</td>
                <td class="p-3 text-zinc-600">Missing or revoked <code>x-api-key</code> header.</td>
              </tr>
              <tr>
                <td class="p-3 font-mono font-bold text-rose-600">404 Not Found</td>
                <td class="p-3 font-semibold text-zinc-900">Not Found</td>
                <td class="p-3 text-zinc-600">Reference number does not exist on bank portal.</td>
              </tr>
              <tr>
                <td class="p-3 font-mono font-bold text-rose-600">422 Unprocessable</td>
                <td class="p-3 font-semibold text-zinc-900">Parsing Mismatch</td>
                <td class="p-3 text-zinc-600">SMS text amount or reference does not match expected fields.</td>
              </tr>
              <tr>
                <td class="p-3 font-mono font-bold text-purple-600">429 Rate Limited</td>
                <td class="p-3 font-semibold text-zinc-900">Rate Limited</td>
                <td class="p-3 text-zinc-600">Exceeded 60 requests/minute rate limit.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </main>
  </div>

  <script>
    function openCmdPalette() {
      document.getElementById('cmdPaletteOverlay').classList.remove('hidden');
      document.getElementById('cmdPaletteInput').value = '';
      filterCmdResults();
      setTimeout(() => document.getElementById('cmdPaletteInput').focus(), 50);
    }

    function closeCmdPalette() {
      document.getElementById('cmdPaletteOverlay').classList.add('hidden');
    }

    function filterCmdResults() {
      const q = document.getElementById('cmdPaletteInput').value.toLowerCase().trim();
      const items = document.querySelectorAll('.cmd-item');
      items.forEach(item => {
        const text = item.innerText.toLowerCase();
        item.classList.toggle('hidden', q && !text.includes(q));
      });
    }

    // Ctrl + K or Cmd + K listener
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
  </script>
</body>
</html>`;

  res.send(html);
});

export default router;
