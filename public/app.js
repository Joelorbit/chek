/**
 * 🧾 Chek Engine Web Client (Light Modern Fintech Theme)
 */

let latestVerificationJson = null;

// Global keyboard shortcuts (Ctrl+K or ⌘K for Command Palette, ESC to close modals)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCmdPalette();
  } else if (e.key === 'Escape') {
    closeCmdPalette();
    closeAuthModal();
  }
});

// ── Command Palette ─────────────────────────────────────────────────────────
function openCmdPalette() {
  const overlay = document.getElementById('cmdPaletteOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const input = document.getElementById('cmdPaletteInput');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
  }
}

function closeCmdPalette() {
  const overlay = document.getElementById('cmdPaletteOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function filterCmdList() {
  const q = (document.getElementById('cmdPaletteInput')?.value || '').toLowerCase().trim();
  const items = document.querySelectorAll('#cmdResultsList a, #cmdResultsList button');
  items.forEach(el => {
    const text = el.innerText.toLowerCase();
    el.style.display = !q || text.includes(q) ? 'flex' : 'none';
  });
}

// ── Sample Presets (Telebirr & CBE) ──────────────────────────────────────────
function setSample(type) {
  const input = document.getElementById('omniInput');
  if (!input) return;

  if (type === 'telebirr') {
    input.value = 'DHS78S7FQN';
  } else if (type === 'cbe') {
    input.value = 'FT240626691234';
  }
  handleOmniVerify();
}

// ── Omni-Verification (Telebirr & CBE) ───────────────────────────────────────
async function handleOmniVerify(e) {
  if (e) e.preventDefault();

  const inputEl = document.getElementById('omniInput');
  const rawVal = (inputEl?.value || '').trim();
  if (!rawVal) return;

  const btn = document.getElementById('btnOmniVerify');
  const originalBtn = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="ph ph-spinner animate-spin text-sm"></i><span>Verifying...</span>';
    btn.disabled = true;
  }

  const startTime = performance.now();

  try {
    const res = await fetch('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: rawVal })
    });

    const data = await res.json();
    const duration = Math.round(performance.now() - startTime);

    displayVerificationResult(data, duration, rawVal);
  } catch (err) {
    alert('Verification request failed: ' + err.message);
  } finally {
    if (btn) {
      btn.innerHTML = originalBtn;
      btn.disabled = false;
    }
  }
}

function displayVerificationResult(data, durationMs = 24, inputQuery = '') {
  latestVerificationJson = data;
  const container = document.getElementById('resultContainer');
  if (!container) return;

  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const isSuccess = Boolean(data.success && (data.data || data.amount || data.settledAmount));
  const d = data.data || data || {};
  const provider = (data.provider || d.provider || 'TELEBIRR').toUpperCase();

  // Status & Provider Elements
  const dot = document.getElementById('resProviderDot');
  const title = document.getElementById('resProviderName');
  const statusBadge = document.getElementById('resStatusBadge');
  const durationBadge = document.getElementById('resDurationBadge');

  if (provider.includes('CBE')) {
    if (title) title.innerText = 'Commercial Bank of Ethiopia (CBE)';
    if (dot) dot.className = 'w-3 h-3 rounded-full bg-purple-600';
  } else {
    if (title) title.innerText = 'Ethio Telecom Telebirr';
    if (dot) dot.className = 'w-3 h-3 rounded-full bg-emerald-600';
  }

  if (durationBadge) durationBadge.innerText = `${durationMs}ms`;

  if (isSuccess) {
    if (statusBadge) {
      statusBadge.className = 'px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold font-mono';
      statusBadge.innerText = '200 OK · VERIFIED';
    }
  } else {
    if (statusBadge) {
      statusBadge.className = 'px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-bold font-mono';
      statusBadge.innerText = data.error ? 'VERIFICATION FAILED' : 'NOT FOUND';
    }
  }

  // Value Mapping
  let rawAmt = d.amount || d.settledAmount || d.totalPaidAmount || (isSuccess ? '--' : '0.00');
  let amountVal = String(rawAmt);
  if (!amountVal.includes('ETB') && !amountVal.includes('Birr') && amountVal !== '--') {
    amountVal = `${amountVal} ETB`;
  }

  const refVal = d.reference || d.receiptNo || d.token || d.id || inputQuery || '--';
  const timeVal = d.timestamp || d.paymentDate || d.date || new Date().toLocaleString();
  const payerVal = d.payer || d.payerName || d.sourceAccount || (isSuccess ? 'Customer' : 'N/A');
  const receiverVal = d.receiver || d.creditedPartyName || (isSuccess ? 'Merchant' : 'N/A');

  const elAmt = document.getElementById('resAmount');
  const elRef = document.getElementById('resReference');
  const elTime = document.getElementById('resTimestamp');
  const elPayer = document.getElementById('resPayer');
  const elRecv = document.getElementById('resReceiver');

  if (elAmt) elAmt.innerText = amountVal;
  if (elRef) elRef.innerText = refVal;
  if (elTime) elTime.innerText = timeVal;
  if (elPayer) elPayer.innerText = payerVal;
  if (elRecv) elRecv.innerText = receiverVal;

  // JSON viewer
  const viewer = document.getElementById('jsonViewer');
  if (viewer) {
    viewer.innerText = JSON.stringify(data, null, 2);
  }
}

