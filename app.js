// ── STORAGE HELPERS ────────────────────────────────────────────────────────
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k)
};

// ── AUTH ───────────────────────────────────────────────────────────────────
let currentUser = null;

function hashPin(pin) {
  // Simple deterministic hash for PIN (not crypto, but obfuscated in storage)
  if (pin == null) return '0';
  const s = String(pin);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

function switchAuthTab(tab) {
  document.getElementById('tab-signin').classList.toggle('active', tab === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('form-signin').style.display = tab === 'signin' ? '' : 'none';
  document.getElementById('form-signup').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('si-err').textContent = '';
  document.getElementById('su-err').textContent = '';
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

function doSignUp() {
  const name = document.getElementById('su-name').value.trim();
  const user = document.getElementById('su-user').value.trim().toLowerCase();
  const pass = document.getElementById('su-pass').value;
  const pin  = document.getElementById('su-pin').value;
  const err  = document.getElementById('su-err');
  if (!name || !user || !pass || !pin) return err.textContent = 'All fields are required.';
  if (pass.length < 6) return err.textContent = 'Password must be at least 6 characters.';
  if (!/^\d{4}$/.test(pin)) return err.textContent = 'PIN must be exactly 4 digits.';
  const users = LS.get('skt_users') || {};
  if (users[user]) return err.textContent = 'Username already taken.';
  users[user] = { name, pass: btoa(pass), pin: hashPin(pin) };
  LS.set('skt_users', users);
  // Init empty state for this user
  LS.set('skt_state_' + user, { projects: [], expenses: [], workers: [], attendance: {}, wageSettlements: [] });
  err.textContent = '';
  showToast('Account created! Please sign in.');
  switchAuthTab('signin');
  document.getElementById('si-user').value = user;
}

function doSignIn() {
  const user = document.getElementById('si-user').value.trim().toLowerCase();
  const pass = document.getElementById('si-pass').value;
  const err  = document.getElementById('si-err');
  if (!user || !pass) return err.textContent = 'Enter username and password.';
  const users = LS.get('skt_users') || {};
  if (!users[user] || users[user].pass !== btoa(pass)) return err.textContent = 'Invalid username or password.';
  currentUser = user;
  LS.set('skt_session', user);
  loadUserState();
  bootApp();
}

function doLogout() {
  saveUserState();
  LS.del('skt_session');
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('si-pass').value = '';
  document.getElementById('si-err').textContent = '';
}

function bootApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  const users = LS.get('skt_users') || {};
  document.getElementById('hdr-user').textContent = users[currentUser]?.name || currentUser;
  navigate('dashboard', document.querySelector('.nav-btn'));
}

// ── STATE ──────────────────────────────────────────────────────────────────
let state = { projects: [], expenses: [], workers: [], attendance: {}, wageSettlements: [] };

function loadUserState() {
  const saved = LS.get('skt_state_' + currentUser);
  if (saved) state = saved;
  else state = { projects: [], expenses: [], workers: [], attendance: {}, wageSettlements: [] };
  sanitizeState();
}
function saveUserState() {
  if (currentUser) LS.set('skt_state_' + currentUser, state);
}

// Deduplicate workers by id, clean orphan attendance keys, remove duplicate wage settlements
function sanitizeState() {
  // 1. Deduplicate workers — keep last occurrence of each id
  const workerMap = new Map();
  state.workers.forEach(w => workerMap.set(w.id, w));
  state.workers = Array.from(workerMap.values());

  // 2. Ensure attendance values are always objects, never plain strings
  const validProjIds = new Set(state.projects.map(p => p.id));
  Object.keys(state.attendance).forEach(key => {
    // Remove attendance for deleted projects
    const projId = key.split('_')[0];
    if (!validProjIds.has(projId)) { delete state.attendance[key]; return; }
    // Normalize any plain-string records to object form
    const dayAtt = state.attendance[key];
    Object.keys(dayAtt).forEach(wid => {
      const r = dayAtt[wid];
      if (typeof r !== 'object' || r === null) {
        dayAtt[wid] = { status: r || 'A', otHours: 0, otRate: 0 };
      }
    });
  });

  // 3. Deduplicate wage settlements — keep last per (workerId, projId, weekStart, weekEnd)
  const settlMap = new Map();
  state.wageSettlements.forEach(s => {
    settlMap.set(`${s.workerId}_${s.projId}_${s.weekStart}_${s.weekEnd}`, s);
  });
  state.wageSettlements = Array.from(settlMap.values());
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  // Use local year/month/day to avoid UTC-offset shifting the date (e.g. IST +5:30)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return fmtDate(new Date()); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}
function fmtFull(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }

function projectExpenses(pid) {
  return state.expenses.filter(e => e.projId === pid).reduce((s, e) => s + Number(e.amount), 0);
}
function projectLabourWages(pid) {
  return state.wageSettlements.filter(s => s.projId === pid && s.paid).reduce((s, x) => s + Number(x.amount), 0);
}

// ── ATTENDANCE COMPUTATION HELPERS ────────────────────────────────────────
// Returns projects where a worker is already marked Full-day on a given date (excluding current project)
function getFullDayProjectsForWorker(wid, date, excludeProjId) {
  return state.projects.filter(p => p.id !== excludeProjId && (() => {
    const r = (state.attendance[p.id + '_' + date] || {})[wid];
    return ((typeof r === 'object' && r !== null) ? r.status : r) === 'F';
  })());
}

// Single source of truth for per-day earned amount for one worker.
// att record shape: { status:'F'|'H'|'A', otHours:0, otRate:0 }
// Backward-compatible: old records stored status as a plain string.
function dayEarned(w, dayAttRecord) {
  const rec    = (typeof dayAttRecord === 'object' && dayAttRecord !== null) ? dayAttRecord : { status: dayAttRecord || 'A' };
  const status = rec.status || 'A';
  // Absent = no work = no pay (base AND OT both zero)
  if (status === 'A') return 0;
  const base = status === 'F' ? Number(w.wage) : Number(w.wage) * 0.5;
  const ot   = (Number(rec.otHours) || 0) * (Number(rec.otRate) || 0);
  return base + ot;
}

// Total wages EARNED by a worker across ALL recorded attendance (derived, never stored)
// Math.round applied to match calcWeeklyWages rounding — prevents .5 float desync
function workerTotalDue(wid, pid) {
  const w = state.workers.find(x => x.id === wid);
  if (!w) return 0;
  const prefix = pid + '_';
  return Math.round(
    Object.entries(state.attendance)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((sum, [, dayAtt]) => sum + dayEarned(w, dayAtt[wid]), 0)
  );
}

// Total wages SETTLED (paid=true) for a worker — derived from wageSettlements
function workerTotalPaid(wid, pid) {
  return state.wageSettlements
    .filter(s => s.workerId === wid && s.projId === pid && s.paid)
    .reduce((s, x) => s + Number(x.amount), 0);
}
function projectSpent(pid) { return projectExpenses(pid) + projectLabourWages(pid); }

function showToast(msg, dur = 2500) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

// ── NAVIGATION ─────────────────────────────────────────────────────────────
let currentPage = 'dashboard';
function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');
  currentPage = page;
  saveUserState();
  renderPage(page);
}
function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'expenses') renderExpenses();
  else if (page === 'labour') renderLabour();
  else if (page === 'payroll') renderPayroll();
  else if (page === 'reports') renderReports();
}

