let chartVolumeInstance = null;
let chartPieInstance = null;
let currentUser = null;
let searchDebounceTimer = null;
let currentInspectedTxJson = null;

// Global Escape shortcut to close modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTxDetailModal();
    closeApiKeyRevealModal();
  }
});

// ─── LIGHT FINTECH TOAST NOTIFICATION ENGINE ────────────────────────────────

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const isSuccess = type === 'success';
  const isError = type === 'error';

  toast.className = `p-3.5 rounded-xl border shadow-xl flex items-center justify-between gap-3 text-xs pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0 bg-white ${
    isSuccess ? 'border-emerald-300 text-emerald-900' : isError ? 'border-rose-300 text-rose-900' : 'border-amber-300 text-amber-900'
  }`;

  const icon = isSuccess ? 'ph-bold ph-check-circle text-emerald-600' : isError ? 'ph-bold ph-warning-circle text-rose-600' : 'ph-bold ph-info text-amber-600';

  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <i class="${icon} text-base shrink-0"></i>
      <span class="font-semibold">${message}</span>
    </div>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-700"><i class="ph-bold ph-x"></i></button>
  `;

  container.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── AUTHENTICATION HELPER WITH TOKEN & CREDENTIALS ─────────────────────────

function authFetch(url, options = {}) {
  const token = localStorage.getItem('chek_token') || localStorage.getItem('chek_session_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    ...(options.headers || {}),
  };
  return fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
}

function setAuthTab(tab) {
  const btnLogin = document.getElementById('btnTabLogin');
  const btnSignup = document.getElementById('btnTabSignup');
  const btnForgot = document.getElementById('btnTabForgot');
  const formLogin = document.getElementById('loginForm');
  const formSignup = document.getElementById('signupForm');
  const formForgot = document.getElementById('forgotForm');

  btnLogin.className = 'flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900';
  btnSignup.className = 'flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900';
  btnForgot.className = 'flex-1 py-1.5 rounded-lg text-slate-500 hover:text-slate-900';

  formLogin.classList.add('hidden');
  formSignup.classList.add('hidden');
  formForgot.classList.add('hidden');

  if (tab === 'login') {
    btnLogin.className = 'flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs font-semibold';
    formLogin.classList.remove('hidden');
  } else if (tab === 'signup') {
    btnSignup.className = 'flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs font-semibold';
    formSignup.classList.remove('hidden');
  } else if (tab === 'forgot') {
    btnForgot.className = 'flex-1 py-1.5 rounded-lg bg-white text-slate-900 shadow-xs font-semibold';
    formForgot.classList.remove('hidden');
  }
}

async function checkCurrentSession() {
  try {
    const res = await authFetch('/admin/api/me');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.merchant) {
        currentUser = data.merchant;
        renderAuthenticatedUser(currentUser);
        checkNewSignupApiKey();
        return true;
      }
    }
  } catch {}
  return false;
}

function renderAuthenticatedUser(user) {
  document.getElementById('authLockOverlay').classList.add('hidden');
  const mainApp = document.getElementById('mainApp');
  mainApp.classList.remove('opacity-0');

  document.getElementById('headerBizName').textContent = user.businessName || user.name || 'Merchant Console';
  document.getElementById('headerUserEmail').textContent = user.email;

  const roleBadge = document.getElementById('headerRoleBadge');
  const quotaBadge = document.getElementById('headerQuotaBadge');
  const plan = user.plan ? user.plan.toUpperCase() : 'FREE';
  roleBadge.textContent = plan;

  if (plan === 'UNLIMITED') {
    roleBadge.className = 'px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold uppercase';
    if (quotaBadge) quotaBadge.textContent = 'Quota: Unmetered (Unlimited Plan)';
  } else {
    if (quotaBadge) quotaBadge.textContent = 'Free Tier · 250 checks / month';
  }

  if (user.role === 'super_admin' || user.email === 'abitieyuel@gmail.com') {
    const superNav = document.getElementById('btnSuperAdminNav');
    if (superNav) superNav.classList.remove('hidden');
  }

  const targetTab = sessionStorage.getItem('open_tab') || (window.location.hash ? window.location.hash.replace('#', '') : null);
  if (targetTab) {
    sessionStorage.removeItem('open_tab');
    switchTab(targetTab);
  } else {
    loadInsights();
  }
}

function checkNewSignupApiKey() {
  const newKey = sessionStorage.getItem('new_api_key');
  if (newKey) {
    sessionStorage.removeItem('new_api_key');
    revealApiKeyModal(newKey);
    showToast('🎉 Account created! Production API Key generated.', 'success');
  }
}

function revealApiKeyModal(apiKey) {
  const modal = document.getElementById('apiKeyRevealModal');
  const input = document.getElementById('revealKeyVal');
  if (modal && input) {
    input.value = apiKey;
    modal.classList.remove('hidden');
  }
}

function closeApiKeyRevealModal() {
  const modal = document.getElementById('apiKeyRevealModal');
  if (modal) modal.classList.add('hidden');
}

function copyRevealKey() {
  const input = document.getElementById('revealKeyVal');
  const btn = document.getElementById('btnCopyRevealKey');
  if (!input) return;

  navigator.clipboard.writeText(input.value);
  if (btn) {
    btn.innerHTML = '<i class="ph-bold ph-check text-emerald-400"></i> <span class="text-emerald-400">Copied!</span>';
    setTimeout(() => {
      btn.innerHTML = '<i class="ph-bold ph-copy"></i> <span>Copy Key</span>';
    }, 2000);
  }
  showToast('API Key copied to clipboard!', 'success');
}

async function handleConsoleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('btnLoginSubmit');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Authenticating...';

  try {
    const res = await fetch('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Authentication failed.');
    }

    if (data.token) {
      localStorage.setItem('chek_token', data.token);
      localStorage.setItem('chek_session_token', data.token);
    }

    currentUser = data.merchant;
    renderAuthenticatedUser(currentUser);
    showToast(`Welcome back, ${currentUser.name || currentUser.email}!`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph-bold ph-sign-in"></i> <span>Sign In to Console</span>';
  }
}

async function handleConsoleSignup(e) {
  e.preventDefault();
  const businessName = document.getElementById('signupBusinessName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errEl = document.getElementById('signupErrorMsg');
  const btn = document.getElementById('btnSignupSubmit');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Creating Account...';

  try {
    const res = await fetch('/admin/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password, businessName }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed.');
    }

    if (data.token) {
      localStorage.setItem('chek_token', data.token);
      localStorage.setItem('chek_session_token', data.token);
    }

    currentUser = data.merchant;
    renderAuthenticatedUser(currentUser);

    if (data.rawApiKey) {
      revealApiKeyModal(data.rawApiKey);
      showToast('🎉 Free Account Active (250 checks/month)', 'success');
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph-bold ph-user-plus"></i> <span>Create Account (250 checks/mo free)</span>';
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const errEl = document.getElementById('forgotErrorMsg');
  const succEl = document.getElementById('forgotSuccessMsg');
  const btn = document.getElementById('btnForgotSubmit');

  errEl.classList.add('hidden');
  succEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Sending...';

  try {
    const res = await fetch('/admin/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Could not process password reset request.');
    }

    succEl.textContent = `Reset token generated: ${data.resetToken}`;
    succEl.classList.remove('hidden');
    showToast('Reset token generated', 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> <span>Send Password Reset</span>';
  }
}

async function handleConsoleLogout() {
  localStorage.removeItem('chek_token');
  localStorage.removeItem('chek_session_token');
  await fetch('/admin/api/auth/logout', { method: 'POST' });
  window.location.reload();
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────

function switchTab(tabId) {
  const tabs = ['insights', 'studio', 'ledger', 'keys', 'webhooks', 'billing'];
  tabs.forEach(t => {
    const btn = document.getElementById('tab-' + t);
    const panel = document.getElementById('panel-' + t);
    if (btn) {
      btn.className = t === tabId
        ? 'px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-semibold flex items-center gap-1.5 shadow-2xs'
        : 'px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center gap-1.5';
    }
    if (panel) {
      panel.classList.toggle('hidden', t !== tabId);
    }
  });

  if (tabId === 'insights') loadInsights();
  if (tabId === 'ledger') loadLedger();
  if (tabId === 'keys') loadApiKeys();
  if (tabId === 'webhooks') {
    loadWebhooks();
    loadWebhookDeliveries();
  }
}

// ─── REAL DATABASE-POWERED INSIGHTS & ANALYTICS ──────────────────────────────

async function loadInsights() {
  try {
    const res = await authFetch('/admin/api/analytics');
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('insightTotalVolume').textContent = `${Number(data.totalVolume).toLocaleString()} ETB`;
    document.getElementById('insightTelebirrVolume').textContent = `${Number(data.telebirrVolume).toLocaleString()} ETB`;
    document.getElementById('insightCbeVolume').textContent = `${Number(data.cbeVolume).toLocaleString()} ETB`;
    document.getElementById('insightTelebirrCount').textContent = data.telebirrCount;
    document.getElementById('insightCbeCount').textContent = data.cbeCount;
    document.getElementById('insightTotalCount').textContent = data.totalCount;

    const totalCount = (data.telebirrCount + data.cbeCount) || 0;
    const telebirrPct = totalCount > 0 ? Math.round((data.telebirrCount / totalCount) * 100) : 0;
    const cbePct = totalCount > 0 ? 100 - telebirrPct : 0;

    document.getElementById('statPieTelebirr').textContent = `${telebirrPct}%`;
    document.getElementById('statPieCbe').textContent = `${cbePct}%`;

    // Render Area Volume Chart
    const ctxTrend = document.getElementById('chartVolumeTrend')?.getContext('2d');
    if (ctxTrend) {
      if (chartVolumeInstance) chartVolumeInstance.destroy();
      chartVolumeInstance = new Chart(ctxTrend, {
        type: 'line',
        data: {
          labels: data.trend.labels,
          datasets: [
            {
              label: 'Telebirr (ETB)',
              data: data.trend.telebirr,
              borderColor: '#059669',
              backgroundColor: 'rgba(5, 150, 105, 0.08)',
              fill: true,
              tension: 0.35,
            },
            {
              label: 'CBE (ETB)',
              data: data.trend.cbe,
              borderColor: '#7c3aed',
              backgroundColor: 'rgba(124, 58, 237, 0.08)',
              fill: true,
              tension: 0.35,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#475569', font: { family: 'Inter', weight: '600' } } } },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#64748b' } },
            y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#64748b' } },
          }
        }
      });
    }

    // Render Doughnut Breakdown Chart
    const ctxPie = document.getElementById('chartProviderPie')?.getContext('2d');
    if (ctxPie) {
      if (chartPieInstance) chartPieInstance.destroy();
      chartPieInstance = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
          labels: ['Telebirr', 'CBE'],
          datasets: [{
            data: totalCount > 0 ? [data.telebirrCount, data.cbeCount] : [1, 1],
            backgroundColor: totalCount > 0 ? ['#059669', '#7c3aed'] : ['#e2e8f0', '#e2e8f0'],
            borderWidth: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          cutout: '72%',
        }
      });
    }

  } catch (err) {
    console.error('Insights load error:', err);
  }
}

// ─── VERIFICATION STUDIO (SAVES INSTANTLY TO DB) ─────────────────────────────

async function handleConsoleVerify(e) {
  e.preventDefault();
  const input = document.getElementById('consoleInputRef').value.trim();
  const btn = document.getElementById('btnConsoleVerifySubmit');
  const resCard = document.getElementById('consoleVerifyResult');

  if (!input) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i>';

  try {
    const res = await authFetch('/verify', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    const data = await res.json();

    resCard.classList.remove('hidden');
    const d = data.data || data;

    document.getElementById('cvProvider').textContent = data.provider || 'Verified';
    document.getElementById('cvStatus').textContent = data.success ? 'VERIFIED AT SOURCE' : 'FAILED';
    document.getElementById('cvAmount').textContent = `${d.amount || d.settledAmount || '--'} ETB`;
    document.getElementById('cvRef').textContent = d.reference || d.receiptNo || input;
    document.getElementById('cvPayer').textContent = d.payer || d.payerName || '--';
    document.getElementById('cvReceiver').textContent = d.receiver || d.creditedPartyName || '--';
    document.getElementById('cvRawJson').textContent = JSON.stringify(data, null, 2);

    if (data.success) {
      showToast(`Verified ${d.amount || ''} ETB successfully!`, 'success');
    } else {
      showToast(data.error || 'Verification failed.', 'error');
    }

    loadInsights();
  } catch (err) {
    showToast('Verification error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph-bold ph-lightning text-amber-400"></i> <span>Verify</span>';
  }
}

// ─── PAYMENTS LEDGER & TRANSACTION AUDIT MODAL ───────────────────────────────

function debounceLedgerSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadLedger, 300);
}

let loadedTransactionsMap = new Map();

async function loadLedger() {
  const q = document.getElementById('ledgerSearch')?.value || '';
  const provider = document.getElementById('ledgerProviderFilter')?.value || '';
  const tbody = document.getElementById('ledgerTableBody');

  try {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (provider) params.set('provider', provider);

    const res = await authFetch(`/admin/api/transactions?${params.toString()}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    tbody.innerHTML = '';
    loadedTransactionsMap.clear();

    if (data.transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-400 font-sans">No transactions recorded in database yet.</td></tr>';
      return;
    }

    data.transactions.forEach(t => {
      loadedTransactionsMap.set(t.id, t);
      const isTelebirr = (t.provider || '').toUpperCase().includes('TELEBIRR');
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition cursor-pointer';
      tr.onclick = (e) => {
        if (!e.target.closest('button')) openTxDetailModal(t.id);
      };

      tr.innerHTML = `
        <td class="py-3 px-3.5">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isTelebirr ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-purple-50 text-purple-800 border border-purple-200'}">
            <span class="w-1.5 h-1.5 rounded-full ${isTelebirr ? 'bg-emerald-500' : 'bg-purple-500'}"></span>
            ${t.provider}
          </span>
        </td>
        <td class="py-3 px-3.5 font-bold text-slate-900 font-mono">${t.reference}</td>
        <td class="py-3 px-3.5 text-slate-900 font-extrabold font-display">${t.amount} ETB</td>
        <td class="py-3 px-3.5 text-slate-600 font-sans text-xs truncate max-w-xs">${t.payer || '--'} → ${t.receiver || '--'}</td>
        <td class="py-3 px-3.5 font-mono text-[10px] text-slate-500">${t.verificationMode}</td>
        <td class="py-3 px-3.5 text-slate-500">${new Date(t.verifiedAt).toLocaleString()}</td>
        <td class="py-3 px-3.5 text-right">
          <button onclick="openTxDetailModal('${t.id}')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-sans font-semibold flex items-center gap-1 ml-auto border border-slate-200 shadow-2xs">
            <i class="ph ph-magnifying-glass"></i>
            <span>Audit</span>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-600 font-sans">${err.message}</td></tr>`;
  }
}

