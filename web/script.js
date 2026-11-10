/* NetLink – script.js
   All networking goes through the existing bridge.c HTTP endpoints.
   No endpoints are invented; all API paths match bridge.c exactly.
   AI image recognition uses TensorFlow.js + Teachable Machine image library.
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
let aiRejectConfirmed = false;

/* ── Image / AI state ─────────────────────────────────────── */
let potholeModel = null;         // Cached tf.loadLayersModel instance
let modelLoadingPromise = null;  // In-flight loading promise to avoid duplicate loads
let activeInferenceId = 0;       // Sequence token to prevent stale inferences overwriting newer ones
let currentImageFile = null;     // File object selected by user
let currentImageRef  = null;     // imageRef returned by /api/upload-image
let currentAiResult  = null;     // { label, confidence, detected, pct }

/* ── GPS Location & Reverse Geocoding state ───────────────── */
let currentGpsData = null;        // { lat, lon, accuracy, timestamp }
let detectedAddress = null;       // { road, locality, displayName, fullAddress }
let isDetectingLocation = false;  // Guard against concurrent GPS requests
let leafletMapInstance = null;    // Leaflet map instance
let leafletMarkerInstance = null; // Leaflet marker instance
let userHasEditedRoad = false;    // Track if user manually modified road
let userHasEditedLocality = false;// Track if user manually modified locality

/* ── MODEL PATH — served from web/model/ via bridge ─────── */
const MODEL_URL   = '/model/model.json';
// METADATA_URL unused - model uses tf.loadLayersModel(MODEL_URL) directly

/* ════════════════════════════════════════════════════════════
   AI / TENSORFLOW.JS — Teachable Machine image classifier
   ════════════════════════════════════════════════════════════*/

async function loadPotholeModel() {
  if (potholeModel) return potholeModel;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    try {
      const probe = await fetch(MODEL_URL, { cache: 'no-store' });
      if (!probe.ok) throw new Error('model.json not found at ' + MODEL_URL);
      if (typeof tf === 'undefined') throw new Error('TensorFlow.js not loaded');

      potholeModel = await tf.loadLayersModel(MODEL_URL);
      console.log('[NetLink AI] Model loaded via tf.loadLayersModel');
      return potholeModel;
    } catch (err) {
      console.warn('[NetLink AI] Model not available:', err.message);
      potholeModel = null;
      return null;
    } finally {
      modelLoadingPromise = null;
    }
  })();

  return modelLoadingPromise;
}

/* Run inference on imgElement.
   Returns { label, confidence, detected } or throws.
   Model: Deep CNN binary sigmoid classifier (224x224 RGB input)
     sigmoid output >= 0.5 => Pothole Detected
     sigmoid output <  0.5 => No Pothole Detected
   The confidence percentage represents the model's actual pothole-class probability.
*/
async function runInference(imgElement) {
  const model = await loadPotholeModel();
  if (!model) throw new Error('MODEL_UNAVAILABLE');

  return tf.tidy(() => {
    // Preprocess: resize to 224x224, normalise to [0,1], add batch dim
    const tensor = tf.browser.fromPixels(imgElement)
      .resizeBilinear([224, 224])
      .div(255.0)
      .expandDims(0);                   // shape [1, 224, 224, 3]

    const output = model.predict(tensor);  // shape [1, 1] sigmoid
    const scoreArr = output.dataSync();    // synchronous read inside tidy
    const score = scoreArr[0];             // raw sigmoid output: [0.0 .. 1.0]

    const detected   = score >= 0.5;
    const confidence = score;              // actual pothole-class probability
    const label      = detected ? 'Pothole Detected' : 'No Pothole Detected';

    return { label, confidence, detected };
  });
}

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
  log.prepend(li);
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
  $('sidebar').classList.remove('open');
  $('mobileNavToggle').setAttribute('aria-expanded', 'false');
}

SECTIONS.forEach(name => {
  const btn = $(`nav-${name}`);
  if (btn) btn.addEventListener('click', () => showSection(name));
});

