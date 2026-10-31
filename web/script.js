const $ = (id) => document.getElementById(id);
const sessionId = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `netlink_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
let pendingReportPayload = null;
let reportData = [];

async function postJson(path, payload = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: sessionId, ...payload })
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The C bridge returned an invalid response.");
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function showMessage(element, message, kind = "") {
  element.textContent = message;
  element.classList.remove("error", "success");
  if (kind) element.classList.add(kind);
}

function logCommunication(protocol, direction, message, isError = false) {
  const list = $("communicationLog");
  const empty = list.querySelector(".log-empty");
  if (empty) empty.remove();
  const entry = document.createElement("li");
  entry.className = isError ? "log-error" : "";
  const time = new Date().toLocaleTimeString();
  entry.textContent = `${time} · ${protocol} · ${direction} · ${message}`;
  list.append(entry);
  while (list.children.length > 40) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
}

async function checkHealth() {
  const dot = $("statusDot");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    const online = response.ok && data.bridge === "ok" && data.backend === "online";
    dot.classList.toggle("connected", online);
    dot.classList.toggle("disconnected", !online);
    $("statusText").textContent = online ? "C server connected" : "C server unavailable";
    $("networkServerStatus").textContent = online ? "Online" : "Offline";
    if (!online) $("activeClientsInfo").textContent = "Unavailable";
  } catch {
    dot.classList.remove("connected");
    dot.classList.add("disconnected");
    $("statusText").textContent = "C server unavailable";
    $("networkServerStatus").textContent = "Offline";
    $("activeClientsInfo").textContent = "Unavailable";
  }
}

async function refreshNetworkInfo(logOperation = false) {
  try {
    const data = await postJson("/api/network-info");
    if (logOperation) {
      logCommunication("TCP", "SEND", "STATS via HTTP bridge to 127.0.0.1:9090");
      logCommunication("TCP", "RECEIVE",
        `Server reports ${data.activeClients}/${data.maxClients} active TCP clients.`);
    }
    $("serverBindInfo").textContent = data.serverBindAddress;
    $("bridgeAddressInfo").textContent =
      `${data.bridgeHost}:${data.httpPort} → ${data.backendTarget}`;
    $("httpPortInfo").textContent = String(data.httpPort);
    $("tcpPortInfo").textContent = String(data.tcpPort);
    $("udpPortInfo").textContent = String(data.udpPort);
    $("activeClientsInfo").textContent =
      `${data.activeClients} / ${data.maxClients}`;
    $("networkServerStatus").textContent = "Online";
    $("networkServerStatus").classList.remove("error");
    showMessage($("networkFeedback"), "Network information received from the C server over TCP.", "success");
    return data;
  } catch (error) {
    if (logOperation) logCommunication("TCP", "ERROR", `STATS failed: ${error.message}`, true);
    $("serverBindInfo").textContent = "Unavailable";
    $("bridgeAddressInfo").textContent = "127.0.0.1 (browser bridge)";
    $("httpPortInfo").textContent = "5000 (bridge)";
    $("tcpPortInfo").textContent = "9090 (server unavailable)";
    $("udpPortInfo").textContent = "9091 (server unavailable)";
    $("activeClientsInfo").textContent = "Unavailable";
    $("networkServerStatus").textContent = "Offline";
    showMessage($("networkFeedback"), `Could not retrieve live network information: ${error.message}`, "error");
    return null;
  }
}

async function runTcpTest() {
  $("tcpTestButton").disabled = true;
  logCommunication("TCP", "SEND", "PING via HTTP bridge to 127.0.0.1:9090");
  showMessage($("networkFeedback"), "Sending a real PING command to the C server over TCP...");
  try {
    const data = await postJson("/api/tcp-test");
    logCommunication("TCP", "RECEIVE", JSON.stringify(data));
    await refreshNetworkInfo();
    showMessage($("networkFeedback"), `TCP test passed: server replied "${data.server}".`, "success");
  } catch (error) {
    logCommunication("TCP", "ERROR", error.message, true);
    showMessage($("networkFeedback"), `TCP test failed: ${error.message}`, "error");
  } finally {
    $("tcpTestButton").disabled = false;
  }
}

function reportAge(timestamp) {
  const minutes = Math.max(0, Math.floor(Date.now() / 1000 - timestamp) / 60);
  if (minutes < 1) return "Submitted just now";
  if (minutes < 60) return `Submitted ${Math.floor(minutes)} minute${Math.floor(minutes) === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Submitted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Submitted ${days} day${days === 1 ? "" : "s"} ago`;
}

function getAssessment() {
  const severity = $("severityInput").value;
  const traffic = $("trafficImpactInput").value;
  const immediateDanger = $("immediateDangerInput").value === "Yes";
  const levels = { Low: 1, Medium: 2, High: 3 };
  const severityScore = levels[severity];
  const priorityScore = severityScore + levels[traffic];
  const priority = priorityScore === 2 ? "LOW"
    : priorityScore <= 4 ? "MEDIUM"
      : priorityScore === 5 ? "HIGH" : "CRITICAL";
  const urgentSuggestion =
    "If anyone is hurt or in immediate danger, contact emergency services directly; this demo does not dispatch help. Notify the local road authority.";
  const suggestions = {
    LOW: "Monitor the pothole and report it again if it worsens.",
    MEDIUM: "Request an inspection and use caution near the pothole.",
    HIGH: "Ask the local road authority to inspect the hazard promptly."
  };
  return {
    severity,
    traffic,
    immediateDanger,
    priority,
    suggestion: immediateDanger || severityScore === 3
      ? urgentSuggestion
      : suggestions[priority]
  };
}

function updateAssessmentPreview() {
  const assessment = getAssessment();
  $("assessmentPreview").textContent =
    `Selected severity: ${assessment.severity} · ${assessment.traffic} traffic · ` +
    `${assessment.immediateDanger ? "Immediate danger reported" : "No immediate danger reported"} · ` +
    `${assessment.priority} priority · Suggested next step: ${assessment.suggestion}`;
}

function reportSuggestion(report) {
  return typeof report.suggestion === "string" && report.suggestion
    ? report.suggestion
    : "Suggestion unavailable from this server version.";
}

function makeReportCard(report) {
  const card = document.createElement("article");
  card.className = "submitted-report";

  const heading = document.createElement("div");
  heading.className = "submitted-report-heading";
  const id = document.createElement("strong");
  id.className = "report-id";
  id.textContent = report.id;
  const priority = document.createElement("span");
  priority.className = `priority-badge priority-${report.priority.toLowerCase()}`;
  priority.textContent = `${report.priority} priority`;
  heading.append(id, priority);

  const road = document.createElement("h3");
  road.className = "report-location";
  road.textContent = `${report.road} · ${report.locality}`;
  const description = document.createElement("p");
  description.className = "report-description";
  description.textContent = report.description;
  const details = document.createElement("p");
  details.className = "report-coordinates";
  const coords = report.latitude === null || report.longitude === null
    ? "Coordinates not provided"
    : `Coordinates: ${report.latitude}, ${report.longitude}`;
  details.textContent = `${report.severity} severity · ${report.traffic} traffic · ` +
    `${report.immediateDanger ? "Immediate danger reported" : "No immediate danger reported"} · ${coords}`;
  const explanation = document.createElement("p");
  explanation.className = "priority-explanation";
  explanation.textContent = report.explanation;
  const suggestion = document.createElement("p");
  suggestion.className = "priority-explanation";
  suggestion.textContent = `Suggestion: ${reportSuggestion(report)}`;
  const submitted = document.createElement("p");
  submitted.className = "report-age";
  submitted.dataset.submittedAt = String(report.submittedAt);
  submitted.textContent =
    `${reportAge(report.submittedAt)} · ${new Date(report.submittedAt * 1000).toLocaleString()}`;

  const statusRow = document.createElement("div");
  statusRow.className = "simple-status-row";
  const status = document.createElement("span");
  status.className = "report-status";
  status.textContent = report.status === "Resolved"
    ? "Resolved"
    : report.status === "In Progress" ? "Waiting for repair" : "Waiting for review";
  const select = document.createElement("select");
  select.className = "report-status-control";
  select.setAttribute("aria-label", `Update status for ${report.id}`);
  for (const value of ["Pending", "Under Review", "In Progress", "Resolved"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = report.status;
  select.addEventListener("change", () => updateStatus(select, report.id));
  statusRow.append(status, select);

  const updated = document.createElement("p");
  updated.className = "status-updated";
  updated.textContent = `Last status update: ${new Date(report.statusUpdatedAt * 1000).toLocaleString()}`;
  const detailButton = document.createElement("button");
  detailButton.className = "secondary-button";
  detailButton.type = "button";
  detailButton.textContent = "Fetch report details over TCP";
  detailButton.addEventListener("click", async () => {
    showMessage($("detailFeedback"), `Fetching ${report.id} from the server over TCP...`);
    logCommunication("TCP", "SEND", `DETAIL|${report.id} via HTTP bridge`);
    try {
      const response = await postJson("/api/report-detail", { id: report.id });
      const item = response.report;
      logCommunication("TCP", "RECEIVE", `Report ${item.id} details returned by the server.`);
      const coordinates = item.latitude === null || item.longitude === null
        ? "Coordinates not provided"
        : `${item.latitude}, ${item.longitude}`;
      showMessage(
        $("detailFeedback"),
        `${item.id}: ${item.road}, ${item.locality} · ${coordinates} · ${item.explanation} Suggestion: ${reportSuggestion(item)}`,
        "success"
      );
    } catch (error) {
      logCommunication("TCP", "ERROR", `DETAIL ${report.id} failed: ${error.message}`, true);
      showMessage($("detailFeedback"), `Could not fetch report details: ${error.message}`, "error");
    }
  });
  card.append(heading, road, description, details, explanation, suggestion, submitted, statusRow, updated, detailButton);
  return card;
}

function updateDashboardSummary(reports) {
  $("totalReportsMetric").textContent = String(reports.length);
  $("criticalReportsMetric").textContent =
    String(reports.filter((report) => report.priority === "CRITICAL").length);
  $("pendingReportsMetric").textContent =
    String(reports.filter((report) => report.status === "Pending").length);
  $("inProgressReportsMetric").textContent =
    String(reports.filter((report) => report.status === "In Progress").length);
  $("resolvedReportsMetric").textContent =
    String(reports.filter((report) => report.status === "Resolved").length);
}

function renderUrgentReports(reports) {
  const list = $("urgentReportsList");
  list.replaceChildren();
  const urgent = reports
    .filter((report) => report.status !== "Resolved")
    .slice()
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      left.submittedAt - right.submittedAt)
    .slice(0, 5);
  if (!urgent.length) {
    const empty = document.createElement("div");
    empty.className = "report-empty";
    empty.textContent = "No unresolved reports.";
    list.append(empty);
    return;
  }
  for (const report of urgent) {
    const item = document.createElement("article");
    item.className = "urgent-item";
    const title = document.createElement("strong");
    title.textContent = `${report.id} · ${report.priority}`;
    const location = document.createElement("p");
    location.textContent = `${report.road} · ${report.locality}`;
    const age = document.createElement("span");
    age.textContent = `${report.status} · ${reportAge(report.submittedAt)}`;
    item.append(title, location, age);
    list.append(item);
  }
}

function renderFilteredReports(reports) {
  const list = $("reportsList");
  const search = $("searchReports").value.trim().toLowerCase();
  const priority = $("priorityFilter").value;
  const status = $("statusFilter").value;
  const oldestFirst = $("sortReports").value === "oldest";
  const filtered = reports
    .filter((report) => {
      const matchesText = !search ||
        report.id.toLowerCase().includes(search) ||
        report.road.toLowerCase().includes(search) ||
        report.locality.toLowerCase().includes(search);
      return matchesText &&
        (priority === "all" || report.priority === priority) &&
        (status === "all" || report.status === status);
    })
    .sort((left, right) => oldestFirst
      ? left.submittedAt - right.submittedAt
      : right.submittedAt - left.submittedAt);

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "report-empty";
    empty.textContent = reports.length
      ? "No reports match your search and filters."
      : "No reports yet. Submit one above; reports are not preloaded.";
    list.append(empty);
    return;
  }
  for (const report of filtered) list.append(makeReportCard(report));
}

async function loadReports(logOperation = false) {
  try {
    const data = await postJson("/api/reports");
    if (logOperation) {
      logCommunication("TCP", "SEND", "LIST via HTTP bridge to 127.0.0.1:9090");
      logCommunication("TCP", "RECEIVE", `Server returned ${data.reports.length} report(s).`);
    }
    reportData = data.reports;
    updateDashboardSummary(reportData);
    renderUrgentReports(reportData);
    renderFilteredReports(reportData);
  } catch (error) {
    if (logOperation) {
      logCommunication("TCP", "ERROR", `LIST failed: ${error.message}`, true);
    }
    reportData = [];
    for (const id of [
      "totalReportsMetric",
      "criticalReportsMetric",
      "pendingReportsMetric",
      "inProgressReportsMetric",
      "resolvedReportsMetric"
    ]) {
      $(id).textContent = "—";
    }
    $("urgentReportsList").replaceChildren();
    const unavailable = document.createElement("div");
    unavailable.className = "report-empty error";
    unavailable.textContent = "Urgent queue unavailable while the C server is disconnected.";
    $("urgentReportsList").append(unavailable);
    $("reportsList").replaceChildren();
    const message = document.createElement("div");
    message.className = "report-empty error";
    message.textContent = `Could not load reports: ${error.message}`;
    $("reportsList").append(message);
  }
}

async function updateStatus(control, id) {
  control.disabled = true;
  showMessage($("statusFeedback"), "Saving the new status on the C server over TCP...");
  logCommunication("TCP", "SEND", `STATUS|${id}|${control.value} via HTTP bridge`);
  try {
    const result = await postJson("/api/report-status", { id, status: control.value });
    logCommunication("TCP", "RECEIVE", `Server saved ${result.report.id} as ${result.report.status}.`);
    showMessage($("statusFeedback"), "Server saved the status.", "success");
    await loadReports();
  } catch (error) {
    logCommunication("TCP", "ERROR", `STATUS update failed: ${error.message}`, true);
    showMessage($("statusFeedback"), `Status update failed: ${error.message}`, "error");
    await loadReports();
  }
}

let udpAlertsData = [];

function makeUdpAlertCard(alert) {
  const card = document.createElement("article");
  card.className = "submitted-report udp-alert-card";

  const heading = document.createElement("div");
  heading.className = "submitted-report-heading";
  const id = document.createElement("strong");
  id.className = "report-id";
  id.textContent = alert.id;
  const statusBadge = document.createElement("span");
  const statusClass = (alert.status || "pending").toLowerCase().replace(/\s+/g, "-");
  statusBadge.className = "priority-badge udp-status-badge status-" + statusClass;
  statusBadge.textContent = alert.status || "Pending";
  heading.append(id, statusBadge);

  const road = document.createElement("h3");
  road.className = "report-location";
  road.textContent = alert.road + " · " + alert.locality;

  const details = document.createElement("p");
  details.className = "report-coordinates";
  details.textContent = alert.severity + " severity · " + alert.traffic + " traffic · " +
    (alert.immediateDanger ? "Immediate danger reported" : "No immediate danger reported");

  const received = document.createElement("p");
  received.className = "report-age";
  received.textContent = "Received: " + new Date(alert.receivedAt * 1000).toLocaleTimeString() +
    " (" + new Date(alert.receivedAt * 1000).toLocaleDateString() + ")";

  const statusRow = document.createElement("div");
  statusRow.className = "simple-status-row";
  const statusLabel = document.createElement("span");
  statusLabel.className = "report-status";
  statusLabel.textContent = alert.status === "Resolved"
    ? "Resolved"
    : (alert.status === "In Progress" ? "In Progress" : "Pending action");

  const select = document.createElement("select");
  select.className = "report-status-control udp-status-control";
  select.setAttribute("aria-label", "Update status for UDP alert " + alert.id);
  for (const value of ["Pending", "Under Review", "In Progress", "Resolved"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = alert.status;
  select.addEventListener("change", () => updateUdpStatus(select, alert.id));
  statusRow.append(statusLabel, select);

  const updated = document.createElement("p");
  updated.className = "status-updated";
  updated.textContent = alert.statusUpdatedAt && alert.statusUpdatedAt !== alert.receivedAt
    ? "Status updated: " + new Date(alert.statusUpdatedAt * 1000).toLocaleTimeString()
    : "Status: Initial";

  card.append(heading, road, details, received, statusRow, updated);
  return card;
}

async function updateUdpStatus(control, id) {
  control.disabled = true;
  const newStatus = control.value;
  showMessage(udpStatusFeedback, "Sending UDP status update for " + id + " to server on port 9091...");
  logCommunication("UDP", "SEND", "ALERT_STATUS|" + id + "|" + newStatus + " datagram to 127.0.0.1:9091 via bridge");
  try {
    const result = await postJson("/api/udp-status", { id: id, status: newStatus });
    logCommunication(
      "UDP",
      "RECEIVE",
      "Server acknowledged UDP alert " + result.id + " status updated to " + result.status + " (UDP ACK received)."
    );
    showMessage(udpStatusFeedback, "Server acknowledged " + result.id + " is now " + result.status + " over UDP!", "success");
    await loadUdpAlerts();
  } catch (error) {
    logCommunication("UDP", "ERROR", "UDP status update error for " + id + ": " + error.message, true);
    showMessage(udpStatusFeedback, "UDP status update failed: " + error.message, "error");
    await loadUdpAlerts();
  }
}

function renderFilteredUdpAlerts() {
  const list = udpAlertsList;
  if (!list) return;
  const searchInput = searchUdpAlerts;
  const filterSelect = udpStatusFilter;
  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const status = filterSelect ? filterSelect.value : "all";

  const filtered = udpAlertsData.filter((alert) => {
    const matchesText = !search ||
      alert.id.toLowerCase().includes(search) ||
      alert.road.toLowerCase().includes(search) ||
      alert.locality.toLowerCase().includes(search);
    const matchesStatus = (status === "all" || alert.status === status);
    return matchesText && matchesStatus;
  });

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "report-empty";
    empty.textContent = udpAlertsData.length
      ? "No UDP alerts match your filter."
      : "No UDP alerts received during this server run.";
    list.append(empty);
    return;
  }

  for (const alert of filtered) {
    list.append(makeUdpAlertCard(alert));
  }
}

async function loadUdpAlerts(logOperation = false) {
  const list = udpAlertsList;
  try {
    const data = await postJson("/api/udp-alerts");
    if (logOperation) {
      logCommunication("TCP", "SEND", "ALERTS via HTTP bridge to 127.0.0.1:9090");
      logCommunication("TCP", "RECEIVE", "Server reports " + (data.alerts ? data.alerts.length : 0) + " UDP alert(s) received; this is a later list query, not a UDP acknowledgement.");
    }
    udpAlertsData = data.alerts || [];
    renderFilteredUdpAlerts();
  } catch (error) {
    if (logOperation) {
      logCommunication("TCP", "ERROR", "ALERTS query failed: " + error.message, true);
    }
    list.replaceChildren();
    const message = document.createElement("div");
    message.className = "report-empty error";
    message.textContent = "Could not load UDP alerts: " + error.message;
    list.append(message);
  }
}

function readReportForm() {
  const road = $("roadInput").value.trim();
  const locality = $("localityInput").value.trim();
  const latitude = $("latitudeInput").value.trim();
  const longitude = $("longitudeInput").value.trim();
  if (!road || !locality || !$("descriptionInput").value.trim()) {
    throw new Error("Enter a road, locality, and short description.");
  }
  if (Boolean(latitude) !== Boolean(longitude)) {
    throw new Error("Enter both coordinates, or leave both blank.");
  }
  if (latitude && (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90)) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (longitude && (!Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180)) {
    throw new Error("Longitude must be between -180 and 180.");
  }
  const assessment = getAssessment();
  return {
    road, locality, latitude, longitude,
    severity: assessment.severity,
    traffic: assessment.traffic,
    immediateDanger: assessment.immediateDanger ? "Yes" : "No",
    description: $("descriptionInput").value.trim()
  };
}

async function submitReport(payload) {
  $("submitButton").disabled = true;
  showMessage($("reportFeedback"), "Sending report to the C server over TCP...");
  logCommunication("TCP", "SEND", `REPORT for ${payload.road}, ${payload.locality} via HTTP bridge`);
  try {
    const data = await postJson("/api/report", payload);
    logCommunication("TCP", "RECEIVE", `Server assigned ${data.report.id}; priority ${data.report.priority}.`);
    showMessage($("reportFeedback"), `Server acknowledged ${data.report.id} · ${data.report.priority} priority.`, "success");
    $("reportForm").reset();
    updateAssessmentPreview();
    $("duplicateWarning").hidden = true;
    await loadReports();
  } catch (error) {
    logCommunication("TCP", "ERROR", `REPORT submission failed: ${error.message}`, true);
    showMessage($("reportFeedback"), error.message, "error");
  } finally {
    $("submitButton").disabled = false;
  }
}

$("reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  let payload;
  try {
    payload = readReportForm();
  } catch (error) {
    logCommunication("TCP", "ERROR", `Duplicate check failed: ${error.message}`, true);
    showMessage($("reportFeedback"), error.message, "error");
    return;
  }
  $("submitButton").disabled = true;
  try {
    logCommunication("TCP", "SEND", `CHECK|${payload.road}|${payload.locality} via HTTP bridge`);
    const result = await postJson("/api/duplicate-check", {
      road: payload.road,
      locality: payload.locality
    });
    logCommunication("TCP", "RECEIVE", `Duplicate check found ${result.matches.length} possible match(es).`);
    if (result.duplicate) {
      pendingReportPayload = payload;
      $("duplicateMessage").textContent = result.matches
        .map((item) => `${item.id} (${item.road}, ${item.locality})`).join("; ");
      $("duplicateWarning").hidden = false;
      showMessage($("reportFeedback"), "Check the possible similar report before continuing.");
    } else {
      await submitReport(payload);
    }
  } catch (error) {
    showMessage($("reportFeedback"), error.message, "error");
  } finally {
    $("submitButton").disabled = false;
  }
});

$("continueDuplicate").addEventListener("click", async () => {
  if (!pendingReportPayload) return;
  const payload = pendingReportPayload;
  pendingReportPayload = null;
  await submitReport(payload);
});

$("cancelDuplicate").addEventListener("click", () => {
  pendingReportPayload = null;
  $("duplicateWarning").hidden = true;
  showMessage($("reportFeedback"), "Report cancelled; nothing was submitted.");
});

for (const id of ["severityInput", "trafficImpactInput", "immediateDangerInput"]) {
  $(id).addEventListener("change", updateAssessmentPreview);
}

$("udpButton").addEventListener("click", async () => {
  const road = $("udpRoadInput").value.trim();
  const locality = $("udpLocalityInput").value.trim();
  const severity = $("udpSeverityInput").value;
  const traffic = $("udpTrafficInput").value;
  const immediateDanger = $("udpImmediateDangerInput").value;
  if (!road || !locality) {
    showMessage($("udpFeedback"), "Enter a road and locality first.", "error");
    return;
  }
  $("udpButton").disabled = true;
  showMessage($("udpFeedback"), "Sending one connectionless UDP datagram...");
  const datagram = `ALERT_V2|${severity}|${traffic}|${immediateDanger}|${road}|${locality}`;
  logCommunication("UDP", "SEND", `to 127.0.0.1:9091 · ${datagram}`);
  try {
    await postJson("/api/udp-alert", { road, locality, severity, traffic, immediateDanger });
    logCommunication("UDP", "LOCAL RESULT", "C bridge sendto() succeeded; server receipt is not guaranteed.");
    showMessage($("udpFeedback"), "Datagram sent by Winsock; delivery is unconfirmed.", "success");
    await loadUdpAlerts(true);
  } catch (error) {
    logCommunication("UDP", "ERROR", error.message, true);
    showMessage($("udpFeedback"), error.message, "error");
  } finally {
    $("udpButton").disabled = false;
  }
});

$("refreshButton").addEventListener("click", () => {
  loadReports(true);
  loadUdpAlerts(true);
});

$("refreshNetworkButton").addEventListener("click", () => refreshNetworkInfo(true));
$("tcpTestButton").addEventListener("click", runTcpTest);
$("clearLogButton").addEventListener("click", () => {
  $("communicationLog").replaceChildren();
  const empty = document.createElement("li");
  empty.className = "log-empty";
  empty.textContent = "No manual network operations logged yet.";
  $("communicationLog").append(empty);
});

for (const id of ["searchReports", "priorityFilter", "statusFilter", "sortReports"]) {
  $(id).addEventListener(
    id === "searchReports" ? "input" : "change",
    () => renderFilteredReports(reportData)
  );
}

async function refreshAgeLabels() {
  document.querySelectorAll(".report-age[data-submitted-at]").forEach((label) => {
    const timestamp = Number(label.dataset.submittedAt);
    label.textContent =
      `${reportAge(timestamp)} · ${new Date(timestamp * 1000).toLocaleString()}`;
  });
}

checkHealth();
updateAssessmentPreview();
refreshNetworkInfo();
loadReports();
loadUdpAlerts();
setInterval(checkHealth, 3000);
setInterval(loadReports, 5000);
setInterval(loadUdpAlerts, 5000);
setInterval(refreshAgeLabels, 60000);