// ── MODAL ──────────────────────────────────────────────────────────────────
function openModal(id) {
  if (id === 'modal-expense') populateExpenseProjectSelect();
  if (id === 'modal-worker') populateWorkerProjectSelect();
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ── PIN SYSTEM ─────────────────────────────────────────────────────────────
let pinBuffer = '';
let pinCallback = null;

function requirePin(title, cb) {
  pinBuffer = '';
  pinCallback = cb;
  document.getElementById('pin-title').textContent = title + ' – Enter PIN';
  document.getElementById('pin-err').textContent = '';
  updatePinDots();
  openModal('modal-pin');
}

function pinKey(k) {
  if (k === 'C') { pinBuffer = ''; }
  else if (k === 'X') { pinBuffer = pinBuffer.slice(0, -1); }
  else if (pinBuffer.length < 4) { pinBuffer += k; }
  updatePinDots();
  if (pinBuffer.length === 4) setTimeout(checkPin, 120);
}

function updatePinDots() {
  document.querySelectorAll('#pin-dots span').forEach((s, i) => {
    s.classList.toggle('filled', i < pinBuffer.length);
  });
}

function checkPin() {
  const users = LS.get('skt_users') || {};
  const stored = users[currentUser]?.pin;
  if (hashPin(pinBuffer) === stored) {
    closeModal('modal-pin');
    pinBuffer = '';
    updatePinDots();
    if (pinCallback) { const cb = pinCallback; pinCallback = null; cb(); }
  } else {
    document.getElementById('pin-err').textContent = 'Incorrect PIN. Try again.';
    pinBuffer = '';
    updatePinDots();
  }
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  const totalValue = state.projects.filter(p => p.type !== 'daily').reduce((s, p) => s + Number(p.value), 0);
  const totalSpent = state.projects.reduce((s, p) => s + projectSpent(p.id), 0);

  const cards = state.projects.map(p => {
    const isDaily = p.type === 'daily';
    const spent = projectSpent(p.id);
    const wageTotal = projectLabourWages(p.id);
    const badgeClass = p.status === 'Active' ? 'badge-active' : p.status === 'Completed' ? 'badge-completed' : 'badge-hold';
    const typeBadge = isDaily ? '<span class="badge badge-daily" style="margin-left:6px">Daily Wages</span>' : '';

    let statsHtml;
    if (isDaily) {
      // Current week pending
      const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const wkStart = fmtDate(d); const e2 = new Date(d); e2.setDate(e2.getDate() + 6); const wkEnd = fmtDate(e2);
      const weekSummary = calcWeeklyWages(p.id, wkStart, wkEnd);
      const weekPending = weekSummary.filter(r => !r.paid).reduce((s, r) => s + r.total, 0);
      statsHtml = `<div class="stat-row">
        <div class="stat"><div class="stat-val text-gold">${fmt(wageTotal)}</div><div class="stat-lbl">Total Wages Paid</div></div>
        <div class="stat"><div class="stat-val text-red">${fmt(weekPending)}</div><div class="stat-lbl">This Week Pending</div></div>
        <div class="stat"><div class="stat-val">${state.workers.length}</div><div class="stat-lbl">Workers</div></div>
      </div>`;
    } else {
      const rem = p.value - spent;
      const pct = p.value > 0 ? Math.min(100, Math.round((spent / p.value) * 100)) : 0;
      statsHtml = `
        <div class="progress-wrap">
          <div class="progress-label"><span>Budget Used</span><span>${pct}%</span></div>
          <div class="progress-bar"><div class="progress-fill ${pct > 85 ? 'danger' : ''}" style="width:${pct}%"></div></div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-val">${fmt(p.value)}</div><div class="stat-lbl">Contract</div></div>
          <div class="stat"><div class="stat-val text-gold">${fmt(spent)}</div><div class="stat-lbl">Spent</div></div>
          <div class="stat"><div class="stat-val ${rem < 0 ? 'text-red' : 'text-green'}">${fmt(Math.abs(rem))}</div><div class="stat-lbl">${rem < 0 ? 'Overrun' : 'Balance'}</div></div>
        </div>`;
    }
    return `
    <div class="card">
      <div class="card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
            ${typeBadge}
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${p.client || ''} ${p.location ? '· ' + p.location : ''}</div>
        </div>
        <span class="badge ${badgeClass}" style="margin-left:8px;flex-shrink:0">${p.status}</span>
      </div>
      ${statsHtml}
      <div class="action-row">
        <button class="btn btn-outline btn-sm" onclick="openProjectDetail('${p.id}')">View</button>
        ${isDaily ? `<button class="btn btn-primary btn-sm" onclick="openBillingModal('${p.id}')">📋 Bill</button>` : ''}
        <button class="btn btn-navy btn-sm" onclick="openEditProject('${p.id}')">✏ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="section-title" style="margin-top:4px">Portfolio Overview</div>
    <div class="stat-row" style="margin-bottom:14px">
      <div class="stat"><div class="stat-val">${state.projects.length}</div><div class="stat-lbl">Projects</div></div>
      <div class="stat"><div class="stat-val">${fmt(totalValue)}</div><div class="stat-lbl">Contract Value</div></div>
      <div class="stat"><div class="stat-val text-gold">${fmt(totalSpent)}</div><div class="stat-lbl">Total Spent</div></div>
    </div>
    <div class="section-title">Projects</div>
    ${cards || '<div class="card" style="text-align:center;color:var(--text2);padding:30px">No projects yet. Add your first project!</div>'}
    <button class="btn btn-navy btn-block" onclick="openAddProject()">+ Add New Project</button>`;
}

function setProjType(type) {
  document.getElementById('inp-ptype').value = type;
  document.getElementById('ptype-fixed').classList.toggle('active', type === 'fixed');
  document.getElementById('ptype-daily').classList.toggle('active', type === 'daily');
  document.getElementById('contract-value-row').style.display = type === 'fixed' ? '' : 'none';
}

function openAddProject() {
  document.getElementById('proj-modal-title').textContent = 'Add Project';
  document.getElementById('proj-save-btn').textContent = 'Add Project';
  document.getElementById('inp-pedit-id').value = '';
  ['inp-pname','inp-pclient','inp-ploc','inp-pvalue','inp-pdate'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inp-pdate').max = todayStr();
  document.getElementById('inp-pstatus').value = 'Active';
  setProjType('fixed');
  openModal('modal-project');
}

function openEditProject(pid) {
  requirePin('Edit Project', () => {
    const p = state.projects.find(x => x.id === pid);
    if (!p) return;
    document.getElementById('proj-modal-title').textContent = 'Edit Project';
    document.getElementById('proj-save-btn').textContent = 'Save Changes';
    document.getElementById('inp-pedit-id').value = pid;
    document.getElementById('inp-pname').value = p.name;
    document.getElementById('inp-pclient').value = p.client || '';
    document.getElementById('inp-ploc').value = p.location || '';
    document.getElementById('inp-pvalue').value = p.value;
    document.getElementById('inp-pdate').value = p.startDate || '';
    document.getElementById('inp-pdate').max = todayStr();
    document.getElementById('inp-pstatus').value = p.status || 'Active';
    setProjType(p.type || 'fixed');
    openModal('modal-project');
  });
}

function saveProject() {
  const name  = document.getElementById('inp-pname').value.trim();
  const type  = document.getElementById('inp-ptype').value;
  const value = type === 'fixed' ? parseFloat(document.getElementById('inp-pvalue').value) : 0;
  if (!name) return showToast('Project name is required');
  if (type === 'fixed' && !value) return showToast('Contract value is required for Fixed Contract');
  const editId = document.getElementById('inp-pedit-id').value;
  const data = {
    name, value, type,
    client: document.getElementById('inp-pclient').value.trim(),
    location: document.getElementById('inp-ploc').value.trim(),
    startDate: document.getElementById('inp-pdate').value || todayStr(),
    status: document.getElementById('inp-pstatus').value
  };
  if (editId) {
    const idx = state.projects.findIndex(p => p.id === editId);
    if (idx > -1) state.projects[idx] = { ...state.projects[idx], ...data };
    showToast('Project updated');
  } else {
    state.projects.push({ id: uid(), ...data });
    showToast('Project added');
  }
  closeModal('modal-project');
  saveUserState();
  renderDashboard();
}

function deleteProject(pid) {
  requirePin('Delete Project', () => {
    if (!confirm('Delete this project and all its data? This cannot be undone.')) return;
    state.projects = state.projects.filter(p => p.id !== pid);
    state.expenses = state.expenses.filter(e => e.projId !== pid);
    // Workers are global — only remove project-specific attendance and settlements
    Object.keys(state.attendance).filter(k => k.startsWith(pid + '_')).forEach(k => delete state.attendance[k]);
    state.wageSettlements = state.wageSettlements.filter(s => s.projId !== pid);
    saveUserState();
    showToast('Project deleted');
    renderDashboard();
  });
}

function openProjectDetail(pid) {
  const p = state.projects.find(x => x.id === pid);
  if (!p) return;
  const isDaily = p.type === 'daily';
  const spent = projectSpent(pid);
  const wageTotal = projectLabourWages(pid);
  const existing = document.getElementById('modal-detail');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'modal-detail';

  let bodyHtml;
  if (isDaily) {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const wkStart = fmtDate(d); const e2 = new Date(d); e2.setDate(e2.getDate() + 6); const wkEnd = fmtDate(e2);
    const weekSummary = calcWeeklyWages(pid, wkStart, wkEnd);
    const weekPending = weekSummary.filter(r => !r.paid).reduce((s, r) => s + r.total, 0);
    const weekPaid = weekSummary.filter(r => r.paid).reduce((s, r) => s + r.total, 0);
    bodyHtml = `
      <div class="stat-row">
        <div class="stat"><div class="stat-val text-gold">${fmt(wageTotal)}</div><div class="stat-lbl">Total Wages Paid</div></div>
        <div class="stat"><div class="stat-val text-red">${fmt(weekPending)}</div><div class="stat-lbl">This Week Pending</div></div>
        <div class="stat"><div class="stat-val text-green">${fmt(weekPaid)}</div><div class="stat-lbl">This Week Paid</div></div>
      </div>
      <div class="section-title">This Week's Pay Sheet (${wkStart} to ${wkEnd})</div>
      ${weekSummary.map(r => `<div class="pay-row"><div><div class="pay-name">${r.name}</div><div class="pay-detail">${r.trade} · ${r.days}F+${r.half}H = ${r.units} units</div></div><div style="text-align:right"><div class="pay-amount">${fmtFull(r.total)}</div><span class="pay-status ${r.paid?'pay-paid':'pay-pending'}">${r.paid?'Paid':'Pending'}</span></div></div>`).join('') || '<p style="color:var(--text2);font-size:13px">No workers.</p>'}
      <button class="btn btn-primary btn-block" style="margin-top:12px" onclick="document.getElementById('modal-detail').remove();openBillingModal('${pid}')">📋 Generate Weekly Bill</button>`;
  } else {
    const rem = p.value - spent;
    const pct = p.value > 0 ? Math.min(100, Math.round((spent / p.value) * 100)) : 0;
    const stageMap = {};
    state.expenses.filter(e => e.projId === pid).forEach(e => { stageMap[e.stage] = (stageMap[e.stage] || 0) + Number(e.amount); });
    const maxStage = Math.max(...Object.values(stageMap), 1);
    const stageBars = Object.entries(stageMap).map(([s, v]) => `
      <div class="stage-bar-row">
        <div class="stage-bar-label"><span>${s}</span><span>${fmt(v)}</span></div>
        <div class="stage-bar-track"><div class="stage-bar-fill" style="width:${Math.round((v/maxStage)*100)}%"></div></div>
      </div>`).join('');
    const recentExp = [...state.expenses.filter(e => e.projId === pid)].reverse().slice(0, 8).map(e =>
      `<tr><td>${e.date}</td><td>${e.stage}</td><td style="font-weight:700">${fmtFull(e.amount)}</td><td style="color:var(--text2);font-size:11px">${e.notes || ''}</td></tr>`
    ).join('');
    bodyHtml = `
      <div class="stat-row">
        <div class="stat"><div class="stat-val">${fmt(p.value)}</div><div class="stat-lbl">Contract</div></div>
        <div class="stat"><div class="stat-val text-gold">${fmt(spent)}</div><div class="stat-lbl">Spent</div></div>
        <div class="stat"><div class="stat-val ${rem<0?'text-red':'text-green'}">${fmt(Math.abs(rem))}</div><div class="stat-lbl">${rem<0?'Overrun':'Balance'}</div></div>
      </div>
      <div class="progress-wrap mt8">
        <div class="progress-label"><span>Budget Consumed</span><span>${pct}%</span></div>
        <div class="progress-bar"><div class="progress-fill ${pct>85?'danger':''}" style="width:${pct}%"></div></div>
      </div>
      <div class="section-title">Stage Breakdown</div>
      ${stageBars || '<p style="color:var(--text2);font-size:13px">No expenses yet.</p>'}
      <div class="section-title">Recent Expenses</div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Stage</th><th>Amount</th><th>Notes</th></tr></thead><tbody>${recentExp || '<tr><td colspan="4" style="text-align:center;color:var(--text2)">None</td></tr>'}</tbody></table></div>`;
  }

  modal.innerHTML = `<div class="modal">
    <div class="modal-title">${p.name} <button class="modal-close" onclick="document.getElementById('modal-detail').remove()">×</button></div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">${p.client || ''} ${p.location ? '· ' + p.location : ''} · ${isDaily ? '🔨 Daily Wages' : '📋 Fixed Contract'} · Started ${p.startDate || ''}</div>
    ${bodyHtml}
  </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ── EXPENSES ───────────────────────────────────────────────────────────────
let expFilter = 'All';
let expProjFilter = 'all';

function renderExpenses() {
  const el = document.getElementById('page-expenses');
  const stages = ['All','Centring','Slab Casting','Brickwork','Plastering','Electrical/Plumbing','Material/Purchase'];
  const chips = stages.map(s => `<div class="chip ${expFilter===s?'active':''}" onclick="setExpFilter('${s}')">${s}</div>`).join('');
  const projTabs = `<div class="proj-tabs">
    <div class="proj-tab ${expProjFilter==='all'?'active':''}" onclick="setExpProjFilter('all')">All Projects</div>
    ${state.projects.map(p => `<div class="proj-tab ${expProjFilter===p.id?'active':''}" onclick="setExpProjFilter('${p.id}')">${p.name.split(' ')[0]}</div>`).join('')}
  </div>`;
  let filtered = state.expenses;
  if (expProjFilter !== 'all') filtered = filtered.filter(e => e.projId === expProjFilter);
  if (expFilter !== 'All') filtered = filtered.filter(e => e.stage === expFilter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);
  const rows = sorted.map(e => {
    const p = state.projects.find(x => x.id === e.projId);
    return `<tr>
      <td>${e.date}</td>
      <td><span style="font-size:11px;background:var(--slate2);padding:2px 6px;border-radius:4px;white-space:nowrap">${e.stage}</span></td>
      <td style="font-weight:700;white-space:nowrap">${fmtFull(e.amount)}</td>
      <td style="font-size:11px;color:var(--text2)">${p ? p.name.split(' ')[0] : ''}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">🗑</button></td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <div class="section-title" style="margin-top:4px">Expense Tracker</div>
    ${projTabs}
    <div class="stage-chips">${chips}</div>
    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="flex-between">
        <span style="font-size:13px;color:var(--text2)">${expFilter === 'All' ? 'All Stages' : expFilter} Total</span>
        <span style="font-size:18px;font-weight:800;color:var(--navy)">${fmtFull(total)}</span>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table><thead><tr><th>Date</th><th>Stage</th><th>Amount</th><th>Project</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:20px">No expenses</td></tr>'}</tbody></table>
      </div>
    </div>
    <button class="fab" onclick="openModal('modal-expense')">+</button>`;
}

function setExpFilter(s) { expFilter = s; renderExpenses(); }
function setExpProjFilter(id) { expProjFilter = id; renderExpenses(); }

function populateExpenseProjectSelect() {
  document.getElementById('inp-eproj').innerHTML = state.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const dateEl = document.getElementById('inp-edate');
  dateEl.value = todayStr();
  dateEl.max = todayStr();
}

function addExpense() {
  const amt = parseFloat(document.getElementById('inp-eamt').value);
  if (!amt || amt <= 0) return showToast('Enter a valid amount');
  state.expenses.push({
    id: uid(),
    projId: document.getElementById('inp-eproj').value,
    date: document.getElementById('inp-edate').value,
    stage: document.getElementById('inp-estage').value,
    amount: amt,
    notes: document.getElementById('inp-enotes').value.trim()
  });
  closeModal('modal-expense');
  document.getElementById('inp-eamt').value = '';
  document.getElementById('inp-enotes').value = '';
  saveUserState();
  showToast('Expense saved');
  renderExpenses();
}

function deleteExpense(eid) {
  requirePin('Delete Expense', () => {
    state.expenses = state.expenses.filter(e => e.id !== eid);
    saveUserState();
    showToast('Expense deleted');
    renderExpenses();
  });
}

// ── LABOUR ─────────────────────────────────────────────────────────────────
let attDate = todayStr();
let attProjId = '';

function renderLabour() {
  const el = document.getElementById('page-labour');
  if (!attProjId && state.projects.length) attProjId = state.projects[0].id;

  const proj = state.projects.find(p => p.id === attProjId);
  // Deduplicate workers by id before rendering (guards against any stale duplicate state)
  const seen = new Set();
  const projWorkers = state.workers.filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
  const att = state.attendance[attProjId + '_' + attDate] || {};

  // Date nav helpers
  const isToday = attDate === todayStr();
  const displayDate = new Date(attDate + 'T00:00:00');
  // Use 'en-GB' for consistent English weekday names across all devices/locales
  const dayName  = displayDate.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateLabel = displayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Daily summary — ALL derived from live attendance state, zero hardcoded values
  // Normalize each record to object form for consistent access
  function getStatus(wid) {
    const r = att[wid];
    return (typeof r === 'object' && r !== null) ? (r.status || 'A') : (r || 'A');
  }
  const present     = projWorkers.filter(w => getStatus(w.id) === 'F').length;
  const half        = projWorkers.filter(w => getStatus(w.id) === 'H').length;
  const absent      = projWorkers.filter(w => getStatus(w.id) === 'A').length;
  const activeToday = present + half;  // workers who earned anything today
  // dailyWages uses dayEarned() — includes base wage + OT, absent = ₹0
  const dailyWages  = projWorkers.reduce((s, w) => s + dayEarned(w, att[w.id]), 0);

  // Project tabs
  const projTabs = state.projects.length ? `<div class="proj-tabs">
    ${state.projects.map(p => `<div class="proj-tab ${attProjId===p.id?'active':''}" onclick="setAttProj('${p.id}')">${p.name}</div>`).join('')}
  </div>` : '';

  // Worker attendance cards — each card reacts to current att state in real-time
  const workerRows = projWorkers.map(w => {
    // Support both old plain-string records and new object records
    const raw    = att[w.id];
    const rec    = (typeof raw === 'object' && raw !== null) ? raw : { status: raw || 'A', otHours: 0, otRate: 0 };
    const status = rec.status || 'A';
    const otH    = Number(rec.otHours) || 0;
    const otR    = Number(rec.otRate)  || 0;

    const statusLabel = status === 'F' ? 'Present' : status === 'H' ? 'Half Day' : 'Absent';
    // earnToday uses dayEarned() — single source of truth, includes OT
    const earnToday  = dayEarned(w, rec);
    const cardClass  = status === 'F' ? 'att-card-present' : status === 'H' ? 'att-card-half' : 'att-card-absent';
    const avClass    = status === 'F' ? 'av-present'       : status === 'H' ? 'av-half'       : 'av-absent';
    const slClass    = status === 'F' ? 'att-sl-f'         : status === 'H' ? 'att-sl-h'       : 'att-sl-a';

    // OT row only shown when worker is Present or Half-day
    const otRow = status !== 'A' ? `
      <div class="att-ot-row">
        <span class="att-ot-lbl">OT</span>
        <input class="att-ot-inp" type="number" min="0" max="12" placeholder="hrs"
          value="${otH || ''}" onchange="setOT('${w.id}','otHours',this.value)">
        <span class="att-ot-lbl">×</span>
        <input class="att-ot-inp" type="number" min="0" placeholder="₹/hr"
          value="${otR || ''}" onchange="setOT('${w.id}','otRate',this.value)">
        ${otH > 0 && otR > 0 ? `<span class="att-ot-amt">+${fmtFull(otH * otR)}</span>` : ''}
      </div>` : '';

    const dupProjects = status !== 'F' ? getFullDayProjectsForWorker(w.id, attDate, attProjId) : [];
    const dupWarning = dupProjects.length
      ? `<div style="font-size:11px;color:var(--orange);margin-top:2px">⚠ Full-day in: ${dupProjects.map(p=>p.name).join(', ')}</div>` : '';

    return `
    <div class="att-card ${cardClass}">
      <div class="att-card-left">
        <div class="att-avatar ${avClass}">${w.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div class="att-card-name">${w.name}</div>
          <div class="att-card-meta">${w.trade}&nbsp;·&nbsp;${fmtFull(w.wage)}/day</div>
          <div class="att-card-earn${status === 'A' ? ' att-earn-zero' : ''}">
            ${status === 'A' ? 'Absent &mdash; &#8377;0' : 'Earned: ' + fmtFull(earnToday)}
          </div>
          ${dupWarning}
          ${otRow}
        </div>
      </div>
      <div class="att-card-right">
        <div class="att-status-label ${slClass}">${statusLabel}</div>
        <div class="att-toggles">
          <button class="att-btn${status === 'F' ? ' sel-F' : ''}" onclick="markAtt('${w.id}','F')">F</button>
          <button class="att-btn${status === 'H' ? ' sel-H' : ''}" onclick="markAtt('${w.id}','H')">H</button>
          <button class="att-btn${status === 'A' ? ' sel-A' : ''}" onclick="markAtt('${w.id}','A')">A</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Worker directory (global pool)
  const workerDir = state.workers.map(w => `
    <div class="wdir-row">
      <div class="att-avatar av-dir">${w.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="att-card-name">${w.name}</div>
        <div class="att-card-meta">${w.trade}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:700;font-size:14px;color:var(--navy)">${fmtFull(w.wage)}<span style="font-size:11px;font-weight:400;color:var(--text2)">/day</span></div>
        <button class="btn btn-danger btn-sm" style="margin-top:4px" onclick="deleteWorker('${w.id}')">Remove</button>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="section-title" style="margin-top:4px">Attendance Register</div>

    ${projTabs || '<div class="att-empty-state">No projects yet. Add a project first.</div>'}

    <!-- DATE NAVIGATOR -->
    <div class="date-nav-bar">
      <button class="date-nav-btn" onclick="shiftAttDate(-1)">&#8592;</button>
      <div class="date-nav-center" onclick="document.getElementById('att-date-hidden').showPicker?.() || document.getElementById('att-date-hidden').click()">
        <div class="date-nav-day">${dayName}</div>
        <div class="date-nav-date">${dateLabel}</div>
        ${isToday ? '<div class="date-nav-today-badge">Today</div>' : ''}
      </div>
      <button class="date-nav-btn" onclick="shiftAttDate(1)" ${isToday ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''}>&#8594;</button>
      <input type="date" id="att-date-hidden" value="${attDate}" max="${todayStr()}" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0" onchange="changeAttDate(this.value)">
    </div>

    <!-- DAILY SUMMARY STRIP: all values derived from live attendance state -->
    <div class="att-summary-strip">
      <div class="att-sum-item">
        <div class="att-sum-dot" style="background:var(--green)"></div>
        <div><div class="att-sum-val">${present}</div><div class="att-sum-lbl">Present</div></div>
      </div>
      <div class="att-sum-item">
        <div class="att-sum-dot" style="background:var(--orange)"></div>
        <div><div class="att-sum-val">${half}</div><div class="att-sum-lbl">Half Day</div></div>
      </div>
      <div class="att-sum-item">
        <div class="att-sum-dot" style="background:var(--red)"></div>
        <div><div class="att-sum-val">${absent}</div><div class="att-sum-lbl">Absent</div></div>
      </div>
      <div class="att-sum-item att-sum-wages">
        <div class="att-sum-val text-gold">${fmt(dailyWages)}</div>
        <div class="att-sum-lbl">Day's Wages</div>
      </div>
    </div>
    <!-- FOOTER INFO BAR -->
    <div class="att-footer-bar">
      <span>Total Workers: <strong>${projWorkers.length}</strong></span>
      <span>Active Today: <strong>${activeToday}</strong></span>
      <span>Total Wages: <strong>${fmtFull(Math.round(dailyWages))}</strong></span>
    </div>

    <!-- WORKER ATTENDANCE CARDS -->
    ${projWorkers.length
      ? `<div class="att-cards-wrap">${workerRows}</div>`
      : `<div class="att-empty-state">No workers in the system yet.<br>Tap <strong>+</strong> to add workers.</div>`
    }

    <!-- WORKER DIRECTORY -->
    <div class="section-title">All Workers (Global Pool)</div>
    <div class="card" style="padding:0">
      ${workerDir || '<div style="padding:16px;color:var(--text2);font-size:13px;text-align:center">No workers added yet.</div>'}
    </div>

    <button class="fab" onclick="openModal('modal-worker')">+</button>`;
}

function shiftAttDate(delta) {
  const d = new Date(attDate + 'T00:00:00');
  // delta = -1 subtracts one day (← Previous), delta = +1 adds one day (→ Next)
  d.setDate(d.getDate() + delta);
  const next = fmtDate(d);
  // Block navigation into the future
  if (next > todayStr()) return;
  attDate = next;
  renderLabour();
}

function setAttProj(pid) { attProjId = pid; renderLabour(); }
function changeAttDate(val) { attDate = val; renderLabour(); }

// Write attendance for one worker on the current date.
// Always upserts into the keyed object — one record per worker per project-date, never appends.
function writeAtt(wid, rec) {
  const key = attProjId + '_' + attDate;
  if (!state.attendance[key] || typeof state.attendance[key] !== 'object') {
    state.attendance[key] = {};
  }
  const existing = state.attendance[key][wid];
  const prev = (typeof existing === 'object' && existing !== null)
    ? existing
    : { status: (typeof existing === 'string' ? existing : 'A'), otHours: 0, otRate: 0 };
  state.attendance[key][wid] = { ...prev, ...rec };
  saveUserState();
  renderLabour();
  if (currentPage === 'payroll') renderPayroll();
  if (currentPage === 'reports') renderReports();
}

function markAtt(wid, status) {
  if (status === 'F') {
    const dups = getFullDayProjectsForWorker(wid, attDate, attProjId);
    if (dups.length && !confirm(`⚠ This worker is already Full-Day Present in "${dups[0].name}" on ${attDate}.\nMark as Full-Day here too?`)) return;
  }
  writeAtt(wid, { status });
}
function setOT(wid, field, val)  { writeAtt(wid, { [field]: Number(val) || 0 }); }

function populateWorkerProjectSelect() { /* no-op: workers are global */ }

function addWorker() {
  const name = document.getElementById('inp-wname').value.trim();
  const wage = parseFloat(document.getElementById('inp-wwage').value);
  if (!name || !wage) return showToast('Fill all required fields');
  // Prevent duplicate worker names (case-insensitive)
  if (state.workers.some(w => w.name.toLowerCase() === name.toLowerCase())) {
    return showToast('A worker with this name already exists');
  }
  state.workers.push({ id: uid(), name, trade: document.getElementById('inp-wtrade').value, wage });
  closeModal('modal-worker');
  document.getElementById('inp-wname').value = '';
  document.getElementById('inp-wwage').value = '';
  saveUserState();
  showToast('Worker added — available across all projects');
  renderLabour();
}

function deleteWorker(wid) {
  requirePin('Delete Worker', () => {
    state.workers = state.workers.filter(w => w.id !== wid);
    Object.keys(state.attendance).forEach(k => { delete state.attendance[k][wid]; });
    state.wageSettlements = state.wageSettlements.filter(s => s.workerId !== wid);
    saveUserState();
    showToast('Worker removed');
    renderLabour();
  });
}

// ── PAYROLL ────────────────────────────────────────────────────────────────
let payWeekStart = '';
let payWeekEnd = '';
let payProjId = '';

function renderPayroll() {
  const el = document.getElementById('page-payroll');
  if (!payProjId && state.projects.length) payProjId = state.projects[0].id;
  if (!payWeekStart) {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    payWeekStart = fmtDate(d);
    const e2 = new Date(d); e2.setDate(e2.getDate() + 6);
    payWeekEnd = fmtDate(e2);
  }

  const projTabs = `<div class="proj-tabs">
    ${state.projects.map(p => `<div class="proj-tab ${payProjId===p.id?'active':''}" onclick="setPayProj('${p.id}')">${p.name.split(' ')[0]}</div>`).join('')}
  </div>`;

  const summary = calcWeeklyWages(payProjId, payWeekStart, payWeekEnd);
  // Derive totals from settlement records — never hardcode or store aggregate values
  const totalPaid    = summary.filter(r => r.paid).reduce((s, r) => s + r.total, 0);
  const totalPayable = summary.filter(r => !r.paid && r.units > 0).reduce((s, r) => s + r.total, 0);

  const rows = summary.map(r => {
    // Determine if this exact range already has a settled record
    const settled = state.wageSettlements.find(s =>
      s.workerId === r.wid && s.projId === payProjId &&
      s.weekStart === payWeekStart && s.weekEnd === payWeekEnd
    );
    const isAlreadyPaid = settled && settled.paid;
    // Warn if zero attendance for range
    const noWork = r.units === 0;
    let actionHtml;
    if (isAlreadyPaid) {
      actionHtml = `
        <span class="pay-status pay-paid">✓ Settled</span>
        <button class="btn btn-sm" style="background:#fef3e2;color:var(--orange);border:1px solid var(--orange)" onclick="undoPaid('${r.wid}')">↩ Undo</button>`;
    } else if (noWork) {
      actionHtml = `<span class="pay-status" style="background:var(--slate2);color:var(--text2)">No Attendance</span>`;
    } else {
      actionHtml = `
        <span class="pay-status pay-pending">Pending</span>
        <button class="btn btn-primary btn-sm" onclick="markPaid('${r.wid}')">Mark Paid</button>`;
    }
    return `
    <div class="pay-row">
      <div style="flex:1;min-width:0">
        <div class="pay-name">${r.name}</div>
        <div class="pay-detail">${r.trade} · ${r.days}F + ${r.half}H = ${r.units} units${r.otTotal > 0 ? ' + OT ₹' + r.otTotal.toLocaleString('en-IN') : ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="pay-amount">${fmtFull(r.total)}</div>
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap">${actionHtml}</div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="section-title" style="margin-top:4px">Weekly Wage Settlement</div>
    ${state.projects.length ? projTabs : ''}
    <div class="card">
      <div class="form-row">
        <div class="form-group mb0"><label>Week Start</label><input type="date" value="${payWeekStart}" max="${todayStr()}" onchange="payWeekStart=this.value;renderPayroll()"></div>
        <div class="form-group mb0"><label>Week End</label><input type="date" value="${payWeekEnd}" max="${todayStr()}" onchange="payWeekEnd=this.value;renderPayroll()"></div>
      </div>
      <div class="stat-row" style="margin-top:10px">
        <div class="stat"><div class="stat-val">${summary.length}</div><div class="stat-lbl">Workers</div></div>
        <div class="stat"><div class="stat-val text-gold">${fmt(totalPayable)}</div><div class="stat-lbl">Payable</div></div>
        <div class="stat"><div class="stat-val text-green">${fmt(totalPaid)}</div><div class="stat-lbl">Paid</div></div>
      </div>
    </div>
    <div class="section-title">Pay Sheet</div>
    <div class="card">${rows || '<p style="color:var(--text2);font-size:13px">No workers for this project.</p>'}</div>`;
}

function setPayProj(pid) { payProjId = pid; renderPayroll(); }

// Calculates wages for each worker over a date range from raw attendance records.
// Handles both old plain-string records and new object records { status, otHours, otRate }.
// Returns: { wid, name, trade, wage, days, half, units, otTotal, total, paid }
function calcWeeklyWages(projId, start, end) {
  // Only include workers who have at least one non-absent record for this project in the range
  const workers = state.workers.filter(w => {
    const d = new Date(start + 'T00:00:00'), endD = new Date(end + 'T00:00:00');
    while (d <= endD) {
      const raw = (state.attendance[projId + '_' + fmtDate(d)] || {})[w.id];
      const s = (typeof raw === 'object' && raw !== null) ? raw.status : raw;
      if (s && s !== 'A') return true;
      d.setDate(d.getDate() + 1);
    }
    return false;
  });
  return workers.map(w => {
    let days = 0, half = 0, otTotal = 0;
    const d = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    while (d <= endD) {
      const key    = projId + '_' + fmtDate(d);
      const raw    = (state.attendance[key] || {})[w.id];
      const rec    = (typeof raw === 'object' && raw !== null) ? raw : { status: raw || 'A', otHours: 0, otRate: 0 };
      const status = rec.status || 'A';
      if (status === 'F') days++;
      else if (status === 'H') half++;
      otTotal += (Number(rec.otHours) || 0) * (Number(rec.otRate) || 0);
      d.setDate(d.getDate() + 1);
    }
    const units = days + half * 0.5;
    const base  = Math.round(units * Number(w.wage));
    const total = base + Math.round(otTotal);
    const settlement = state.wageSettlements.find(s =>
      s.workerId === w.id && s.projId === projId &&
      s.weekStart === start && s.weekEnd === end
    );
    return { wid: w.id, name: w.name, trade: w.trade, wage: Number(w.wage), days, half, units, otTotal: Math.round(otTotal), total, paid: settlement ? settlement.paid : false };
  });
}

function markPaid(wid) {
  requirePin('Mark Paid', () => {
    // Prevent double-spend: check if already settled for this exact range
    const existing = state.wageSettlements.find(s =>
      s.workerId === wid && s.projId === payProjId &&
      s.weekStart === payWeekStart && s.weekEnd === payWeekEnd
    );
    if (existing && existing.paid) {
      showToast('Already settled for this date range');
      return;
    }
    const summary = calcWeeklyWages(payProjId, payWeekStart, payWeekEnd);
    const r = summary.find(x => x.wid === wid);
    if (!r || r.units === 0) { showToast('No attendance recorded for this period'); return; }
    if (existing) {
      existing.paid = true;
      existing.amount = r.total;
    } else {
      state.wageSettlements.push({
        id: uid(), workerId: wid, projId: payProjId,
        weekStart: payWeekStart, weekEnd: payWeekEnd,
        amount: r.total, paid: true
      });
    }
    saveUserState();
    showToast('Marked as paid');
    renderPayroll();
    if (currentPage === 'reports') renderReports();
    if (currentPage === 'dashboard') renderDashboard();
  });
}

function undoPaid(wid) {
  requirePin('Undo Payment', () => {
    const existing = state.wageSettlements.find(s =>
      s.workerId === wid && s.projId === payProjId &&
      s.weekStart === payWeekStart && s.weekEnd === payWeekEnd
    );
    if (!existing) return;
    existing.paid = false;
    saveUserState();
    showToast('Payment reverted to Pending');
    renderPayroll();
    if (currentPage === 'reports') renderReports();
    if (currentPage === 'dashboard') renderDashboard();
  });
}

// ── REPORTS ────────────────────────────────────────────────────────────────
let reportProjId = '';

function renderReports() {
  const el = document.getElementById('page-reports');
  if (!reportProjId && state.projects.length) reportProjId = state.projects[0].id;

  const projTabs = `<div class="proj-tabs">
    ${state.projects.map(p => `<div class="proj-tab ${reportProjId===p.id?'active':''}" onclick="setReportProj('${p.id}')">${p.name.split(' ')[0]}</div>`).join('')}
  </div>`;

  if (!state.projects.length) {
    el.innerHTML = `<div class="section-title" style="margin-top:4px">Project Reports</div><div class="card" style="text-align:center;color:var(--text2);padding:30px">No projects yet.</div>`;
    return;
  }

  const p = state.projects.find(x => x.id === reportProjId);
  if (!p) return;
  const isDaily = p.type === 'daily';
  const spent = projectSpent(reportProjId);
  const expTotal = projectExpenses(reportProjId);
  const wageTotal = projectLabourWages(reportProjId);
  const rem = p.value - spent;
  const pct = p.value > 0 ? Math.min(100, Math.round((spent / p.value) * 100)) : 0;

  // For daily-wages: show billing-focused report
  if (isDaily) {
    // Show only workers who have attendance or settlements for this project
    const projWorkers = state.workers.filter(w => workerTotalDue(w.id, reportProjId) > 0 || workerTotalPaid(w.id, reportProjId) > 0);
    // All figures derived from raw attendance + settlement records — no static values
    const workerStats = projWorkers.map(w => {
      const due     = workerTotalDue(w.id, reportProjId);
      const paid    = workerTotalPaid(w.id, reportProjId);
      const pending = Math.max(0, due - paid);
      return { ...w, due, paid, pending };
    });
    const totalPaid    = workerStats.reduce((s, w) => s + w.paid, 0);
    const totalPending = workerStats.reduce((s, w) => s + w.pending, 0);
    const labourRows = workerStats.map(w =>
      `<tr>
        <td>${w.name}</td>
        <td>${w.trade}</td>
        <td style="text-align:right">${fmtFull(w.wage)}/day</td>
        <td style="font-weight:700;text-align:right;color:var(--green)">${fmtFull(w.paid)}</td>
        <td style="font-weight:700;text-align:right;color:var(--red)">${fmtFull(w.pending)}</td>
      </tr>`
    ).join('');
    el.innerHTML = `
      <div class="section-title" style="margin-top:4px">Project Reports</div>
      ${projTabs}
      <div class="card" style="background:var(--navy);color:var(--white);padding:16px">
        <div style="font-size:16px;font-weight:800">${p.name} <span style="font-size:12px;background:rgba(229,169,60,0.3);padding:2px 8px;border-radius:10px;color:var(--gold)">Daily Wages</span></div>
        <div style="font-size:12px;color:var(--gold);margin-top:2px">${p.client||''} ${p.location?'· '+p.location:''} · ${p.status}</div>
        <div class="stat-row" style="margin-top:12px">
          <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:var(--gold)">${fmt(totalPaid)}</div><div class="stat-lbl" style="color:var(--gold)">Total Paid</div></div>
          <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:#f1948a">${fmt(totalPending)}</div><div class="stat-lbl" style="color:var(--gold)">Pending</div></div>
          <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:#fff">${projWorkers.length}</div><div class="stat-lbl" style="color:var(--gold)">Workers</div></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-header">👷 Labour Summary</div>
        <div class="report-body" style="padding:0">
          <div class="table-wrap"><table>
            <thead><tr><th>Worker</th><th>Trade</th><th style="text-align:right">Rate</th><th style="text-align:right">Wages Paid</th><th style="text-align:right">Pending</th></tr></thead>
            <tbody>${labourRows||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:16px">No workers</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:4px;margin-bottom:16px">
        <button class="btn btn-primary" style="flex:1" onclick="openBillingModal('${reportProjId}')">📋 Weekly Bill</button>
        <button class="btn btn-navy" style="flex:1" onclick="downloadReport('${reportProjId}')">⬇ Download</button>
      </div>`;
    return;
  }

  // Stage breakdown
  const stageMap = {};
  state.expenses.filter(e => e.projId === reportProjId).forEach(e => {
    stageMap[e.stage] = (stageMap[e.stage] || 0) + Number(e.amount);
  });
  const stageRows = Object.entries(stageMap).map(([s, v]) =>
    `<tr><td>${s}</td><td style="font-weight:700;text-align:right">${fmtFull(v)}</td><td style="text-align:right;color:var(--text2)">${p.value > 0 ? ((v/p.value)*100).toFixed(1) : 0}%</td></tr>`
  ).join('');

  // All expenses
  const expRows = [...state.expenses.filter(e => e.projId === reportProjId)]
    .sort((a,b) => b.date.localeCompare(a.date))
    .map(e => `<tr><td>${e.date}</td><td>${e.stage}</td><td style="font-weight:700;text-align:right">${fmtFull(e.amount)}</td><td style="font-size:11px;color:var(--text2)">${e.notes||''}</td></tr>`).join('');

  // Labour summary — only workers with activity on this project
  const projWorkers = state.workers.filter(w => workerTotalDue(w.id, reportProjId) > 0 || workerTotalPaid(w.id, reportProjId) > 0);
  const labourRows = projWorkers.map(w => {
    const due     = workerTotalDue(w.id, reportProjId);
    const paid    = workerTotalPaid(w.id, reportProjId);
    const pending = Math.max(0, due - paid);
    return `<tr>
      <td>${w.name}</td>
      <td>${w.trade}</td>
      <td style="text-align:right">${fmtFull(w.wage)}/day</td>
      <td style="font-weight:700;text-align:right;color:var(--green)">${fmtFull(paid)}</td>
      <td style="font-weight:700;text-align:right;color:var(--red)">${fmtFull(pending)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="section-title" style="margin-top:4px">Project Reports</div>
    ${projTabs}
    <div class="card" style="background:var(--navy);color:var(--white);padding:16px">
      <div style="font-size:16px;font-weight:800">${p.name}</div>
      <div style="font-size:12px;color:var(--gold);margin-top:2px">${p.client||''} ${p.location?'· '+p.location:''} · ${p.status}</div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:#fff">${fmt(p.value)}</div><div class="stat-lbl" style="color:var(--gold)">Contract</div></div>
        <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:var(--gold)">${fmt(spent)}</div><div class="stat-lbl" style="color:var(--gold)">Spent</div></div>
        <div class="stat" style="background:rgba(255,255,255,0.1)"><div class="stat-val" style="color:${rem<0?'#f1948a':'#82e0aa'}">${fmt(Math.abs(rem))}</div><div class="stat-lbl" style="color:var(--gold)">${rem<0?'Overrun':'Balance'}</div></div>
      </div>
      <div class="progress-wrap mt8">
        <div class="progress-label" style="color:rgba(255,255,255,0.7)"><span>Budget Used</span><span>${pct}%</span></div>
        <div class="progress-bar"><div class="progress-fill ${pct>85?'danger':''}" style="width:${pct}%"></div></div>
      </div>
    </div>

    <div class="report-section">
      <div class="report-header">💰 Financial Summary</div>
      <div class="report-body">
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--slate2)"><span>Contract Value</span><strong>${fmtFull(p.value)}</strong></div>
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--slate2)"><span>Stage Expenses</span><strong class="text-gold">${fmtFull(expTotal)}</strong></div>
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--slate2)"><span>Labour Wages Paid</span><strong class="text-gold">${fmtFull(wageTotal)}</strong></div>
        <div class="flex-between" style="padding:6px 0"><span style="font-weight:700">Remaining Balance</span><strong class="${rem<0?'text-red':'text-green'}" style="font-size:16px">${fmtFull(rem)}</strong></div>
      </div>
    </div>

    <div class="report-section">
      <div class="report-header">🏗 Stage-wise Breakdown</div>
      <div class="report-body" style="padding:0">
        <div class="table-wrap"><table>
          <thead><tr><th>Stage</th><th style="text-align:right">Amount</th><th style="text-align:right">% of Contract</th></tr></thead>
          <tbody>${stageRows || '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:16px">No expenses</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>

    <div class="report-section">
      <div class="report-header">📋 All Expenses</div>
      <div class="report-body" style="padding:0">
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Stage</th><th style="text-align:right">Amount</th><th>Notes</th></tr></thead>
          <tbody>${expRows || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:16px">No expenses</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>

    <div class="report-section">
      <div class="report-header">👷 Labour Summary</div>
      <div class="report-body" style="padding:0">
        <div class="table-wrap"><table>
          <thead><tr><th>Worker</th><th>Trade</th><th style="text-align:right">Rate</th><th style="text-align:right">Wages Paid</th><th style="text-align:right">Pending</th></tr></thead>
          <tbody>${labourRows || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:16px">No workers</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:4px;margin-bottom:16px">
      <button class="btn btn-navy" style="flex:1" onclick="downloadReport('${reportProjId}')">⬇ Download Report</button>
      <button class="btn btn-primary" style="flex:1" onclick="printReport('${reportProjId}')">🖨 Print</button>
    </div>`;
}

function setReportProj(pid) { reportProjId = pid; renderReports(); }

function downloadReport(pid) {
  const p = state.projects.find(x => x.id === pid);
  if (!p) return;
  const spent = projectSpent(pid);
  const expTotal = projectExpenses(pid);
  const wageTotal = projectLabourWages(pid);
  const rem = p.value - spent;
  const stageMap = {};
  state.expenses.filter(e => e.projId === pid).forEach(e => { stageMap[e.stage] = (stageMap[e.stage]||0) + Number(e.amount); });
  const expList = [...state.expenses.filter(e => e.projId === pid)].sort((a,b) => b.date.localeCompare(a.date));
  const projWorkers = state.workers.filter(w => workerTotalDue(w.id, pid) > 0 || workerTotalPaid(w.id, pid) > 0);

  let csv = `SK CONSTRUCTIONS – PROJECT REPORT\n`;
  csv += `Generated: ${new Date().toLocaleString('en-IN')}\n\n`;
  csv += `PROJECT DETAILS\n`;
  csv += `Name,${p.name}\nClient,${p.client||''}\nLocation,${p.location||''}\nStatus,${p.status}\nStart Date,${p.startDate||''}\n\n`;
  csv += `FINANCIAL SUMMARY\n`;
  csv += `Contract Value,${p.value}\nStage Expenses,${expTotal}\nLabour Wages Paid,${wageTotal}\nTotal Spent,${spent}\nRemaining Balance,${rem}\n\n`;
  csv += `STAGE BREAKDOWN\nStage,Amount\n`;
  Object.entries(stageMap).forEach(([s,v]) => { csv += `${s},${v}\n`; });
  csv += `\nALL EXPENSES\nDate,Stage,Amount,Notes\n`;
  expList.forEach(e => { csv += `${e.date},${e.stage},${e.amount},"${e.notes||''}"\n`; });
  csv += `\nLABOUR SUMMARY\nWorker,Trade,Daily Rate,Wages Paid\n`;
  projWorkers.forEach(w => {
    const paid = state.wageSettlements.filter(s => s.workerId === w.id && s.projId === pid && s.paid).reduce((s,x) => s+Number(x.amount), 0);
    csv += `${w.name},${w.trade},${w.wage},${paid}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sktools_${p.name.replace(/\s+/g,'_')}_report.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded');
}

function printReport(pid) {
  const p = state.projects.find(x => x.id === pid);
  if (!p) return;
  const spent = projectSpent(pid);
  const rem = p.value - spent;
  const expTotal = projectExpenses(pid);
  const wageTotal = projectLabourWages(pid);
  const stageMap = {};
  state.expenses.filter(e => e.projId === pid).forEach(e => { stageMap[e.stage] = (stageMap[e.stage]||0) + Number(e.amount); });
  const expList = [...state.expenses.filter(e => e.projId === pid)].sort((a,b) => b.date.localeCompare(a.date));
  const projWorkers = state.workers.filter(w => workerTotalDue(w.id, pid) > 0 || workerTotalPaid(w.id, pid) > 0);

  const stageHtml = Object.entries(stageMap).map(([s,v]) => `<tr><td>${s}</td><td style="text-align:right">₹${v.toLocaleString('en-IN')}</td></tr>`).join('');
  const expHtml = expList.map(e => `<tr><td>${e.date}</td><td>${e.stage}</td><td style="text-align:right">₹${Number(e.amount).toLocaleString('en-IN')}</td><td>${e.notes||''}</td></tr>`).join('');
  const labHtml = projWorkers.map(w => {
    const paid = state.wageSettlements.filter(s => s.workerId===w.id && s.projId===pid && s.paid).reduce((s,x)=>s+Number(x.amount),0);
    return `<tr><td>${w.name}</td><td>${w.trade}</td><td style="text-align:right">₹${w.wage}/day</td><td style="text-align:right">₹${paid.toLocaleString('en-IN')}</td></tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Report – ${p.name}</title>
  <style>body{font-family:Arial,sans-serif;padding:24px;color:#1a2a3a;max-width:800px;margin:0 auto}
  h1{color:#0B1D3A;font-size:22px}h2{color:#0B1D3A;font-size:15px;margin:20px 0 8px;border-bottom:2px solid #E5A93C;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}
  th{background:#0B1D3A;color:#fff;padding:7px 10px;text-align:left}td{padding:6px 10px;border-bottom:1px solid #e8ecf2}
  .summary-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e8ecf2}
  .brand{color:#E5A93C;font-size:12px;letter-spacing:2px}
  @media print{button{display:none}}</style></head><body>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:48px;height:48px;background:#E5A93C;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:#0B1D3A">SK</div>
    <div><div style="font-size:22px;font-weight:900;color:#0B1D3A">sktools</div><div class="brand">SK CONSTRUCTIONS</div></div>
  </div>
  <h1>${p.name}</h1>
  <p style="color:#5a6a7a;font-size:13px">${p.client||''} ${p.location?'· '+p.location:''} · ${p.status} · Started ${p.startDate||''}</p>
  <p style="font-size:12px;color:#888;margin-top:4px">Generated: ${new Date().toLocaleString('en-IN')}</p>
  <h2>Financial Summary</h2>
  <div class="summary-row"><span>Contract Value</span><strong>₹${Number(p.value).toLocaleString('en-IN')}</strong></div>
  <div class="summary-row"><span>Stage Expenses</span><strong>₹${expTotal.toLocaleString('en-IN')}</strong></div>
  <div class="summary-row"><span>Labour Wages Paid</span><strong>₹${wageTotal.toLocaleString('en-IN')}</strong></div>
  <div class="summary-row"><span>Total Spent</span><strong>₹${spent.toLocaleString('en-IN')}</strong></div>
  <div class="summary-row"><span><strong>Remaining Balance</strong></span><strong style="color:${rem<0?'#e74c3c':'#27ae60'};font-size:16px">₹${rem.toLocaleString('en-IN')}</strong></div>
  <h2>Stage-wise Breakdown</h2>
  <table><thead><tr><th>Stage</th><th style="text-align:right">Amount</th></tr></thead><tbody>${stageHtml||'<tr><td colspan="2">No data</td></tr>'}</tbody></table>
  <h2>All Expenses</h2>
  <table><thead><tr><th>Date</th><th>Stage</th><th style="text-align:right">Amount</th><th>Notes</th></tr></thead><tbody>${expHtml||'<tr><td colspan="4">No data</td></tr>'}</tbody></table>
  <h2>Labour Summary</h2>
  <table><thead><tr><th>Worker</th><th>Trade</th><th style="text-align:right">Rate</th><th style="text-align:right">Wages Paid</th></tr></thead><tbody>${labHtml||'<tr><td colspan="4">No data</td></tr>'}</tbody></table>
  <button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#0B1D3A;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print</button>
  </body></html>`);
  win.document.close();
}

// ── BILLING MODAL ─────────────────────────────────────────────────────────
let billingProjId = '';

function openBillingModal(pid) {
  billingProjId = pid;
  const p = state.projects.find(x => x.id === pid);
  document.getElementById('billing-proj-name').textContent = (p?.name || '') + ' · Daily Wages / Renovation';
  // Default to current week
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const billStartEl = document.getElementById('bill-start');
  const billEndEl   = document.getElementById('bill-end');
  billStartEl.value = fmtDate(d);
  billStartEl.max   = todayStr();
  const e2 = new Date(d); e2.setDate(e2.getDate() + 6);
  billEndEl.value = fmtDate(e2);
  billEndEl.max   = todayStr();
  document.getElementById('bill-margin').value = '0';
  renderBillingPreview();
  openModal('modal-billing');
}

function renderBillingPreview() {
  const pid = billingProjId;
  const start = document.getElementById('bill-start').value;
  const end   = document.getElementById('bill-end').value;
  const margin = parseFloat(document.getElementById('bill-margin').value) || 0;
  if (!pid || !start || !end) return;

  const summary = calcWeeklyWages(pid, start, end);
  const totalWages = summary.reduce((s, r) => s + r.total, 0);
  const marginAmt  = Math.round(totalWages * margin / 100);
  const grandTotal = totalWages + marginAmt;

  const rows = summary.map(r => `<tr>
    <td>${r.name}</td>
    <td style="color:var(--text2)">${r.trade}</td>
    <td style="text-align:center">${r.days}F ${r.half > 0 ? r.half + 'H' : ''}</td>
    <td style="text-align:right">${fmtFull(r.wage)}</td>
    <td style="font-weight:700;text-align:right">${fmtFull(r.total)}</td>
  </tr>`).join('');

  document.getElementById('billing-preview').innerHTML = `
    <div class="billing-table-wrap">
      <table>
        <thead><tr><th>Worker</th><th>Trade</th><th style="text-align:center">Days</th><th style="text-align:right">Rate/Day</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:14px">No workers / no attendance for this period</td></tr>'}</tbody>
      </table>
    </div>
    <div style="margin-top:10px">
      <div class="billing-sub-row"><span>Total Labour Wages</span><span>${fmtFull(totalWages)}</span></div>
      ${margin > 0 ? `<div class="billing-sub-row"><span>Supervision Charge (${margin}%)</span><span>${fmtFull(marginAmt)}</span></div>` : ''}
      <div class="billing-grand"><span>Total Client Payable</span><span>${fmtFull(grandTotal)}</span></div>
    </div>`;
}

function getBillingData() {
  const pid    = billingProjId;
  const start  = document.getElementById('bill-start').value;
  const end    = document.getElementById('bill-end').value;
  const margin = parseFloat(document.getElementById('bill-margin').value) || 0;
  const p      = state.projects.find(x => x.id === pid);
  const summary = calcWeeklyWages(pid, start, end);
  const totalWages = summary.reduce((s, r) => s + r.total, 0);
  const marginAmt  = Math.round(totalWages * margin / 100);
  const grandTotal = totalWages + marginAmt;
  return { p, start, end, margin, marginAmt, summary, totalWages, grandTotal };
}

function copyBillingWhatsApp() {
  const { p, start, end, margin, marginAmt, summary, totalWages, grandTotal } = getBillingData();
  const users = LS.get('skt_users') || {};
  const userName = users[currentUser]?.name || 'SK Constructions';
  let txt = `🏗️ *SK CONSTRUCTIONS*\n*Weekly Labour Bill*\n\n*Project:* ${p?.name || ''}\n*Client:* ${p?.client || ''}\n*Period:* ${start} to ${end}\n\n`;
  txt += `*Worker Attendance & Wages:*\n`;
  summary.forEach(r => {
    txt += `• ${r.name} (${r.trade}) – ${r.days} Full${r.half ? ', ' + r.half + ' Half' : ''} = ₹${r.total.toLocaleString('en-IN')}\n`;
  });
  txt += `\n*Total Labour Wages: ₹${totalWages.toLocaleString('en-IN')}*`;
  if (margin > 0) txt += `\n*Supervision Charge (${margin}%): ₹${marginAmt.toLocaleString('en-IN')}*`;
  txt += `\n\n⭐ *Total Payable: ₹${grandTotal.toLocaleString('en-IN')}*`;
  txt += `\n\n_Generated by sktools – ${userName}_`;

  const waUrl = 'https://wa.me/919985565630?text=' + encodeURIComponent(txt);
  window.open(waUrl, '_blank');
  showToast('Opening WhatsApp...');
}

function printBillingReport() {
  const { p, start, end, margin, marginAmt, summary, totalWages, grandTotal } = getBillingData();
  const rows = summary.map(r => `<tr><td>${r.name}</td><td>${r.trade}</td><td style="text-align:center">${r.days}F ${r.half?r.half+'H':''}</td><td style="text-align:right">₹${r.wage.toLocaleString('en-IN')}</td><td style="font-weight:700;text-align:right">₹${r.total.toLocaleString('en-IN')}</td></tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Weekly Bill – ${p?.name}</title>
  <style>body{font-family:Arial,sans-serif;padding:24px;color:#1a2a3a;max-width:700px;margin:0 auto}
  h2{color:#0B1D3A;font-size:15px;margin:16px 0 8px;border-bottom:2px solid #E5A93C;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}
  th{background:#0B1D3A;color:#fff;padding:7px 10px;text-align:left}td{padding:6px 10px;border-bottom:1px solid #e8ecf2}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e8ecf2}
  .grand{display:flex;justify-content:space-between;padding:12px;background:#0B1D3A;color:#fff;border-radius:8px;font-size:16px;font-weight:800;margin-top:8px}
  @media print{button{display:none}}</style></head><body>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:48px;height:48px;background:#E5A93C;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:#0B1D3A">SK</div>
    <div><div style="font-size:20px;font-weight:900;color:#0B1D3A">sktools</div><div style="color:#E5A93C;font-size:11px;letter-spacing:2px">SK CONSTRUCTIONS</div></div>
  </div>
  <h1 style="color:#0B1D3A;font-size:18px;margin-bottom:4px">Weekly Labour Bill</h1>
  <p style="color:#5a6a7a;font-size:13px"><strong>Project:</strong> ${p?.name} &nbsp;·&nbsp; <strong>Client:</strong> ${p?.client||'N/A'} &nbsp;·&nbsp; <strong>Period:</strong> ${start} to ${end}</p>
  <p style="font-size:12px;color:#888;margin-top:4px">Generated: ${new Date().toLocaleString('en-IN')}</p>
  <h2>Attendance & Wages</h2>
  <table><thead><tr><th>Worker</th><th>Trade</th><th style="text-align:center">Days</th><th style="text-align:right">Rate/Day</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No data</td></tr>'}</tbody></table>
  <div class="row"><span>Total Labour Wages</span><strong>₹${totalWages.toLocaleString('en-IN')}</strong></div>
  ${margin>0?`<div class="row"><span>Supervision Charge (${margin}%)</span><strong>₹${marginAmt.toLocaleString('en-IN')}</strong></div>`:''}
  <div class="grand"><span>Total Client Payable</span><span>₹${grandTotal.toLocaleString('en-IN')}</span></div>
  <button onclick="window.print()" style="margin-top:20px;padding:10px 24px;background:#0B1D3A;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print</button>
  </body></html>`);
  win.document.close();
}

function downloadBillingCSV() {
  const { p, start, end, margin, marginAmt, summary, totalWages, grandTotal } = getBillingData();
  let csv = `SK CONSTRUCTIONS – WEEKLY LABOUR BILL\nProject,${p?.name}\nClient,${p?.client||''}\nPeriod,${start} to ${end}\nGenerated,${new Date().toLocaleString('en-IN')}\n\n`;
  csv += `Worker,Trade,Full Days,Half Days,Units,Rate/Day,Total\n`;
  summary.forEach(r => { csv += `${r.name},${r.trade},${r.days},${r.half},${r.units},${r.wage},${r.total}\n`; });
  csv += `\nTotal Labour Wages,,,,,,${totalWages}\n`;
  if (margin > 0) csv += `Supervision Charge (${margin}%),,,,,,${marginAmt}\n`;
  csv += `Total Client Payable,,,,,,${grandTotal}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `sktools_bill_${(p?.name||'').replace(/\s+/g,'_')}_${start}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Bill downloaded');
}

// ── INIT ───────────────────────────────────────────────────────────────────
(function init() {
  const session = LS.get('skt_session');
  if (session) {
    const users = LS.get('skt_users') || {};
    if (users[session]) {
      currentUser = session;
      loadUserState();
      bootApp();
      return;
    }
  }
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app').style.display = 'none';
})();