$('dashSubmitBtn').addEventListener('click', () => showSection('report'));
$('dashAlertBtn').addEventListener('click', () => showSection('udp'));

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
  const dangerMsg = danger ? ' · ⚠️ Immediate danger reported – call emergency services; this demo does not dispatch help.' : '';
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

  // If image available and not compact, show thumb in a flex row
  const hasImage = r.imageRef && r.imageRef !== 'null';
  let bodyEl;
  if (hasImage && !compact) {
    card.classList.add('report-card-with-thumb');
    const thumb = document.createElement('img');
    thumb.className = 'report-thumb';
    thumb.src = `/uploads/${r.imageRef}`;
    thumb.alt = 'Report photo';
    thumb.onerror = () => thumb.style.display = 'none';
    card.append(thumb);
    bodyEl = document.createElement('div');
    bodyEl.className = 'report-card-body';
    card.append(bodyEl);
  } else {
    bodyEl = card;
  }

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

  const title = document.createElement('h3');
  title.textContent = `${r.road} · ${r.locality}`;

  const desc = document.createElement('p');
  desc.className = 'report-card-desc';
  desc.textContent = r.description;

  bodyEl.append(hdr, title, desc);

  if (!compact) {
    const meta = document.createElement('p');
    meta.className = 'report-card-meta';
    const hasCoords = (r.latitude != null && r.longitude != null);
    let coordsText = 'No coordinates';
    if (hasCoords) {
      const latFmt = Number(r.latitude).toFixed(6);
      const lonFmt = Number(r.longitude).toFixed(6);
      const accText = (r.accuracy != null) ? ` (±${Math.round(r.accuracy)}m)` : '';
      coordsText = `📍 ${latFmt}, ${lonFmt}${accText}`;
    }
    meta.textContent = `${r.severity} severity · ${r.traffic} traffic · ${r.immediateDanger ? 'Danger reported' : 'No immediate danger'} · ${coordsText}`;

    if (r.explanation) {
      const exp = document.createElement('p');
      exp.className = 'report-explanation';
      exp.textContent = r.explanation;
      bodyEl.append(exp);
    }
    if (r.suggestion) {
      const sug = document.createElement('p');
      sug.className = 'report-suggestion';
      sug.textContent = `Suggestion: ${r.suggestion}`;
      bodyEl.append(sug);
    }
    bodyEl.append(meta);

    if (hasCoords) {
      const mapLink = document.createElement('a');
      mapLink.className = 'map-link';
      mapLink.href = `https://www.google.com/maps?q=${r.latitude},${r.longitude}`;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.textContent = '🗺️ View on Google Maps ↗';
      bodyEl.append(mapLink);
    }
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
    detBtn.addEventListener('click', () => fetchReportDetail(r.id, r.imageRef));
    foot.append(detBtn);
  }

  bodyEl.append(foot);
  return card;
}

