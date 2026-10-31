/* NetLink – script.js
   All networking goes through the existing bridge.c HTTP endpoints.
   No endpoints are invented; all API paths match bridge.c exactly.
*/

'use strict';

/* ── Session ID (required by bridge.c) ───────────────────── */
const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `netlink_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

/* ── State ────────────────────────────────────────────────── */
let reportData = [];
let udpAlertsData = [];
let pendingReportPayload = null;

/* ── DOM helpers ──────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function setFeedback(el, msg, kind) {
  el.textContent = msg;
  el.className = 'form-feedback' + (kind ? ' ' + kind : '');
}

/* ── Communication log ────────────────────────────────────── */
function logEvent(protocol, direction, message, isError) {
  const log = $('communicationLog');
  const empty = log.querySelector('.log-empty');
  if (empty) empty.remove();

  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.textContent = `[${time}] ${protocol} ${direction}: ${message}`;
  li.className = isError ? 'log-error' : (protocol === 'UDP' ? 'log-udp' : 'log-tcp');
  log.prepend(li);                 // newest first
  while (log.children.length > 50) log.lastElementChild.remove();
}

/* ── HTTP helper ──────────────────────────────────────────── */
async function postJson(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, ...(payload || {}) })
  });
  let data;
  try { data = await res.json(); } catch {
    throw new Error('The C bridge returned an invalid response.');
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

/* ── Navigation ───────────────────────────────────────────── */
const SECTIONS = ['dashboard', 'report', 'udp', 'reports', 'network'];
let currentSection = 'dashboard';

function showSection(name) {
  SECTIONS.forEach(s => {
    const sec = $(`section-${s}`);
    const btn = $(`nav-${s}`);
    if (!sec || !btn) return;
    const active = s === name;
    sec.classList.toggle('hidden', !active);
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  currentSection = name;
  // Close mobile nav
  $('sidebar').classList.remove('open');
  $('mobileNavToggle').setAttribute('aria-expanded', 'false');
}

// Nav button click
SECTIONS.forEach(name => {
  const btn = $(`nav-${name}`);
  if (btn) btn.addEventListener('click', () => showSection(name));
});

// Quick action buttons
$('dashSubmitBtn').addEventListener('click', () => showSection('report'));
$('dashAlertBtn').addEventListener('click', () => showSection('udp'));

// Mobile nav toggle
$('mobileNavToggle').addEventListener('click', () => {
  const sidebar = $('sidebar');
  const open = sidebar.classList.toggle('open');
  $('mobileNavToggle').setAttribute('aria-expanded', String(open));
});

/* ── Health check ─────────────────────────────────────────── */
async function checkHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json();
    const online = res.ok && data.bridge === 'ok' && data.backend === 'online';
    setConnectionStatus(online);
    return online;
  } catch {
    setConnectionStatus(false);
    return false;
  }
}

function setConnectionStatus(online) {
  const dots = [$('statusDot'), $('sidebarDot')];
  dots.forEach(d => {
    if (!d) return;
    d.className = 'status-dot ' + (online ? 'connected' : 'disconnected');
  });
  $('statusText').textContent = online ? 'C server connected' : 'C server offline';
  $('sidebarStatusText').textContent = online ? 'Server: Online' : 'Server: Offline';
  $('networkServerStatus').textContent = online ? 'Online' : 'Offline';
  $('networkServerStatus').className = 'fact-value ' + (online ? 'online' : 'offline-text');
}

/* ── Network info (STATS) ─────────────────────────────────── */
async function refreshNetworkInfo(log) {
  try {
    const data = await postJson('/api/network-info');
    if (log) {
      logEvent('TCP', 'SEND', 'STATS → bridge → server:9090');
      logEvent('TCP', 'RECV', `activeClients=${data.activeClients}/${data.maxClients}`);
    }
    $('serverBindInfo').textContent = data.serverBindAddress || '0.0.0.0';
    $('httpPortInfo').textContent = `${data.httpPort}`;
    $('tcpPortInfo').textContent  = `${data.tcpPort}`;
    $('udpPortInfo').textContent  = `${data.udpPort}`;
    $('activeClientsInfo').textContent = `${data.activeClients} / ${data.maxClients}`;
    $('networkServerStatus').textContent = 'Online';
    setFeedback($('networkFeedback'), 'Network info received from C server over TCP.', 'success');
  } catch (err) {
    if (log) logEvent('TCP', 'ERROR', `STATS failed: ${err.message}`, true);
    $('serverBindInfo').textContent = 'Unavailable';
    $('activeClientsInfo').textContent = 'Unavailable';
    setFeedback($('networkFeedback'), `Could not load network info: ${err.message}`, 'error');
  }
}

async function runTcpTest() {
  const btn = $('tcpTestButton');
  btn.disabled = true;
  setFeedback($('networkFeedback'), 'Sending PING to C server over TCP…');
  logEvent('TCP', 'SEND', 'PING → bridge → server:9090');
  try {
    const data = await postJson('/api/tcp-test');
    logEvent('TCP', 'RECV', JSON.stringify(data));
    await refreshNetworkInfo();
    setFeedback($('networkFeedback'), `TCP test passed. Server replied: "${data.pong || data.server || 'OK'}"`, 'success');
  } catch (err) {
    logEvent('TCP', 'ERROR', `TCP PING failed: ${err.message}`, true);
    setFeedback($('networkFeedback'), `TCP test failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

