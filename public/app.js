/**
 * 🧾 Chek Web Console — Client-Side Logic & Dynamic GitHub Release Sync
 */

let currentStudioMode = 'ref';
let apiKey = localStorage.getItem('chek_api_key') || '';

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  updateApiKeyDisplay();
  setDocLang('ts');
  fetchLatestRelease(false);
});

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(el => {
    el.classList.remove('active', 'text-white', 'bg-zinc-800', 'shadow-sm');
    el.classList.add('text-zinc-400');
  });

  const view = document.getElementById(`view-${tabId}`);
  const tabBtn = document.getElementById(`tab-${tabId}`);
  if (view) view.classList.remove('hidden');
  if (tabBtn) {
    tabBtn.classList.add('active', 'text-white', 'bg-zinc-800', 'shadow-sm');
    tabBtn.classList.remove('text-zinc-400');
  }

  if (window.lucide) window.lucide.createIcons();
}

// ── Dynamic GitHub Release & QR Code Sync ─────────────────────────────────────
async function fetchLatestRelease(showNotification = false) {
  const syncIcon = document.getElementById('sync-icon');
  if (syncIcon) syncIcon.classList.add('animate-spin');

  try {
    const response = await fetch('https://api.github.com/repos/Joelorbit/chek/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (response.ok) {
      const release = await response.json();
      applyReleaseData(release);
      if (showNotification) alert(`Synchronized with latest GitHub release: ${release.tag_name}`);
    } else {
      // Fallback if no release is published yet
      applyFallbackRelease();
    }
  } catch (err) {
    console.warn('GitHub API sync fallback:', err);
    applyFallbackRelease();
  } finally {
    if (syncIcon) syncIcon.classList.remove('animate-spin');
    if (window.lucide) window.lucide.createIcons();
  }
}

function applyReleaseData(release) {
  const tag = release.tag_name || 'v3.0.3';
  const name = release.name || `Chek ${tag}`;
  const date = release.published_at ? new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Latest';
  const notes = release.body || 'Production build of Chek payment verification engine, multi-bank router, and mobile client.';

  // Update header and card badges
  const navBadge = document.getElementById('nav-release-tag');
  const relTag = document.getElementById('rel-tag');
  const relName = document.getElementById('rel-name');
  const relDate = document.getElementById('rel-date');
  const relNotes = document.getElementById('rel-notes');

  if (navBadge) navBadge.innerText = tag;
  if (relTag) relTag.innerText = tag;
  if (relName) relName.innerText = name;
  if (relDate) relDate.innerText = date;
  if (relNotes) relNotes.innerText = notes;

  // Search for an APK asset or default to release page
  let downloadUrl = release.html_url || 'https://github.com/Joelorbit/chek/releases/latest';
  if (Array.isArray(release.assets) && release.assets.length > 0) {
    const apkAsset = release.assets.find(a => a.name.endsWith('.apk') || a.name.endsWith('.tar.gz') || a.name.endsWith('.zip'));
    if (apkAsset) {
      downloadUrl = apkAsset.browser_download_url;
      const downloadLabel = document.getElementById('download-btn-label');
      if (downloadLabel) downloadLabel.innerText = `Download ${apkAsset.name} (${(apkAsset.size / (1024 * 1024)).toFixed(1)} MB)`;
    }
  }

  // Update button links
  const btnApk = document.getElementById('btn-download-apk');
  const btnRelease = document.getElementById('btn-view-release');
  if (btnApk) btnApk.href = downloadUrl;
  if (btnRelease) btnRelease.href = release.html_url || 'https://github.com/Joelorbit/chek/releases';

  // Update Live QR Code
  const qrImg = document.getElementById('rel-qrcode-img');
  const qrUrlLabel = document.getElementById('qr-target-url');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(downloadUrl)}`;
  }
  if (qrUrlLabel) {
    qrUrlLabel.innerText = downloadUrl;
  }
}

function applyFallbackRelease() {
  const defaultUrl = 'https://github.com/Joelorbit/chek/releases/latest';
  const qrImg = document.getElementById('rel-qrcode-img');
  const qrUrlLabel = document.getElementById('qr-target-url');

  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(defaultUrl)}`;
  }
  if (qrUrlLabel) {
    qrUrlLabel.innerText = defaultUrl;
  }
  const relNotes = document.getElementById('rel-notes');
  if (relNotes) {
    relNotes.innerText = 'Chek Ethiopian Payment Verification Engine — Release sync operational.';
  }
}