/* ── Fetch report detail ──────────────────────────────────── */
async function fetchReportDetail(id, imageRef) {
  logEvent('TCP', 'SEND', `DETAIL|${id} → bridge → server:9090`);
  setFeedback($('detailFeedback'), `Fetching ${id} over TCP…`);
  try {
    const data = await postJson('/api/report-detail', { id });
    const r = data.report;
    logEvent('TCP', 'RECV', `Detail for ${r.id} returned.`);
    const hasCoords = (r.latitude != null && r.longitude != null);
    const accFmt = (r.accuracy != null) ? ` (±${Math.round(r.accuracy)}m)` : '';
    const coords = hasCoords
      ? `${Number(r.latitude).toFixed(6)}, ${Number(r.longitude).toFixed(6)}${accFmt}`
      : 'No coordinates';

    // Build rich detail output
    let detailHtml = '';
    const ref = r.imageRef || imageRef;
    if (ref && ref !== 'null') {
      detailHtml += `<img class="detail-img-full" src="/uploads/${ref}" alt="Report photo">`;
    }
    detailHtml += `<strong>${r.id}</strong>: ${r.road}, ${r.locality} · ${r.severity} severity · ${r.traffic} traffic · ${coords} · Priority: ${r.priority} · Status: ${r.status}`;
    if (hasCoords) {
      detailHtml += `<br><a class="map-link" href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank" rel="noopener noreferrer">🗺️ View on Google Maps ↗</a>`;
    }
    if (r.explanation) detailHtml += `<br><em>${r.explanation}</em>`;
    if (r.suggestion)  detailHtml += `<br>💡 ${r.suggestion}`;

    const fb = $('detailFeedback');
    fb.innerHTML = detailHtml;
    fb.className = 'form-feedback success';
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

/* ════════════════════════════════════════════════════════════
   IMAGE UPLOAD & AI RECOGNITION
   ════════════════════════════════════════════════════════════*/

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resetImageState() {
  currentImageFile = null;
  currentImageRef  = null;
  currentAiResult  = null;
  aiRejectConfirmed = false;
  activeInferenceId++; // Invalidate any running inference

  $('imgPreviewWrap').hidden = true;
  $('aiResultPanel').hidden  = true;
  $('imgUploadStatus').hidden = true;
  $('aiRejectWarning').hidden = true;
  $('imgDropZone').style.display = '';
  $('imgFileInput').value = '';
}

function showAiLoading() {
  const panel = $('aiResultPanel');
  panel.hidden = false;
  $('aiLoading').hidden  = false;
  $('aiOutcome').hidden  = true;
  $('aiError').hidden    = true;
}

function hideAiLoading() {
  $('aiLoading').hidden = true;
}

function showAiOutcome(result) {
  hideAiLoading();
  $('aiError').hidden   = true;
  $('aiOutcome').hidden = false;

  const { confidence, detected } = result;
  // Format confidence as exact percentage with 2 decimal places
  const pctFormatted = (confidence * 100).toFixed(2);
  const pctNum = Math.min(100, Math.max(0, confidence * 100));

  if (detected) {
    $('aiOutcomeIcon').textContent  = '🔴';
    $('aiOutcomeLabel').textContent = 'Pothole Detected';
    $('aiOutcomeLabel').className   = 'ai-outcome-label detected';
    $('aiConfidenceFill').className = 'ai-confidence-bar-fill high';
  } else {
    $('aiOutcomeIcon').textContent  = '🟢';
    $('aiOutcomeLabel').textContent = 'No Pothole Detected';
    $('aiOutcomeLabel').className   = 'ai-outcome-label not-detected';
    $('aiConfidenceFill').className = 'ai-confidence-bar-fill low';
  }

  $('aiConfidencePct').textContent = `${pctFormatted}%`;
  $('aiConfidenceFill').style.width = `${pctNum}%`;

  currentAiResult = {
    confidence,
    detected,
    pct: pctFormatted,
    label: detected ? 'Pothole' : 'No Pothole'
  };
}

function showAiError(msg) {
  hideAiLoading();
  $('aiOutcome').hidden = true;
  $('aiError').hidden   = false;
  $('aiError').textContent = msg;
}

/* Convert File to base64 string */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/* Upload image to bridge /api/upload-image → returns imageRef */
async function uploadImageToServer(file, b64DataUrl) {
  setUploadStatus('Uploading image to server…');
  const mimeType = file.type || 'image/jpeg';
  const b64 = b64DataUrl.split(',')[1] || b64DataUrl;

  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, mimeType, imageData: b64 })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed');
  setUploadStatus(`✓ Saved as ${data.imageRef}`);
  return data.imageRef;
}

function setUploadStatus(msg) {
  $('imgUploadStatus').hidden = false;
  $('imgUploadStatusText').textContent = msg;
}