$('refreshNetworkButton').addEventListener('click', () => refreshNetworkInfo(true));
$('tcpTestButton').addEventListener('click', runTcpTest);
$('clearLogButton').addEventListener('click', () => {
  $('communicationLog').innerHTML = '<li class="log-empty">No network operations logged yet.</li>';
});

/* ── Report age helper ────────────────────────────────────── */
function reportAge(ts) {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── Priority preview ─────────────────────────────────────── */
function priorityFromInputs(severity, traffic) {
  const levels = { Low: 1, Medium: 2, High: 3 };
  const score = (levels[severity] || 0) + (levels[traffic] || 0);
  if (score >= 6) return { label: 'CRITICAL', score };
  if (score >= 5) return { label: 'HIGH', score };
  if (score >= 3) return { label: 'MEDIUM', score };
  return { label: 'LOW', score };
}

function updatePriorityPreview() {
  const sev = $('severityInput').value;
  const traf = $('trafficImpactInput').value;
  const danger = $('immediateDangerInput').value === 'Yes';
  const { label } = priorityFromInputs(sev, traf);
  const colors = { LOW: '#3dcb82', MEDIUM: '#e8a23a', HIGH: '#e85b5b', CRITICAL: '#e85b5b' };
  const dangerMsg = danger ? ' · ⚠ Immediate danger reported – call emergency services; this demo does not dispatch help.' : '';
  $('priorityPreview').innerHTML =
    `Estimated priority: <strong style="color:${colors[label]}">${label}</strong> · Severity: ${sev} · Traffic: ${traf}${dangerMsg}`;
}

['severityInput', 'trafficImpactInput', 'immediateDangerInput'].forEach(id => {
  $(id).addEventListener('change', updatePriorityPreview);
});

/* ── Load reports ─────────────────────────────────────────── */
async function loadReports(log) {
  try {
    const data = await postJson('/api/reports');
    if (log) {
      logEvent('TCP', 'SEND', 'LIST → bridge → server:9090');
      logEvent('TCP', 'RECV', `Server returned ${data.reports.length} report(s).`);
    }
    reportData = data.reports || [];
    updateStats();
    renderRecentReports();
    renderAllReports();
  } catch (err) {
    if (log) logEvent('TCP', 'ERROR', `LIST failed: ${err.message}`, true);
    reportData = [];
    updateStats();
    showEmptyState($('recentReportsList'), `Could not load reports: ${err.message}`, true);
    showEmptyState($('reportsList'), `Could not load reports: ${err.message}`, true);
  }
}

/* ── Stats ────────────────────────────────────────────────── */
function updateStats() {
  const r = reportData;
  $('totalReports').textContent    = r.length;
  $('pendingReports').textContent  = r.filter(x => x.status === 'Pending').length;
  $('inProgressReports').textContent = r.filter(x => x.status === 'In Progress' || x.status === 'Under Review').length;
  $('resolvedReports').textContent = r.filter(x => x.status === 'Resolved').length;
  $('criticalReports').textContent = r.filter(x => x.priority === 'CRITICAL').length;
}

/* ── Empty state ──────────────────────────────────────────── */
function showEmptyState(container, message, isError) {
  container.innerHTML = `<div class="empty-state${isError ? ' error' : ''}">${message}</div>`;
}

/* ── Render recent reports (dashboard) ───────────────────── */
function renderRecentReports() {
  const container = $('recentReportsList');
  container.innerHTML = '';
  const recent = [...reportData]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, 5);
  if (!recent.length) {
    showEmptyState(container, 'No reports yet. Submit one via the TCP Report section.');
    return;
  }
  recent.forEach(r => container.append(makeReportCard(r, true)));
}