// ── Studio Mode Switch ────────────────────────────────────────────────────────
function setStudioMode(mode) {
  currentStudioMode = mode;
  const refBtn = document.getElementById('mode-ref-btn');
  const textBtn = document.getElementById('mode-text-btn');
  const refView = document.getElementById('studio-ref-mode');
  const textView = document.getElementById('studio-text-mode');

  if (mode === 'ref') {
    refBtn.className = 'px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 text-white transition-all';
    textBtn.className = 'px-2.5 py-1 rounded text-xs font-medium text-zinc-400 hover:text-white transition-all';
    refView.classList.remove('hidden');
    textView.classList.add('hidden');
    handleReferenceInput(document.getElementById('input-reference').value);
  } else {
    textBtn.className = 'px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 text-white transition-all';
    refBtn.className = 'px-2.5 py-1 rounded text-xs font-medium text-zinc-400 hover:text-white transition-all';
    textView.classList.remove('hidden');
    refView.classList.add('hidden');
    handleReceiptTextInput(document.getElementById('input-receipt-text').value);
  }
}

// ── Real-Time Pattern Detection ───────────────────────────────────────────────
function detectPattern(input, suffix, text) {
  const str = (input || '').trim();

  if (text && text.trim()) {
    const lower = text.toLowerCase();
    if (/\b(commercial\s+bank\s+of\s+ethiopia|cbe)\b/i.test(lower) && !/\bcbe\s*birr\b/i.test(lower)) return { name: 'CBE (from text)', color: 'text-amber-400', provider: 'CBE' };
    if (/\b(cbe\s*birr)\b/i.test(lower)) return { name: 'CBE Birr (from text)', color: 'text-amber-400', provider: 'CBE_BIRR' };
    if (/\b(bank\s+of\s+abyssinia|abyssinia|boa)\b/i.test(lower)) return { name: 'Bank of Abyssinia (from text)', color: 'text-purple-400', provider: 'ABYSSINIA' };
    if (/\b(dashen)\b/i.test(lower)) return { name: 'Dashen Bank (from text)', color: 'text-blue-400', provider: 'DASHEN' };
    if (/\b(telebirr|ethiotelecom)\b/i.test(lower)) return { name: 'Telebirr (from text)', color: 'text-emerald-400', provider: 'TELEBIRR' };
    if (/\b(awash|awashbirr)\b/i.test(lower)) return { name: 'Awash Bank (from text)', color: 'text-cyan-400', provider: 'AWASH' };
    if (/\b(coop|cooperative\s+bank|coopay)\b/i.test(lower)) return { name: 'Cooperative Bank (from text)', color: 'text-teal-400', provider: 'COOP' };
    if (/\b(hibret|united\s+bank)\b/i.test(lower)) return { name: 'Hibret Bank (from text)', color: 'text-pink-400', provider: 'HIBRET' };
    if (/\b(zemen)\b/i.test(lower)) return { name: 'Zemen Bank (from text)', color: 'text-indigo-400', provider: 'ZEMEN' };
    return { name: 'Ethiopian Bank Text', color: 'text-brand-400', provider: 'GENERIC_BANK' };
  }

  if (!str) return { name: 'Auto-Detecting...', color: 'text-zinc-500', provider: null };

  if (str.includes('mbreciept.cbe.com.et') || (!str.toUpperCase().startsWith('FT') && /^[A-Za-z0-9-]{15,40}$/.test(str))) {
    return { name: 'CBE Mobile Token', color: 'text-amber-400', provider: 'CBE' };
  }
  if (/^FT[A-Za-z0-9]{10}\d{5}$/i.test(str)) {
    return { name: 'Bank of Abyssinia (Combined)', color: 'text-purple-400', provider: 'ABYSSINIA', suffix: str.slice(-5) };
  }
  if (/^FT[A-Za-z0-9]{10}\d{8}$/i.test(str)) {
    return { name: 'CBE Legacy (Combined)', color: 'text-amber-400', provider: 'CBE', suffix: str.slice(-8) };
  }
  if (/^FT[A-Za-z0-9]{10}$/i.test(str)) {
    if (suffix?.length === 5) return { name: 'Bank of Abyssinia', color: 'text-purple-400', provider: 'ABYSSINIA' };
    if (suffix?.length === 8) return { name: 'CBE Legacy', color: 'text-amber-400', provider: 'CBE' };
    return { name: 'FT Ref (CBE / BoA)', color: 'text-amber-300', provider: 'AMBIGUOUS' };
  }
  if (/^[A-Za-z0-9]{10}$/.test(str)) {
    return { name: 'Telebirr 10-Char Ref', color: 'text-emerald-400', provider: 'TELEBIRR' };
  }
  if (/^\d{16}$/.test(str)) {
    return { name: 'Dashen 16-Digit Ref', color: 'text-blue-400', provider: 'DASHEN' };
  }

  return { name: 'Custom Ref', color: 'text-zinc-300', provider: 'UNKNOWN' };
}