/* Handle a new file being selected (from drop or click) */
async function handleFileSelected(file) {
  const MAX = 5 * 1024 * 1024;
  if (!file) return;

  // Clear previous prediction and state immediately
  resetImageState();

  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
    setFeedback($('reportFeedback'), 'Only JPG, PNG and WEBP images are accepted.', 'error');
    return;
  }
  if (file.size > MAX) {
    setFeedback($('reportFeedback'), `Image too large (${formatBytes(file.size)}). Maximum is 5 MB.`, 'error');
    return;
  }

  const thisInferenceId = ++activeInferenceId;
  currentImageFile = file;

  // Read preview
  let b64DataUrl;
  try {
    b64DataUrl = await fileToBase64(file);
  } catch (err) {
    setFeedback($('reportFeedback'), 'Failed to read selected image file.', 'error');
    return;
  }

  if (thisInferenceId !== activeInferenceId) return;

  const imgEl = $('imgPreview');
  imgEl.src = b64DataUrl;
  $('imgFileName').textContent = file.name;
  $('imgFileSize').textContent = formatBytes(file.size);
  $('imgDropZone').style.display = 'none';
  $('imgPreviewWrap').hidden = false;
  $('aiResultPanel').hidden  = false;

  // Wait for image decoding before running inference to prevent hangs or empty tensors
  if (imgEl.decode) {
    try { await imgEl.decode(); } catch {}
  }

  if (thisInferenceId !== activeInferenceId) return;

  // Run AI inference (client-side)
  showAiLoading();
  try {
    const model = await loadPotholeModel();
    if (thisInferenceId !== activeInferenceId) return;

    if (model) {
      const result = await runInference(imgEl);
      if (thisInferenceId !== activeInferenceId) return;
      showAiOutcome(result);
    } else {
      showAiError('⚠️ AI model not loaded. Place model files in web/model/ — see web/model/README.md.');
    }
  } catch (err) {
    if (thisInferenceId !== activeInferenceId) return;
    if (err.message === 'MODEL_UNAVAILABLE') {
      showAiError('⚠️ AI model not loaded. Place model files in web/model/ — see web/model/README.md.');
    } else {
      showAiError(`Inference error: ${err.message}`);
    }
  } finally {
    // Guarantees loading state is ALWAYS removed immediately when inference finishes or errors
    if (thisInferenceId === activeInferenceId) {
      hideAiLoading();
    }
  }

  // Upload image to server in background
  try {
    const imageRef = await uploadImageToServer(file, b64DataUrl);
    if (thisInferenceId === activeInferenceId) {
      currentImageRef = imageRef;
      logEvent('TCP', 'SEND', `POST /api/upload-image → bridge saved ${currentImageRef}`);
    }
  } catch (err) {
    if (thisInferenceId === activeInferenceId) {
      setUploadStatus(`⚠️ Upload failed: ${err.message}. Report will be submitted without image.`);
      currentImageRef = null;
    }
  }
}

/* ── Drop zone event wiring ─────────────────────────────────────── */
const dropZone = $('imgDropZone');
const fileInput = $('imgFileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
});

$('imgRemoveBtn').addEventListener('click', () => {
  resetImageState();
  setFeedback($('reportFeedback'), '');
});

/* Warm up the model when the report section is opened */
document.querySelector('[data-section="report"]').addEventListener('click', () => {
  if (!modelLoadAttempted) loadPotholeModel();
});

/* ════════════════════════════════════════════════════════════
   AUTOMATIC GPS LOCATION TRACKER & REVERSE GEOCODING
   ════════════════════════════════════════════════════════════ */

function setLocationStatus(text, statusType = 'ready') {
  const bar = $('locationStatusBar');
  const dot = $('locationStatusDot');
  const textEl = $('locationStatusText');
  const badge = $('gpsBadge');
  if (!bar || !dot || !textEl) return;

  textEl.textContent = text;
  dot.className = `location-status-dot ${statusType}`;

  if (badge) {
    if (statusType === 'success') {
      badge.textContent = 'GPS Active';
      badge.className = 'location-tracker-badge active';
    } else if (statusType === 'loading') {
      badge.textContent = 'Locating…';
      badge.className = 'location-tracker-badge';
    } else {
      badge.textContent = 'GPS Ready';
      badge.className = 'location-tracker-badge';
    }
  }
}

function resetLocationTrackerState() {
  if ($('gpsLatDisplay')) $('gpsLatDisplay').textContent = '—';
  if ($('gpsLonDisplay')) $('gpsLonDisplay').textContent = '—';
  if ($('gpsAccuracyDisplay')) $('gpsAccuracyDisplay').textContent = '—';
  if ($('accuracyInput')) $('accuracyInput').value = '';
  if ($('geoSuggestionBanner')) $('geoSuggestionBanner').hidden = true;
  if ($('mapPreview')) $('mapPreview').hidden = true;
  if ($('btnRefreshGps')) $('btnRefreshGps').style.display = 'none';
  setLocationStatus('Click "Detect My Location" to obtain GPS coordinates and auto-identify road & locality.', 'ready');
  currentGpsData = null;
  detectedAddress = null;
  userHasEditedRoad = false;
  userHasEditedLocality = false;
}