function openTxDetailModal(txId) {
  const tx = loadedTransactionsMap.get(txId);
  if (!tx) return;

  currentInspectedTxJson = tx;
  document.getElementById('mdlTxRef').textContent = tx.reference;
  document.getElementById('mdlTxAmt').textContent = `${tx.amount} ETB`;
  document.getElementById('mdlTxProvider').textContent = `${tx.provider} (${tx.verificationMode})`;
  document.getElementById('mdlTxTime').textContent = new Date(tx.verifiedAt).toLocaleString();
  document.getElementById('mdlTxPayer').textContent = tx.payer || 'Customer';
  document.getElementById('mdlTxReceiver').textContent = tx.receiver || 'Merchant';
  document.getElementById('mdlTxJson').textContent = JSON.stringify(tx.metadata || tx, null, 2);

  document.getElementById('txDetailModal').classList.remove('hidden');
}

function closeTxDetailModal() {
  document.getElementById('txDetailModal').classList.add('hidden');
}

function copyModalJson() {
  if (currentInspectedTxJson) {
    navigator.clipboard.writeText(JSON.stringify(currentInspectedTxJson, null, 2));
    showToast('Transaction JSON copied to clipboard!', 'success');
  }
}

// ─── API KEYS MANAGEMENT (PERSISTED IN DATABASE) ─────────────────────────────