function toggleJsonView() {
  const viewer = document.getElementById('jsonViewer');
  const icon = document.getElementById('jsonToggleIcon');
  if (!viewer) return;

  const isHidden = viewer.classList.contains('hidden');
  viewer.classList.toggle('hidden');
  if (icon) {
    icon.className = isHidden ? 'ph-bold ph-caret-down text-xs text-slate-700' : 'ph-bold ph-caret-right text-xs text-slate-500';
  }
}

function switchCodeTab(lang) {
  const tabs = ['curl', 'node', 'python'];
  tabs.forEach(t => {
    const btn = document.getElementById('btnCode' + t.charAt(0).toUpperCase() + t.slice(1));
    const snippet = document.getElementById('codeSnippet' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) {
      btn.className = t === lang
        ? 'px-2.5 py-1 rounded-md text-[11px] font-mono bg-white text-slate-900 font-bold border border-slate-300 shadow-2xs'
        : 'px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-600 hover:text-slate-900';
    }
    if (snippet) {
      snippet.classList.toggle('hidden', t !== lang);
    }
  });
}

function copyResultJson() {
  if (!latestVerificationJson) return;
  navigator.clipboard.writeText(JSON.stringify(latestVerificationJson, null, 2));
}

// ── Auth Modals (Sign In & Instant Account Creation) ─────────────────────────
function openAuthModal(mode) {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('hidden');
    setAuthModalTab(mode === 'signup' ? 'signup' : 'login');
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.add('hidden');
}

function setAuthModalTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('formAuthLogin')?.classList.toggle('hidden', !isLogin);
  document.getElementById('formAuthSignup')?.classList.toggle('hidden', isLogin);

  const tabLogin = document.getElementById('modalTabLogin');
  const tabSignup = document.getElementById('modalTabSignup');
  if (tabLogin) tabLogin.className = isLogin ? 'flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs transition font-bold' : 'flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 transition font-medium';
  if (tabSignup) tabSignup.className = !isLogin ? 'flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs transition font-bold' : 'flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 transition font-medium';

  if (isLogin) {
    setTimeout(() => document.getElementById('modalLoginEmail')?.focus(), 50);
  } else {
    setTimeout(() => document.getElementById('modalSignupEmail')?.focus(), 50);
  }
}

async function handleModalLogin(e) {
  e.preventDefault();
  const email = document.getElementById('modalLoginEmail').value.trim();
  const password = document.getElementById('modalLoginPassword').value;
  const errEl = document.getElementById('modalLoginError');
  if (errEl) errEl.classList.add('hidden');

  const btn = document.getElementById('btnModalLoginSubmit');
  const originalBtn = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="ph ph-spinner animate-spin text-sm"></i><span>Signing in...</span>';
    btn.disabled = true;
  }

  try {
    const res = await fetch('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (data.success) {
      if (data.token) {
        localStorage.setItem('chek_token', data.token);
        localStorage.setItem('chek_session_token', data.token);
      }
      closeAuthModal();
      window.location.href = (email.toLowerCase() === 'abitieyuel@gmail.com') ? '/super-admin' : '/admin';
    } else {
      if (errEl) {
        errEl.innerText = data.error || 'Invalid credentials.';
        errEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.innerText = err.message;
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.innerHTML = originalBtn;
      btn.disabled = false;
    }
  }
}

async function handleModalSignup(e) {
  e.preventDefault();
  const businessName = document.getElementById('modalSignupBizName')?.value?.trim();
  const email = document.getElementById('modalSignupEmail')?.value?.trim();
  const password = document.getElementById('modalSignupPassword')?.value;
  const errEl = document.getElementById('modalSignupError');
  if (errEl) errEl.classList.add('hidden');

  const btn = document.getElementById('btnModalSignupSubmit');
  const originalBtn = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="ph ph-spinner animate-spin text-sm"></i><span>Creating account...</span>';
    btn.disabled = true;
  }

  try {
    const res = await fetch('/admin/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, businessName })
    });

    const data = await res.json();
    if (data.success) {
      if (data.token) {
        localStorage.setItem('chek_token', data.token);
        localStorage.setItem('chek_session_token', data.token);
      }
      if (data.rawApiKey) {
        sessionStorage.setItem('new_api_key', data.rawApiKey);
      }
      closeAuthModal();
      window.location.href = '/admin';
    } else {
      if (errEl) {
        errEl.innerText = data.error || 'Registration failed.';
        errEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.innerText = err.message;
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.innerHTML = originalBtn;
      btn.disabled = false;
    }
  }
}

// ── 4,000 ETB Unlimited Plan Upgrade Funnel ────────────────────────────────
function handlePricingUnlimitedClick() {
  const token = localStorage.getItem('chek_token') || localStorage.getItem('chek_session_token');
  sessionStorage.setItem('open_tab', 'billing');
  if (token) {
    window.location.href = '/admin';
  } else {
    openAuthModal('signup');
    const subTitle = document.getElementById('modalAuthSubtitle');
    if (subTitle) subTitle.innerText = 'Create an account to activate your 4,000 ETB Unlimited Plan';
  }
}
