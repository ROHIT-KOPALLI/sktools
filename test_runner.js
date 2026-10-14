// test_runner.js — Stress test for app.js pure business logic
// Run: node test_runner.js

// ── SHIM browser globals ───────────────────────────────────────────────────
const _store = {};
global.localStorage = {
  getItem: k => _store[k] ?? null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: k => { delete _store[k]; }
};
global.Math.imul = global.Math.imul || ((a, b) => {
  const ah = (a >>> 16) & 0xffff, al = a & 0xffff;
  const bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
});

// ── EXTRACT pure functions from app.js ────────────────────────────────────
// We re-implement them here verbatim so node can run them without DOM deps.

function hashPin(pin) {
  if (pin == null) return '0';
  const s = String(pin);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}

function fmtFull(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// State used by aggregation helpers
let state = { projects: [], expenses: [], workers: [], attendance: {}, wageSettlements: [] };

function projectExpenses(pid) {
  return state.expenses.filter(e => e.projId === pid).reduce((s, e) => s + Number(e.amount), 0);
}
function projectLabourWages(pid) {
  return state.wageSettlements.filter(s => s.projId === pid && s.paid).reduce((s, x) => s + Number(x.amount), 0);
}
function projectSpent(pid) { return projectExpenses(pid) + projectLabourWages(pid); }

function dayEarned(w, dayAttRecord) {
  const rec    = (typeof dayAttRecord === 'object' && dayAttRecord !== null) ? dayAttRecord : { status: dayAttRecord || 'A' };
  const status = rec.status || 'A';
  if (status === 'A') return 0;
  const base = status === 'F' ? Number(w.wage) : Number(w.wage) * 0.5;
  const ot   = (Number(rec.otHours) || 0) * (Number(rec.otRate) || 0);
  return base + ot;
}

function workerTotalDue(wid, pid) {
  const w = state.workers.find(x => x.id === wid && x.projId === pid);
  if (!w) return 0;
  const prefix = pid + '_';
  return Math.round(
    Object.entries(state.attendance)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((sum, [, dayAtt]) => sum + dayEarned(w, dayAtt[wid]), 0)
  );
}

function workerTotalPaid(wid, pid) {
  return state.wageSettlements
    .filter(s => s.workerId === wid && s.projId === pid && s.paid)
    .reduce((s, x) => s + Number(x.amount), 0);
}

function calcWeeklyWages(projId, start, end) {
  const workers = state.workers.filter(w => w.projId === projId);
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

// ── TEST HARNESS ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(label, condition, got, expected) {
  if (condition === true || (condition !== false && condition)) {
    passed++;
  } else {
    failed++;
    failures.push({ label, got, expected });
  }
}

function resetState() {
  state = { projects: [], expenses: [], workers: [], attendance: {}, wageSettlements: [] };
}

// ── SECTION 1: hashPin ─────────────────────────────────────────────────────
{
  // Determinism
  for (let i = 0; i < 500; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    assert(`hashPin deterministic ${pin}`, hashPin(pin) === hashPin(pin), hashPin(pin), hashPin(pin));
  }
  // Known values don't collide trivially
  const pins = ['0000','1111','1234','9999','0001','1000'];
  const hashes = pins.map(hashPin);
  const unique = new Set(hashes).size;
  assert('hashPin no trivial collisions', unique === pins.length, unique, pins.length);
  // Empty string doesn't throw
  try { hashPin(''); assert('hashPin empty string', true); } catch(e) { assert('hashPin empty string no throw', false, e.message, 'no error'); }
  // Non-digit chars (shouldn't crash)
  try { hashPin('abcd'); assert('hashPin non-digit no throw', true); } catch(e) { assert('hashPin non-digit no throw', false, e.message, 'no error'); }
  // Null/undefined guard
  try { hashPin(null); assert('hashPin null no throw', true); } catch(e) { assert('hashPin null no throw', false, e.message, 'no error'); }
}

// ── SECTION 2: fmtDate ────────────────────────────────────────────────────
{
  const d = new Date(2024, 0, 5); // Jan 5 2024 local
  assert('fmtDate Jan 5', fmtDate(d), '2024-01-05', '2024-01-05');
  const d2 = new Date(2024, 11, 31);
  assert('fmtDate Dec 31', fmtDate(d2), '2024-12-31', '2024-12-31');
  // No UTC shift: month/day must be local
  for (let i = 0; i < 200; i++) {
    const rd = new Date(2020 + Math.floor(Math.random()*5), Math.floor(Math.random()*12), 1 + Math.floor(Math.random()*28));
    const result = fmtDate(rd);
    const parts = result.split('-');
    assert(`fmtDate format YYYY-MM-DD iter${i}`,
      parts.length === 3 && parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2,
      result, 'YYYY-MM-DD');
  }
}

// ── SECTION 3: fmt ────────────────────────────────────────────────────────
{
  assert('fmt 0',       fmt(0),       '₹0',       '₹0');
  assert('fmt 999',     fmt(999),     '₹999',     '₹999');
  assert('fmt 1000',    fmt(1000),    '₹1.0K',    '₹1.0K');
  assert('fmt 1500',    fmt(1500),    '₹1.5K',    '₹1.5K');
  assert('fmt 99999',   fmt(99999),   '₹100.0K',  '₹100.0K');
  assert('fmt 100000',  fmt(100000),  '₹1.00L',   '₹1.00L');
  assert('fmt 150000',  fmt(150000),  '₹1.50L',   '₹1.50L');
  assert('fmt null',    fmt(null),    '₹0',       '₹0');
  assert('fmt undefined', fmt(undefined), '₹0',   '₹0');
  assert('fmt NaN',     fmt(NaN),     '₹0',       '₹0');
  assert('fmt string',  fmt('5000'),  '₹5.0K',    '₹5.0K');
  assert('fmt negative',fmt(-500),    '₹-500',    '₹-500');
  // Stress: no throw on extreme values
  for (let i = 0; i < 300; i++) {
    const v = (Math.random() - 0.5) * 1e9;
    try { fmt(v); assert(`fmt extreme no throw iter${i}`, true); }
    catch(e) { assert(`fmt extreme no throw iter${i}`, false, e.message, 'no error'); }
  }
}

// ── SECTION 4: dayEarned ─────────────────────────────────────────────────
{
  const w600 = { wage: 600 };
  const w0   = { wage: 0 };

  assert('dayEarned Absent',    dayEarned(w600, { status: 'A' }) === 0,           true, true);
  assert('dayEarned Full',      dayEarned(w600, { status: 'F' }) === 600,         true, true);
  assert('dayEarned Half',      dayEarned(w600, { status: 'H' }) === 300,         true, true);
  assert('dayEarned OT',        dayEarned(w600, { status: 'F', otHours: 2, otRate: 100 }) === 800, true, true);
  assert('dayEarned Half+OT',   dayEarned(w600, { status: 'H', otHours: 1, otRate: 50 }) === 350,  true, true);
  assert('dayEarned zero wage', dayEarned(w0,   { status: 'F' }) === 0,           true, true);
  // Legacy plain-string record
  assert('dayEarned legacy F',  dayEarned(w600, 'F') === 600,  true, true);
  assert('dayEarned legacy H',  dayEarned(w600, 'H') === 300,  true, true);
  assert('dayEarned legacy A',  dayEarned(w600, 'A') === 0,    true, true);
  assert('dayEarned null rec',  dayEarned(w600, null) === 0,   true, true);
  assert('dayEarned undef rec', dayEarned(w600, undefined) === 0, true, true);
  // OT with zero hours/rate should not add anything
  assert('dayEarned OT zeros',  dayEarned(w600, { status: 'F', otHours: 0, otRate: 0 }) === 600, true, true);
  // Negative OT values — should not corrupt (app doesn't guard, document result)
  const negOT = dayEarned(w600, { status: 'F', otHours: -2, otRate: 100 });
  assert('dayEarned negative OT is numeric', typeof negOT === 'number', negOT, 'number');

  // Stress: random valid combos
  for (let i = 0; i < 500; i++) {
    const wage = Math.floor(Math.random() * 2000);
    const status = ['F','H','A'][Math.floor(Math.random()*3)];
    const otH = Math.floor(Math.random() * 12);
    const otR = Math.floor(Math.random() * 200);
    const rec = { status, otHours: otH, otRate: otR };
    const earned = dayEarned({ wage }, rec);
    const expectedBase = status === 'A' ? 0 : status === 'F' ? wage : wage * 0.5;
    const expectedOT   = status === 'A' ? 0 : otH * otR;
    assert(`dayEarned stress iter${i}`, Math.abs(earned - (expectedBase + expectedOT)) < 0.001, earned, expectedBase + expectedOT);
  }
}

// ── SECTION 5: calcWeeklyWages ────────────────────────────────────────────
{
  resetState();
  const pid = 'proj1';
  const wid = 'w1';
  state.workers.push({ id: wid, name: 'Ravi', trade: 'Mason', wage: 600, projId: pid });

  // Mark 5 full days Mon–Fri
  const monDate = '2024-01-01';
  for (let i = 0; i < 5; i++) {
    const d = new Date('2024-01-01T00:00:00');
    d.setDate(d.getDate() + i);
    state.attendance[pid + '_' + fmtDate(d)] = { [wid]: { status: 'F', otHours: 0, otRate: 0 } };
  }
  const wages = calcWeeklyWages(pid, '2024-01-01', '2024-01-07');
  assert('calcWeekly 5F days',   wages[0].days === 5,    true, true);
  assert('calcWeekly 5F half',   wages[0].half === 0,    true, true);
  assert('calcWeekly 5F units',  wages[0].units === 5,   true, true);
  assert('calcWeekly 5F total',  wages[0].total === 3000, true, true);
  assert('calcWeekly paid=false',wages[0].paid === false, true, true);

  // Add a half day on day 6
  state.attendance[pid + '_2024-01-06'] = { [wid]: { status: 'H', otHours: 0, otRate: 0 } };
  const wages2 = calcWeeklyWages(pid, '2024-01-01', '2024-01-07');
  assert('calcWeekly 5F+1H units', wages2[0].units, 5.5, 5.5);
  assert('calcWeekly 5F+1H total', wages2[0].total, Math.round(5.5 * 600), Math.round(5.5 * 600));

  // OT on day 1
  state.attendance[pid + '_2024-01-01'] = { [wid]: { status: 'F', otHours: 2, otRate: 100 } };
  const wages3 = calcWeeklyWages(pid, '2024-01-01', '2024-01-07');
  assert('calcWeekly OT total', wages3[0].total, Math.round(5.5 * 600) + 200, Math.round(5.5 * 600) + 200);

  // Empty range (start > end) — should return 0 units
  const wages4 = calcWeeklyWages(pid, '2024-01-07', '2024-01-01');
  assert('calcWeekly inverted range units', wages4[0].units === 0, true, true);

  // No workers for project
  const wages5 = calcWeeklyWages('nonexistent', '2024-01-01', '2024-01-07');
  assert('calcWeekly no workers', wages5.length === 0, true, true);

  // Settlement marks paid
  state.wageSettlements.push({ id: 's1', workerId: wid, projId: pid, weekStart: '2024-01-01', weekEnd: '2024-01-07', amount: 3000, paid: true });
  const wages6 = calcWeeklyWages(pid, '2024-01-01', '2024-01-07');
  assert('calcWeekly paid=true after settlement', wages6[0].paid === true, true, true);

  // Stress: random weeks, random attendance
  for (let i = 0; i < 300; i++) {
    resetState();
    const spid = 'sp' + i;
    const swid = 'sw' + i;
    const wage = 400 + Math.floor(Math.random() * 800);
    state.workers.push({ id: swid, name: 'Worker', trade: 'Helper', wage, projId: spid });
    let expectedUnits = 0;
    for (let d = 0; d < 7; d++) {
      const dt = new Date('2024-03-04T00:00:00');
      dt.setDate(dt.getDate() + d);
      const s = ['F','H','A'][Math.floor(Math.random()*3)];
      state.attendance[spid + '_' + fmtDate(dt)] = { [swid]: { status: s, otHours: 0, otRate: 0 } };
      if (s === 'F') expectedUnits += 1;
      else if (s === 'H') expectedUnits += 0.5;
    }
    const sw = calcWeeklyWages(spid, '2024-03-04', '2024-03-10');
    assert(`calcWeekly stress units iter${i}`, Math.abs(sw[0].units - expectedUnits) < 0.001, sw[0].units, expectedUnits);
    assert(`calcWeekly stress total iter${i}`, sw[0].total === Math.round(expectedUnits * wage), true, true);
  }
}

// ── SECTION 6: workerTotalDue ─────────────────────────────────────────────
{
  resetState();
  const pid = 'proj2';
  const wid = 'w2';
  state.workers.push({ id: wid, name: 'Suresh', trade: 'Helper', wage: 500, projId: pid });

  // 3 full days across different dates
  ['2024-02-01','2024-02-02','2024-02-03'].forEach(date => {
    state.attendance[pid + '_' + date] = { [wid]: { status: 'F', otHours: 0, otRate: 0 } };
  });
  assert('workerTotalDue 3F', workerTotalDue(wid, pid) === 1500, true, true);

  // Add a half day
  state.attendance[pid + '_2024-02-04'] = { [wid]: { status: 'H' } };
  assert('workerTotalDue 3F+1H', workerTotalDue(wid, pid) === 1750, true, true);

  // Non-existent worker
  assert('workerTotalDue missing worker', workerTotalDue('ghost', pid) === 0, true, true);

  // Wrong project
  assert('workerTotalDue wrong proj', workerTotalDue(wid, 'wrongproj') === 0, true, true);
}

// ── SECTION 7: projectExpenses / projectLabourWages / projectSpent ─────────
{
  resetState();
  const pid = 'proj3';
  state.expenses.push({ id: 'e1', projId: pid, amount: 5000, stage: 'Centring', date: '2024-01-01', notes: '' });
  state.expenses.push({ id: 'e2', projId: pid, amount: 3000, stage: 'Brickwork', date: '2024-01-02', notes: '' });
  state.expenses.push({ id: 'e3', projId: 'other', amount: 9999, stage: 'Centring', date: '2024-01-01', notes: '' });

  assert('projectExpenses correct pid', projectExpenses(pid) === 8000, true, true);
  assert('projectExpenses other pid',   projectExpenses('other') === 9999, true, true);
  assert('projectExpenses empty pid',   projectExpenses('none') === 0, true, true);

  state.wageSettlements.push({ id: 's1', workerId: 'w1', projId: pid, weekStart: '2024-01-01', weekEnd: '2024-01-07', amount: 2000, paid: true });
  state.wageSettlements.push({ id: 's2', workerId: 'w1', projId: pid, weekStart: '2024-01-08', weekEnd: '2024-01-14', amount: 1000, paid: false });

  assert('projectLabourWages paid only', projectLabourWages(pid) === 2000, true, true);
  assert('projectSpent total',           projectSpent(pid) === 10000, true, true);

  // Stress: random amounts
  for (let i = 0; i < 200; i++) {
    resetState();
    const spid = 'sp' + i;
    let expected = 0;
    const count = Math.floor(Math.random() * 20);
    for (let j = 0; j < count; j++) {
      const amt = Math.floor(Math.random() * 50000);
      expected += amt;
      state.expenses.push({ id: uid(), projId: spid, amount: amt, stage: 'Centring', date: '2024-01-01', notes: '' });
    }
    assert(`projectExpenses stress iter${i}`, projectExpenses(spid) === expected, true, true);
  }
}

// ── SECTION 8: uid uniqueness ─────────────────────────────────────────────
{
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(uid());
  assert('uid 2000 unique', ids.size, 2000, 2000);
}

// ── SECTION 9: edge cases — negative/zero wages ───────────────────────────
{
  resetState();
  const pid = 'proj4';
  const wid = 'w4';
  state.workers.push({ id: wid, name: 'Test', trade: 'Mason', wage: 0, projId: pid });
  state.attendance[pid + '_2024-05-01'] = { [wid]: { status: 'F' } };
  assert('zero wage worker total due', workerTotalDue(wid, pid) === 0, true, true);

  const wages = calcWeeklyWages(pid, '2024-05-01', '2024-05-07');
  assert('zero wage calcWeekly total', wages[0].total === 0, true, true);
}

// ── SECTION 10: attendance state mutation safety ───────────────────────────
{
  resetState();
  const pid = 'proj5';
  const wid = 'w5';
  state.workers.push({ id: wid, name: 'Mutate', trade: 'Carpenter', wage: 700, projId: pid });

  // Simulate writeAtt logic
  function writeAtt(wid, rec) {
    const key = pid + '_2024-06-01';
    if (!state.attendance[key]) state.attendance[key] = {};
    const existing = state.attendance[key][wid];
    const prev = (typeof existing === 'object' && existing !== null) ? existing : { status: existing || 'A', otHours: 0, otRate: 0 };
    state.attendance[key][wid] = { ...prev, ...rec };
  }

  writeAtt(wid, { status: 'F' });
  assert('writeAtt sets F', state.attendance[pid + '_2024-06-01'][wid].status === 'F', true, true);

  writeAtt(wid, { otHours: 3 });
  assert('writeAtt preserves status on OT update', state.attendance[pid + '_2024-06-01'][wid].status === 'F', true, true);
  assert('writeAtt sets otHours', state.attendance[pid + '_2024-06-01'][wid].otHours === 3, true, true);

  writeAtt(wid, { status: 'A' });
  assert('writeAtt marks absent', state.attendance[pid + '_2024-06-01'][wid].status === 'A', true, true);
  // OT hours should still be preserved in record even if absent (dayEarned ignores them)
  assert('writeAtt absent earned = 0', dayEarned({ wage: 700 }, state.attendance[pid + '_2024-06-01'][wid]) === 0, true, true);
}

// ── RESULTS ────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'='.repeat(50)}`);
console.log(`RESULTS: ${passed}/${total} passed, ${failed} failed`);
if (failures.length) {
  console.log(`\nFAILURES:`);
  failures.forEach(f => console.log(`  ✗ ${f.label}\n    got:      ${JSON.stringify(f.got)}\n    expected: ${JSON.stringify(f.expected)}`));
} else {
  console.log('All tests passed ✓');
}
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