/* Reverse geocode coordinates using OpenStreetMap Nominatim.
   Extracts road name and locality according to strict priority order.
   Does NOT fabricate names or place city names into Road Name.
*/
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
  const data = await res.json();
  const addr = data.address || {};

  // Extract Road Name (strict priority order, never city/district)
  const road = (
    addr.road ||
    addr.pedestrian ||
    addr.residential ||
    addr.highway ||
    addr.footway ||
    addr.path ||
    addr.cycleway ||
    ''
  ).trim();

  // Extract Locality (strict priority order)
  const locality = (
    addr.suburb ||
    addr.neighbourhood ||
    addr.quarter ||
    addr.locality ||
    addr.village ||
    addr.town ||
    addr.city_district ||
    addr.district ||
    addr.city ||
    addr.municipality ||
    ''
  ).trim();

  return {
    road,
    locality,
    displayName: data.display_name || '',
    fullAddress: addr
  };
}

function applyDetectedAddressToForm(geo, accuracy) {
  const roadEl = $('roadInput');
  const localityEl = $('localityInput');
  const accMeters = Math.round(accuracy);
  const roadVal = roadEl.value.trim();
  const locVal = localityEl.value.trim();

  const roadUntouched = !userHasEditedRoad || !roadVal;
  const locUntouched = !userHasEditedLocality || !locVal;

  if (roadUntouched && locUntouched) {
    if (geo.road) roadEl.value = geo.road;
    if (geo.locality) localityEl.value = geo.locality;
    $('geoSuggestionBanner').hidden = true;
    setLocationStatus(`✓ Location detected successfully: ${geo.road || 'Road'}${geo.locality ? ', ' + geo.locality : ''} (accuracy: ±${accMeters}m)`, 'success');
  } else {
    // User already entered custom road or locality: preserve edits and suggest
    $('geoSuggestionText').textContent = `Detected: "${geo.road || 'Unknown Road'}${geo.locality ? ', ' + geo.locality : ''}".`;
    $('geoSuggestionBanner').hidden = false;
    setLocationStatus(`Coordinates updated (±${accMeters}m). Address suggestion ready.`, 'success');
  }
}

function updateMapPreview(lat, lon, road, locality, accuracy) {
  if (typeof L === 'undefined') return;
  const mapEl = $('mapPreview');
  if (!mapEl) return;
  mapEl.hidden = false;

  const title = road || 'Detected Location';
  const subtitle = locality ? `<br><small>${locality}</small>` : '';
  const popupHtml = `<strong>${title}</strong>${subtitle}<br><span style="font-size:11px;color:#8899ac;">${lat.toFixed(6)}, ${lon.toFixed(6)} (±${Math.round(accuracy)}m)</span>`;

  if (!leafletMapInstance) {
    leafletMapInstance = L.map('mapPreview', {
      zoomControl: true,
      attributionControl: true
    }).setView([lat, lon], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
    }).addTo(leafletMapInstance);

    leafletMarkerInstance = L.marker([lat, lon]).addTo(leafletMapInstance);
  } else {
    leafletMapInstance.setView([lat, lon], 16);
    leafletMarkerInstance.setLatLng([lat, lon]);
  }

  leafletMarkerInstance.bindPopup(popupHtml).openPopup();
  setTimeout(() => {
    if (leafletMapInstance) leafletMapInstance.invalidateSize();
  }, 250);
}