/* ── Render all reports ───────────────────────────────────── */
function renderAllReports() {
  const container = $('reportsList');
  const search  = $('searchReports').value.trim().toLowerCase();
  const priority = $('priorityFilter').value;
  const status  = $('statusFilter').value;
  const oldest  = $('sortReports').value === 'oldest';

  const filtered = reportData
    .filter(r => {
      const txt = !search ||
        r.id.toLowerCase().includes(search) ||
        r.road.toLowerCase().includes(search) ||
        r.locality.toLowerCase().includes(search);
      return txt &&
        (priority === 'all' || r.priority === priority) &&
        (status === 'all' || r.status === status);
    })
    .sort((a, b) => oldest ? a.submittedAt - b.submittedAt : b.submittedAt - a.submittedAt);

  container.innerHTML = '';
  if (!filtered.length) {
    showEmptyState(container, reportData.length
      ? 'No reports match your search / filters.'
      : 'No reports yet. Submit one using the TCP Report form.');
    return;
  }
  filtered.forEach(r => container.append(makeReportCard(r, false)));
}

/* ── Report card ──────────────────────────────────────────── */
function makeReportCard(r, compact) {
  const card = document.createElement('div');
  card.className = 'report-card';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'report-card-header';

  const idTag = document.createElement('span');
  idTag.className = 'report-id-tag';
  idTag.textContent = r.id;

  const pri = document.createElement('span');
  pri.className = `priority-pill ${r.priority}`;
  pri.textContent = r.priority;

  const st = document.createElement('span');
  st.className = `status-pill ${(r.status || '').replace(/\s+/g, '-')}`;
  st.textContent = r.status;

  hdr.append(idTag, pri, st);

  // Location
  const title = document.createElement('h3');
  title.textContent = `${r.road} · ${r.locality}`;

  // Description
  const desc = document.createElement('p');
  desc.className = 'report-card-desc';
  desc.textContent = r.description;

  card.append(hdr, title, desc);

  if (!compact) {
    // Detail row
    const meta = document.createElement('p');
    meta.className = 'report-card-meta';
    const coords = (r.latitude && r.longitude) ? `${r.latitude}, ${r.longitude}` : 'No coordinates';
    meta.textContent = `${r.severity} severity · ${r.traffic} traffic · ${r.immediateDanger ? 'Danger reported' : 'No immediate danger'} · ${coords}`;

    if (r.explanation) {
      const exp = document.createElement('p');
      exp.className = 'report-explanation';
      exp.textContent = r.explanation;
      card.append(exp);
    }
    if (r.suggestion) {
      const sug = document.createElement('p');
      sug.className = 'report-suggestion';
      sug.textContent = `Suggestion: ${r.suggestion}`;
      card.append(sug);
    }
    card.append(meta);
  }

  // Footer
  const foot = document.createElement('div');
  foot.className = 'report-card-footer';

  const age = document.createElement('span');
  age.className = 'report-age-label';
  age.dataset.ts = r.submittedAt;
  age.textContent = `${reportAge(r.submittedAt)} · ${new Date(r.submittedAt * 1000).toLocaleString()}`;

  const sel = document.createElement('select');
  sel.className = 'status-select';
  sel.setAttribute('aria-label', `Update status for ${r.id}`);
  ['Pending', 'Under Review', 'In Progress', 'Resolved'].forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === r.status) opt.selected = true;
    sel.append(opt);
  });
  sel.addEventListener('change', () => updateReportStatus(sel, r.id));

  foot.append(age, sel);

  if (!compact) {
    const detBtn = document.createElement('button');
    detBtn.className = 'detail-btn';
    detBtn.type = 'button';
    detBtn.textContent = 'Fetch details (TCP)';
    detBtn.addEventListener('click', () => fetchReportDetail(r.id));
    foot.append(detBtn);
  }

  card.append(foot);
  return card;
}