function handleReferenceInput(val) {
  const extraContainer = document.getElementById('extra-fields-container');
  const fieldSuffix = document.getElementById('field-suffix');
  const fieldPhone = document.getElementById('field-phone');
  const suffixHint = document.getElementById('suffix-hint');
  const badge = document.getElementById('detection-badge');

  const trimmed = (val || '').trim();
  const detection = detectPattern(trimmed, document.getElementById('input-suffix')?.value);

  badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-current ${detection.color}"></span><span class="${detection.color}">${detection.name}</span>`;

  if (/^FT[A-Za-z0-9]{10}$/i.test(trimmed)) {
    extraContainer.classList.remove('hidden');
    fieldSuffix.classList.remove('hidden');
    fieldPhone.classList.add('hidden');
    suffixHint.innerText = '(5 digits for BoA, 8 for CBE)';
  } else if (/^[A-Za-z0-9]{10}$/.test(trimmed)) {
    extraContainer.classList.remove('hidden');
    fieldPhone.classList.remove('hidden');
    fieldSuffix.classList.add('hidden');
  } else {
    extraContainer.classList.add('hidden');
  }
}

function handleReceiptTextInput(val) {
  const badge = document.getElementById('detection-badge');
  const detection = detectPattern(document.getElementById('input-text-ref')?.value, null, val);
  badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-current ${detection.color}"></span><span class="${detection.color}">${detection.name}</span>`;
}

function clearReferenceInput() {
  document.getElementById('input-reference').value = '';
  document.getElementById('input-suffix').value = '';
  handleReferenceInput('');
}

// ── Quick Presets ─────────────────────────────────────────────────────────────
function fillPreset(type) {
  setStudioMode('ref');
  const refInput = document.getElementById('input-reference');
  const sufInput = document.getElementById('input-suffix');

  if (type === 'telebirr') {
    refInput.value = 'AB12CD34EF';
    sufInput.value = '';
  } else if (type === 'abyssinia') {
    refInput.value = 'FT23062669JJ';
    sufInput.value = '90172';
  } else if (type === 'dashen') {
    refInput.value = '3123456789012345';
    sufInput.value = '';
  } else if (type === 'cbe') {
    refInput.value = 'https://mbreciept.cbe.com.et/sample-cbe-token-12345';
    sufInput.value = '';
  } else if (type === 'awash') {
    setStudioMode('text');
    document.getElementById('input-text-ref').value = 'AW123456789';
    document.getElementById('input-receipt-text').value = 'Awash Bank Ref: AW123456789\nSender Name: Abebe Kebede\nReceiver Name: Chala Tadesse\nTransferred Amount: 4,500.00\nDate: 2026-08-28 10:30:00 AM';
    handleReceiptTextInput(document.getElementById('input-receipt-text').value);
    return;
  }
  handleReferenceInput(refInput.value);
}