async function detectCurrentLocation(forUdp = false) {
  if (isDetectingLocation) return;

  // 1. Check support & secure context
  if (!navigator.geolocation) {
    const msg = 'Geolocation is not supported by your browser.';
    if (forUdp) setFeedback($('udpFeedback'), msg, 'error');
    else setLocationStatus(msg, 'error');
    return;
  }

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!window.isSecureContext && !isLocal) {
    const msg = '⚠️ Insecure Context: Mobile browsers block GPS over HTTP LAN IPs. Access via localhost, HTTPS, or Chrome USB port forwarding (chrome://inspect).';
    if (forUdp) setFeedback($('udpFeedback'), msg, 'error');
    else setLocationStatus(msg, 'error');
    return;
  }

  isDetectingLocation = true;
  const btn = $('btnDetectGps');
  if (btn && !forUdp) btn.disabled = true;

  if (forUdp) {
    setFeedback($('udpFeedback'), 'Requesting GPS location from browser…');
  } else {
    setLocationStatus('Waiting for location permission from browser…', 'loading');
  }

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Coordinates out of range.');
    }

    currentGpsData = { lat, lon, accuracy, timestamp: pos.timestamp };

    const accMeters = Math.round(accuracy);
    const accTier = accuracy <= 15 ? 'High' : (accuracy <= 50 ? 'Moderate' : 'Low');
    const accDisplay = `±${accMeters} m (${accTier})`;

    if ($('gpsLatDisplay')) $('gpsLatDisplay').textContent = lat.toFixed(6);
    if ($('gpsLonDisplay')) $('gpsLonDisplay').textContent = lon.toFixed(6);
    if ($('gpsAccuracyDisplay')) $('gpsAccuracyDisplay').textContent = accDisplay;

    // Populate form inputs
    if ($('latitudeInput')) $('latitudeInput').value = lat.toFixed(6);
    if ($('longitudeInput')) $('longitudeInput').value = lon.toFixed(6);
    if ($('accuracyInput')) $('accuracyInput').value = accuracy.toFixed(2);

    if ($('btnRefreshGps')) $('btnRefreshGps').style.display = 'inline-flex';

    if (forUdp) {
      setFeedback($('udpFeedback'), `GPS acquired (±${accMeters}m). Fetching road name from OpenStreetMap…`);
    } else {
      setLocationStatus(`GPS acquired (±${accMeters}m). Fetching road & locality from OpenStreetMap…`, 'loading');
    }

    // 2. Reverse Geocoding
    let geo = null;
    try {
      geo = await reverseGeocode(lat, lon);
      detectedAddress = geo;
    } catch (geoErr) {
      console.warn('[NetLink GPS] Reverse geocode error:', geoErr);
      detectedAddress = null;
    }

    if (geo && (geo.road || geo.locality)) {
      if (forUdp) {
        if (geo.road) $('udpRoadInput').value = geo.road;
        if (geo.locality) $('udpLocalityInput').value = geo.locality;
        setFeedback($('udpFeedback'), `✓ Location identified: ${geo.road || 'Road'}${geo.locality ? ', ' + geo.locality : ''}`, 'success');
      } else {
        applyDetectedAddressToForm(geo, accuracy);
      }
    } else {
      const fallbackMsg = `Coordinates saved (±${accMeters}m). Road name could not be identified — please enter manually.`;
      if (forUdp) setFeedback($('udpFeedback'), fallbackMsg);
      else setLocationStatus(fallbackMsg, accuracy > 50 ? 'loading' : 'success');
    }

    // 3. Update Leaflet Map Preview
    if (!forUdp) {
      updateMapPreview(lat, lon, geo ? geo.road : '', geo ? geo.locality : '', accuracy);
    }

  } catch (err) {
    let errMsg = 'Location detection failed.';
    if (err.code === 1) { // PERMISSION_DENIED
      errMsg = 'Location permission denied. Please allow location access in your browser settings.';
    } else if (err.code === 2) { // POSITION_UNAVAILABLE
      errMsg = 'Location unavailable. Ensure device GPS / location services are turned on.';
    } else if (err.code === 3) { // TIMEOUT
      errMsg = 'Location request timed out. Please try again or enter details manually.';
    } else if (err.message) {
      errMsg = `Location error: ${err.message}`;
    }

    if (forUdp) setFeedback($('udpFeedback'), errMsg, 'error');
    else setLocationStatus(errMsg, 'error');
  } finally {
    isDetectingLocation = false;
    if (btn && !forUdp) btn.disabled = false;
  }
}

/* ── Submit report form ───────────────────────────────────── */
function readReportForm() {
  const road = $('roadInput').value.trim();
  const locality = $('localityInput').value.trim();
  const lat = $('latitudeInput').value.trim();
  const lon = $('longitudeInput').value.trim();
  const accuracy = $('accuracyInput') ? $('accuracyInput').value.trim() : '';
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
  if (accuracy && (isNaN(Number(accuracy)) || Number(accuracy) < 0))
    throw new Error('GPS accuracy must be a non-negative number.');

  return { road, locality, latitude: lat, longitude: lon, accuracy, severity, traffic, immediateDanger, description: desc };
}