/* ── Fetch report detail ──────────────────────────────────── */
async function fetchReportDetail(id) {
  logEvent('TCP', 'SEND', `DETAIL|${id} → bridge → server:9090`);
  setFeedback($('detailFeedback'), `Fetching ${id} over TCP…`);
  try {
    const data = await postJson('/api/report-detail', { id });
    const r = data.report;
    logEvent('TCP', 'RECV', `Detail for ${r.id} returned.`);
    const coords = (r.latitude && r.longitude) ? `${r.latitude}, ${r.longitude}` : 'No coordinates';
    setFeedback($('detailFeedback'),
      `${r.id}: ${r.road}, ${r.locality} · ${r.severity} severity · ${r.traffic} traffic · ${coords} · Priority: ${r.priority} · Status: ${r.status}`,
      'success');
  } catch (err) {
    logEvent('TCP', 'ERROR', `DETAIL ${id} failed: ${err.message}`, true);
    setFeedback($('detailFeedback'), `Could not fetch details: ${err.message}`, 'error');
  }
}

/* ── Update report status ─────────────────────────────────── */
async function updateReportStatus(sel, id) {
  sel.disabled = true;
  const newStatus = sel.value;
  logEvent('TCP', 'SEND', `STATUS|${id}|${newStatus} → bridge → server:9090`);
  setFeedback($('statusFeedback'), `Updating ${id} status over TCP…`);
  try {
    const data = await postJson('/api/report-status', { id, status: newStatus });
    logEvent('TCP', 'RECV', `Server saved ${data.report.id} as ${data.report.status}.`);
    setFeedback($('statusFeedback'), `Status updated to "${data.report.status}".`, 'success');
    await loadReports();
  } catch (err) {
    logEvent('TCP', 'ERROR', `STATUS update failed: ${err.message}`, true);
    setFeedback($('statusFeedback'), `Status update failed: ${err.message}`, 'error');
    await loadReports();
  }
}

/* ── Filters for All Reports ──────────────────────────────── */
['searchReports', 'priorityFilter', 'statusFilter', 'sortReports'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener(id === 'searchReports' ? 'input' : 'change', () => renderAllReports());
});

$('refreshButton').addEventListener('click', () => loadReports(true));

/* ── Submit report form ───────────────────────────────────── */
function readReportForm() {
  const road = $('roadInput').value.trim();
  const locality = $('localityInput').value.trim();
  const lat = $('latitudeInput').value.trim();
  const lon = $('longitudeInput').value.trim();
  const desc = $('descriptionInput').value.trim();
  const severity = $('severityInput').value;
  const traffic = $('trafficImpactInput').value;
  const immediateDanger = $('immediateDangerInput').value;

  if (!road) throw new Error('Road name is required.');
  if (!locality) throw new Error('Locality is required.');
  if (!desc) throw new Error('Description is required.');
  if (Boolean(lat) !== Boolean(lon)) throw new Error('Enter both latitude and longitude, or leave both blank.');
  if (lat && (isNaN(Number(lat)) || Number(lat) < -90 || Number(lat) > 90))
    throw new Error('Latitude must be between -90 and 90.');
  if (lon && (isNaN(Number(lon)) || Number(lon) < -180 || Number(lon) > 180))
    throw new Error('Longitude must be between -180 and 180.');

  return { road, locality, latitude: lat, longitude: lon, severity, traffic, immediateDanger, description: desc };
}

async function submitReport(payload) {
  $('submitButton').disabled = true;
  setFeedback($('reportFeedback'), 'Sending report to C server over TCP…');
  logEvent('TCP', 'SEND', `REPORT|${payload.severity}|${payload.traffic}|${payload.road}|${payload.locality}`);
  try {
    const data = await postJson('/api/report', payload);
    logEvent('TCP', 'RECV', `Server assigned ${data.report.id} · priority ${data.report.priority}.`);
    setFeedback($('reportFeedback'), `✓ Report ${data.report.id} submitted. Priority: ${data.report.priority}.`, 'success');
    $('reportForm').reset();
    updatePriorityPreview();
    $('duplicateWarning').hidden = true;
    await loadReports();
  } catch (err) {
    logEvent('TCP', 'ERROR', `REPORT submission failed: ${err.message}`, true);
    setFeedback($('reportFeedback'), err.message, 'error');
  } finally {
    $('submitButton').disabled = false;
  }
}