// ── Execute Verification ──────────────────────────────────────────────────────
async function executeStudioVerification() {
  const idleView = document.getElementById('result-idle');
  const loadingView = document.getElementById('result-loading');
  const successView = document.getElementById('result-success');
  const errorView = document.getElementById('result-error');
  const execTimer = document.getElementById('exec-timer');

  idleView.classList.add('hidden');
  successView.classList.add('hidden');
  errorView.classList.add('hidden');
  loadingView.classList.remove('hidden');

  const startTime = Date.now();

  let body = {};
  if (currentStudioMode === 'ref') {
    const rawRef = document.getElementById('input-reference').value.trim();
    const rawSuf = document.getElementById('input-suffix').value.trim();
    const rawPhone = document.getElementById('input-phone').value.trim();

    if (!rawRef) {
      alert('Please enter a reference or token.');
      loadingView.classList.add('hidden');
      idleView.classList.remove('hidden');
      return;
    }

    body = { reference: rawRef };
    if (rawSuf) body.suffix = rawSuf;
    if (rawPhone) body.phoneNumber = rawPhone;
  } else {
    const rawText = document.getElementById('input-receipt-text').value.trim();
    const rawRef = document.getElementById('input-text-ref').value.trim() || 'RECEIPT_TEXT';

    if (!rawText) {
      alert('Please paste the receipt text.');
      loadingView.classList.add('hidden');
      idleView.classList.remove('hidden');
      return;
    }

    body = { reference: rawRef, receiptText: rawText };
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const response = await fetch('/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    const duration = Date.now() - startTime;
    execTimer.innerText = `${duration}ms`;

    loadingView.classList.add('hidden');

    if (data.success || data.transactionStatus || data.status === 'success' || data.amount) {
      renderSuccessResult(data, body.reference);
      successView.classList.remove('hidden');
    } else {
      document.getElementById('error-message').innerText = data.error || 'Verification failed.';
      errorView.classList.remove('hidden');
    }
  } catch (err) {
    loadingView.classList.add('hidden');
    document.getElementById('error-message').innerText = err.message || 'Network request failed.';
    errorView.classList.remove('hidden');
  }

  if (window.lucide) window.lucide.createIcons();
}

function renderSuccessResult(res, refInput) {
  const payload = res.data || res;

  const amountVal = payload.amount || payload.transferredAmount || payload.transactionAmount || payload.totalPaidAmount || 0;
  const payerVal = payload.payer || payload.payerName || payload.senderName || payload.customerName || 'N/A';
  const receiverVal = payload.receiver || payload.receiverName || payload.creditedPartyName || 'Merchant Store';
  const dateVal = payload.date || payload.transactionDate || payload.paymentDate || new Date().toISOString();
  const refVal = payload.reference || payload.receiptNo || payload.transactionReference || refInput || '---';
  const statusVal = payload.transactionStatus || payload.status || 'COMPLETED';

  document.getElementById('res-amount').innerText = typeof amountVal === 'number' ? `${amountVal.toLocaleString()} ETB` : `${amountVal}`;
  document.getElementById('res-payer').innerText = payerVal;
  document.getElementById('res-receiver').innerText = receiverVal;
  document.getElementById('res-ref').querySelector('span').innerText = refVal;
  document.getElementById('res-date').innerText = new Date(dateVal).toLocaleString();
  document.getElementById('res-status').innerText = statusVal.toUpperCase();

  if (payload.narrative || payload.reason) {
    document.getElementById('res-narrative').innerText = payload.narrative || payload.reason;
    document.getElementById('res-narrative-row').classList.remove('hidden');
  } else {
    document.getElementById('res-narrative-row').classList.add('hidden');
  }

  document.getElementById('res-raw-json').innerText = JSON.stringify(res, null, 2);
}

function copyRefToClipboard() {
  const refText = document.getElementById('res-ref').querySelector('span').innerText;
  navigator.clipboard.writeText(refText);
  alert(`Copied ${refText} to clipboard!`);
}

// ── Batch Verifier ────────────────────────────────────────────────────────────
async function runBatchVerification() {
  const text = document.getElementById('batch-input').value.trim();
  if (!text) {
    alert('Please enter references.');
    return;
  }

  const lines = text.split('\n').filter(Boolean);
  const references = lines.map(l => {
    const parts = l.trim().split(/\s+/);
    return { reference: parts[0], suffix: parts[1] };
  });

  const table = document.getElementById('batch-results-table');
  table.innerHTML = '<div class="text-center text-zinc-400 py-6">Processing concurrent batch...</div>';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const response = await fetch('/verify-batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ references })
    });

    const data = await response.json();
    document.getElementById('batch-stats').innerText = `${data.succeeded || 0}/${data.total || references.length} Succeeded`;

    if (data.results && data.results.length > 0) {
      table.innerHTML = data.results.map(r => `
        <div class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full ${r.success ? 'bg-brand-400' : 'bg-rose-400'}"></span>
            <span class="font-bold text-white">${r.reference}</span>
            <span class="text-zinc-500">${r.provider || ''}</span>
          </div>
          <span class="${r.success ? 'text-brand-400 font-bold' : 'text-rose-400'}">${r.success ? 'VERIFIED' : (r.error || 'FAILED')}</span>
        </div>
      `).join('');
    } else {
      table.innerHTML = `<div class="text-rose-400 p-3">${data.error || 'Batch failed'}</div>`;
    }
  } catch (err) {
    table.innerHTML = `<div class="text-rose-400 p-3">${err.message}</div>`;
  }
}