async function submitReport(payload) {
  $('submitButton').disabled = true;
  // Include imageRef if one was uploaded
  if (currentImageRef) payload.imageRef = currentImageRef;

  setFeedback($('reportFeedback'), 'Sending report to C server over TCP…');
  let cmd;
  if (payload.accuracy || (payload.latitude && currentImageRef)) {
    cmd = `REPORT_V3|${payload.severity}|${payload.traffic}|${payload.road}|${payload.locality}|${payload.latitude}|${payload.longitude}|${payload.accuracy || ''}|…`;
  } else if (currentImageRef) {
    cmd = `REPORT_V2|${payload.severity}|${payload.traffic}|${payload.road}|${payload.locality}|…|${currentImageRef}`;
  } else {
    cmd = `REPORT|${payload.severity}|${payload.traffic}|${payload.road}|${payload.locality}`;
  }
  logEvent('TCP', 'SEND', cmd);
  try {
    const data = await postJson('/api/report', payload);
    logEvent('TCP', 'RECV', `Server assigned ${data.report.id} · priority ${data.report.priority}.`);
    const imgMsg = currentImageRef ? ` · Photo: ${currentImageRef}` : '';
    const aiMsg  = currentAiResult ? ` · AI: ${currentAiResult.detected ? '🔴 Pothole' : '🟢 Clear'} (${currentAiResult.pct}%)` : '';
    const locMsg = (data.report.latitude != null && data.report.longitude != null)
      ? ` · GPS: ${Number(data.report.latitude).toFixed(4)}, ${Number(data.report.longitude).toFixed(4)}`
      : '';
    setFeedback($('reportFeedback'), `✓ Report ${data.report.id} submitted. Priority: ${data.report.priority}.${aiMsg}${locMsg}${imgMsg}`, 'success');
    $('reportForm').reset();
    updatePriorityPreview();
    $('duplicateWarning').hidden = true;
    resetImageState();
    resetLocationTrackerState();
    await loadReports();
  } catch (err) {
    logEvent('TCP', 'ERROR', `REPORT submission failed: ${err.message}`, true);
    setFeedback($('reportFeedback'), err.message, 'error');
  } finally {
    $('submitButton').disabled = false;
  }
}

$('continueAiReject').addEventListener('click', async () => {
  aiRejectConfirmed = true;
  $('aiRejectWarning').hidden = true;
  $('reportForm').dispatchEvent(new Event('submit', { cancelable: true }));
});

$('cancelAiReject').addEventListener('click', () => {
  resetImageState();
  $('aiRejectWarning').hidden = true;
  setFeedback($('reportFeedback'), 'Image removed. You can select another photo or submit a text report.');
});

$('reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  let payload;
  try {
    payload = readReportForm();
  } catch (err) {
    setFeedback($('reportFeedback'), err.message, 'error');
    return;
  }

  // Prevent accidental submission of photos classified as No Pothole unless explicitly confirmed
  if (currentImageRef && currentAiResult && !currentAiResult.detected && !aiRejectConfirmed) {
    $('aiRejectMessage').textContent = `The AI classifier evaluated this photo as "No Pothole Detected" (Pothole Confidence: ${currentAiResult.pct}%).`;
    $('aiRejectWarning').hidden = false;
    setFeedback($('reportFeedback'), 'Please check the uploaded photo or confirm submission below.');
    $('submitButton').disabled = false;
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


// Preload AI model in background on page startup
window.addEventListener('DOMContentLoaded', () => {
  loadPotholeModel();
});

/* ── GPS Tracker Event Wiring ─────────────────────────────── */
if ($('roadInput')) {
  $('roadInput').addEventListener('input', () => { userHasEditedRoad = true; });
}
if ($('localityInput')) {
  $('localityInput').addEventListener('input', () => { userHasEditedLocality = true; });
}
if ($('btnDetectGps')) {
  $('btnDetectGps').addEventListener('click', () => detectCurrentLocation(false));
}
if ($('btnRefreshGps')) {
  $('btnRefreshGps').addEventListener('click', () => detectCurrentLocation(false));
}
if ($('btnApplySuggestion')) {
  $('btnApplySuggestion').addEventListener('click', () => {
    if (detectedAddress) {
      if (detectedAddress.road && $('roadInput')) $('roadInput').value = detectedAddress.road;
      if (detectedAddress.locality && $('localityInput')) $('localityInput').value = detectedAddress.locality;
      $('geoSuggestionBanner').hidden = true;
      userHasEditedRoad = false;
      userHasEditedLocality = false;
      setLocationStatus(`✓ Applied detected address: ${detectedAddress.road || ''}${detectedAddress.locality ? ', ' + detectedAddress.locality : ''}`, 'success');
    }
  });
}
if ($('btnUdpDetectGps')) {
  $('btnUdpDetectGps').addEventListener('click', () => detectCurrentLocation(true));
}