$('reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  let payload;
  try {
    payload = readReportForm();
  } catch (err) {
    setFeedback($('reportFeedback'), err.message, 'error');
    return;
  }

  $('submitButton').disabled = true;
  try {
    logEvent('TCP', 'SEND', `CHECK|${payload.road}|${payload.locality} → duplicate check`);
    const ck = await postJson('/api/duplicate-check', { road: payload.road, locality: payload.locality });
    logEvent('TCP', 'RECV', `Duplicate check: ${ck.matches.length} match(es).`);
    if (ck.duplicate) {
      pendingReportPayload = payload;
      $('duplicateMessage').textContent = ck.matches.map(m => `${m.id} (${m.road}, ${m.locality})`).join('; ');
      $('duplicateWarning').hidden = false;
      setFeedback($('reportFeedback'), 'A possible similar report exists. Check below.');
      $('submitButton').disabled = false;
    } else {
      await submitReport(payload);
    }
  } catch {
    await submitReport(payload);
  }
});

$('continueDuplicate').addEventListener('click', async () => {
  const payload = pendingReportPayload;
  pendingReportPayload = null;
  $('duplicateWarning').hidden = true;
  if (payload) await submitReport(payload);
});

$('cancelDuplicate').addEventListener('click', () => {
  pendingReportPayload = null;
  $('duplicateWarning').hidden = true;
  setFeedback($('reportFeedback'), 'Submission cancelled.');
});

/* ── UDP alerts ───────────────────────────────────────────── */
$('udpButton').addEventListener('click', async () => {
  const road = $('udpRoadInput').value.trim();
  const locality = $('udpLocalityInput').value.trim();
  if (!road || !locality) {
    setFeedback($('udpFeedback'), 'Road and locality are required.', 'error');
    return;
  }
  const severity = $('udpSeverityInput').value;
  const traffic = $('udpTrafficInput').value;
  const immediateDanger = $('udpImmediateDangerInput').value;

  $('udpButton').disabled = true;
  setFeedback($('udpFeedback'), 'Sending UDP datagram…');
  const datagram = `ALERT_V2|${severity}|${traffic}|${immediateDanger}|${road}|${locality}`;
  logEvent('UDP', 'SEND', `to server:9091 · ${datagram}`);

  try {
    await postJson('/api/udp-alert', { road, locality, severity, traffic, immediateDanger });
    logEvent('UDP', 'RESULT', 'sendto() returned success – delivery to server is NOT confirmed.');
    setFeedback($('udpFeedback'), '⚡ Datagram sent via sendto(). Delivery is unconfirmed – UDP is connectionless.', 'success');
    await loadUdpAlerts(true);
  } catch (err) {
    logEvent('UDP', 'ERROR', err.message, true);
    setFeedback($('udpFeedback'), err.message, 'error');
  } finally {
    $('udpButton').disabled = false;
  }
});

$('refreshUdpButton').addEventListener('click', () => loadUdpAlerts(true));

/* ── Load UDP alerts ──────────────────────────────────────── */
async function loadUdpAlerts(log) {
  try {
    const data = await postJson('/api/udp-alerts');
    if (log) {
      logEvent('TCP', 'SEND', 'ALERTS → bridge → server:9090 (list UDP alerts stored by server)');
      logEvent('TCP', 'RECV', `Server has ${data.alerts.length} UDP alert(s).`);
    }
    udpAlertsData = data.alerts || [];
    renderUdpAlerts();
  } catch (err) {
    if (log) logEvent('TCP', 'ERROR', `ALERTS query failed: ${err.message}`, true);
    udpAlertsData = [];
    showEmptyState($('udpAlertsList'), `Could not load UDP alerts: ${err.message}`, true);
  }
}