// ── Webhook Signature Generator ───────────────────────────────────────────────
async function computeHmacSignature() {
  const secret = document.getElementById('wh-secret').value.trim();
  const payload = document.getElementById('wh-payload').value.trim();
  const out = document.getElementById('wh-signature-out');

  if (!secret || !payload) {
    out.innerText = 'Please provide both secret and JSON payload.';
    return;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  out.innerHTML = `<div class="text-zinc-400 font-bold mb-1">X-Chek-Signature:</div><div class="text-brand-400 font-bold">sha256=${hex}</div>`;
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function openApiKeyModal() {
  document.getElementById('modal-key-input').value = apiKey;
  document.getElementById('modal-apikey').classList.remove('hidden');
}

function closeApiKeyModal() {
  document.getElementById('modal-apikey').classList.add('hidden');
}

function saveApiKey() {
  apiKey = document.getElementById('modal-key-input').value.trim();
  localStorage.setItem('chek_api_key', apiKey);
  updateApiKeyDisplay();
  closeApiKeyModal();
}

function updateApiKeyDisplay() {
  const label = document.getElementById('api-key-label');
  if (apiKey) {
    label.innerText = apiKey.slice(0, 10) + '...';
  } else {
    label.innerText = 'Set API Key';
  }
}

// ── Code Generator ────────────────────────────────────────────────────────────
function setDocLang(lang) {
  ['ts', 'py', 'curl'].forEach(l => {
    const b = document.getElementById(`lang-${l}`);
    if (b) {
      b.className = l === lang
        ? 'px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 text-white'
        : 'px-2.5 py-1 rounded text-xs font-medium text-zinc-400 hover:text-white';
    }
  });

  const block = document.getElementById('doc-code-block');
  if (lang === 'ts') {
    block.innerText = `import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.chek.et',
  headers: { 'x-api-key': '${apiKey || 'chk_live_YOUR_KEY'}' }
});

async function verify() {
  const { data } = await client.post('/verify', {
    reference: 'FT23062669JJ',
    suffix: '90172'
  });
  console.log('Verified Result:', data);
}`;
  } else if (lang === 'py') {
    block.innerText = `import requests

API_KEY = "${apiKey || 'chk_live_YOUR_KEY'}"

response = requests.post(
    "https://api.chek.et/verify",
    headers={"x-api-key": API_KEY},
    json={"reference": "FT23062669JJ", "suffix": "90172"}
)
print(response.json())`;
  } else {
    block.innerText = `curl -X POST https://api.chek.et/verify \\
  -H "x-api-key: ${apiKey || 'chk_live_YOUR_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"reference": "FT23062669JJ", "suffix": "90172"}'`;
  }
}

// ── Payment Link Preview ──────────────────────────────────────────────────────
function previewPaymentLink() {
  const title = document.getElementById('pl-title').value;
  const amount = document.getElementById('pl-amount').value;
  document.getElementById('prev-title').innerText = title;
  document.getElementById('prev-amount').innerText = `${Number(amount).toFixed(2)} ETB`;
}

// ── OCR File Handling ─────────────────────────────────────────────────────────
function handleOcrFileSelected(files) {
  if (!files || !files[0]) return;
  const file = files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('ocr-preview-img').src = e.target.result;
    document.getElementById('ocr-preview-container').classList.remove('hidden');
    document.getElementById('ocr-status').innerText = `Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  };
  reader.readAsDataURL(file);
}

async function runOcrVerify() {
  const fileInput = document.getElementById('ocr-file-input');
  if (!fileInput.files[0]) return;

  const btn = document.getElementById('btn-run-ocr');
  const status = document.getElementById('ocr-status');
  btn.disabled = true;
  btn.innerText = 'Extracting Receipt Data...';
  status.innerText = 'Uploading to Mistral Vision engine...';

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const headers = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    const response = await fetch('/verify-image?autoVerify=true', {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    btn.disabled = false;
    btn.innerText = 'Run Multimodal Vision OCR';

    if (data.success) {
      status.innerHTML = `<span class="text-brand-400 font-bold">Extracted & Verified! Reference: ${data.data?.reference || data.reference} (${data.data?.amount || data.amount} ETB)</span>`;
    } else {
      status.innerHTML = `<span class="text-rose-400 font-bold">Extraction failed: ${data.error || 'Unknown error'}</span>`;
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerText = 'Run Multimodal Vision OCR';
    status.innerHTML = `<span class="text-rose-400 font-bold">Error: ${err.message}</span>`;
  }
}