async function loadApiKeys() {
  const container = document.getElementById('apiKeysList');
  try {
    const res = await authFetch('/admin/api/api-keys');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    container.innerHTML = '';
    if (data.keys.length === 0) {
      container.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No API keys created yet.</p>';
      return;
    }

    data.keys.forEach(k => {
      const card = document.createElement('div');
      card.className = 'p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between shadow-2xs';
      card.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-900">${k.name}</span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-800 border border-slate-300 font-bold">${k.prefix}</span>
            ${k.isActive ? '<span class="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">Active</span>' : '<span class="text-[10px] text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-bold">Revoked</span>'}
          </div>
          <span class="text-[11px] text-slate-500 font-mono mt-0.5 block">Created: ${new Date(k.createdAt).toLocaleDateString()}</span>
        </div>
        ${k.isActive ? `<button onclick="revokeKey('${k.id}')" class="text-xs text-rose-600 hover:text-rose-800 font-semibold">Revoke</button>` : ''}
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-rose-600 text-center">${err.message}</p>`;
  }
}

async function handleCreateApiKey() {
  const name = prompt('Enter a label for this API key:', 'Production Backend Server');
  if (!name) return;

  const res = await authFetch('/admin/api/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (data.success && (data.apiKey || data.rawKey)) {
    const key = data.apiKey || data.rawKey;
    revealApiKeyModal(key);
    showToast('New API Key generated successfully!', 'success');
    loadApiKeys();
  }
}

async function revokeKey(id) {
  if (!confirm('Are you sure you want to revoke this API key? Requests using it will be rejected.')) return;
  await authFetch(`/admin/api/api-keys/${id}`, { method: 'DELETE' });
  showToast('API key revoked', 'info');
  loadApiKeys();
}

// ─── WEBHOOKS & DELIVERIES (REAL-TIME ENGINE & TEST TRIGGER) ─────────────────

async function loadWebhooks() {
  const container = document.getElementById('webhooksList');
  try {
    const res = await authFetch('/admin/api/webhooks');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    container.innerHTML = '';
    if (data.webhooks.length === 0) {
      container.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No webhook endpoints configured yet.</p>';
      return;
    }

    data.webhooks.forEach(w => {
      const card = document.createElement('div');
      card.className = 'p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs';
      card.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono text-slate-900 font-bold">${w.url}</span>
            <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Active</span>
          </div>
          <div class="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-600">
            <span>Secret:</span>
            <code class="bg-white px-2 py-0.5 rounded border border-slate-300 text-slate-900 font-bold">${w.signingSecret}</code>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="testWebhookEndpoint('${w.id}')" id="btnTestHook_${w.id}" class="px-3 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center gap-1 shadow-2xs">
            <i class="ph-bold ph-paper-plane-tilt"></i>
            <span>Test Event</span>
          </button>
          <button onclick="deleteWebhook('${w.id}')" class="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1">Delete</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-rose-600 text-center">${err.message}</p>`;
  }
}

async function testWebhookEndpoint(id) {
  const btn = document.getElementById('btnTestHook_' + id);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Sending...';
  }

  try {
    const res = await authFetch(`/admin/api/webhooks/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.test) {
      const t = data.test;
      if (t.success) {
        showToast(`Webhook Delivered (HTTP ${t.statusCode}, ${t.latencyMs}ms)`, 'success');
      } else {
        showToast(`Webhook Failed: HTTP ${t.statusCode || 'Timeout'} - ${t.error}`, 'error');
      }
    } else {
      showToast(data.error || 'Webhook test failed.', 'error');
    }
    loadWebhookDeliveries();
  } catch (err) {
    showToast('Test Webhook Error: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> <span>Test Event</span>';
    }
  }
}

async function loadWebhookDeliveries() {
  const tbody = document.getElementById('webhookDeliveriesBody');
  if (!tbody) return;

  try {
    const res = await authFetch('/admin/api/webhooks/deliveries');
    const data = await res.json();
    if (!data.success) return;

    tbody.innerHTML = '';
    if (data.deliveries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-400 font-sans">No recent deliveries recorded.</td></tr>';
      return;
    }

    data.deliveries.forEach(d => {
      const isSuccess = d.status === 'SUCCEEDED';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-2.5 px-3 text-slate-900 font-bold">${d.event}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isSuccess ? 'text-emerald-800 bg-emerald-50 border border-emerald-200' : 'text-rose-800 bg-rose-50 border border-rose-200'}">
            ${d.status}
          </span>
        </td>
        <td class="py-2.5 px-3 font-bold ${isSuccess ? 'text-emerald-700' : 'text-rose-700'}">${d.statusCode || '--'}</td>
        <td class="py-2.5 px-3 text-slate-600">${d.attempts || 1}</td>
        <td class="py-2.5 px-3 text-slate-500">${new Date(d.createdAt).toLocaleTimeString()}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch {}
}

async function handleCreateWebhook() {
  const url = prompt('Enter your webhook destination URL (e.g. https://store.et/api/webhook):');
  if (!url) return;

  const res = await authFetch('/admin/api/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, events: ['payment.verified'] }),
  });
  const data = await res.json();
  if (data.success) {
    showToast('Webhook registered successfully!', 'success');
    loadWebhooks();
  }
}

async function deleteWebhook(id) {
  if (!confirm('Are you sure you want to remove this webhook endpoint?')) return;
  await authFetch(`/admin/api/webhooks/${id}`, { method: 'DELETE' });
  showToast('Webhook deleted', 'info');
  loadWebhooks();
}

// ─── 4,000 ETB UNLIMITED PLAN UPGRADE ────────────────────────────────────────

async function handleConsoleUpgrade(e) {
  e.preventDefault();
  const reference = document.getElementById('upgradeRefInput').value.trim();
  const btn = document.getElementById('btnUpgradeSubmit');

  if (!reference) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Verifying Payment...';

  try {
    const res = await authFetch('/admin/api/subscriptions/pay', {
      method: 'POST',
      body: JSON.stringify({
        plan: 'unlimited',
        amount: 4000,
        reference,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Payment verification failed.');
    }

    showToast('🎉 Successfully upgraded to UNLIMITED Plan!', 'success');
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    showToast('Upgrade Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ph-bold ph-check-circle text-amber-400"></i> <span>Verify Payment & Activate Unlimited Plan</span>';
  }
}

// Auto-run on page load
checkCurrentSession();