function renderUdpAlerts() {
  const container = $('udpAlertsList');
  const search = $('searchUdpAlerts').value.trim().toLowerCase();
  const status = $('udpStatusFilter').value;

  const filtered = udpAlertsData.filter(a => {
    const txt = !search || a.id.toLowerCase().includes(search) ||
      a.road.toLowerCase().includes(search) || a.locality.toLowerCase().includes(search);
    return txt && (status === 'all' || a.status === status);
  });

  container.innerHTML = '';
  if (!filtered.length) {
    showEmptyState(container, udpAlertsData.length
      ? 'No alerts match your filter.'
      : 'No UDP alerts received during this server run. Send one above.');
    return;
  }
  filtered.forEach(a => container.append(makeUdpCard(a)));
}

function makeUdpCard(a) {
  const card = document.createElement('div');
  card.className = 'udp-alert-card';

  const hdr = document.createElement('div');
  hdr.className = 'udp-alert-header';

  const idEl = document.createElement('span');
  idEl.className = 'udp-alert-id';
  idEl.textContent = a.id;

  const badge = document.createElement('span');
  badge.className = `udp-status-badge ${(a.status || 'Pending').replace(/\s+/g, '-')}`;
  badge.textContent = a.status || 'Pending';

  hdr.append(idEl, badge);

  const loc = document.createElement('div');
  loc.className = 'udp-alert-location';
  loc.textContent = `${a.road} · ${a.locality}`;

  const detail = document.createElement('div');
  detail.className = 'udp-alert-detail';
  detail.textContent = `${a.severity} severity · ${a.traffic} traffic · ${a.immediateDanger ? 'Danger reported' : 'No immediate danger'}`;

  const foot = document.createElement('div');
  foot.className = 'udp-alert-footer';

  const time = document.createElement('span');
  time.className = 'report-age-label';
  time.textContent = new Date(a.receivedAt * 1000).toLocaleTimeString();

  const sel = document.createElement('select');
  sel.className = 'status-select';
  sel.setAttribute('aria-label', `Update status for UDP alert ${a.id}`);
  ['Pending', 'Under Review', 'In Progress', 'Resolved'].forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === a.status) opt.selected = true;
    sel.append(opt);
  });
  sel.addEventListener('change', () => updateUdpStatus(sel, a.id));

  foot.append(time, sel);
  card.append(hdr, loc, detail, foot);
  return card;
}

/* ── Update UDP status ────────────────────────────────────── */
async function updateUdpStatus(sel, id) {
  sel.disabled = true;
  const newStatus = sel.value;
  setFeedback($('udpStatusFeedback'), `Sending UDP status update for ${id}…`);
  logEvent('UDP', 'SEND', `ALERT_STATUS|${id}|${newStatus} → server:9091 (via bridge)`);
  try {
    const data = await postJson('/api/udp-status', { id, status: newStatus });
    logEvent('UDP', 'RECV', `ACK received – alert ${data.id} is now ${data.status}.`);
    setFeedback($('udpStatusFeedback'), `Server acknowledged: ${data.id} → ${data.status}`, 'success');
    await loadUdpAlerts();
  } catch (err) {
    logEvent('UDP', 'ERROR', `UDP status update failed for ${id}: ${err.message}`, true);
    setFeedback($('udpStatusFeedback'), `UDP status failed: ${err.message}`, 'error');
    await loadUdpAlerts();
  }
}

$('searchUdpAlerts').addEventListener('input', renderUdpAlerts);
$('udpStatusFilter').addEventListener('change', renderUdpAlerts);

/* ── Refresh age labels ───────────────────────────────────── */
function refreshAgeLabels() {
  document.querySelectorAll('[data-ts]').forEach(el => {
    const ts = Number(el.dataset.ts);
    if (ts) el.textContent = `${reportAge(ts)} · ${new Date(ts * 1000).toLocaleString()}`;
  });
}

/* ── Initial load ─────────────────────────────────────────── */
updatePriorityPreview();
checkHealth();
refreshNetworkInfo();
loadReports();
loadUdpAlerts();

/* ── Polling intervals ────────────────────────────────────── */
setInterval(checkHealth, 5000);
setInterval(() => { loadReports(); loadUdpAlerts(); }, 8000);
setInterval(refreshAgeLabels, 60000);
