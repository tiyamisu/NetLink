# NetLink — Pothole Reporting System
### A Complete, Beginner-Friendly Guide to the Project

---

## Table of Contents

1. [Executive Summary & Project Purpose](#1-executive-summary--project-purpose)
2. [What Problem Does NetLink Solve?](#2-what-problem-does-netlink-solve)
3. [System Architecture & Technology Stack](#3-system-architecture--technology-stack)
4. [Core Computer Networks Concepts in Action](#4-core-computer-networks-concepts-in-action)
   - [TCP vs. UDP: Two Distinct Communication Channels](#tcp-vs-udp-two-distinct-communication-channels)
   - [Winsock Socket Programming](#winsock-socket-programming)
   - [Multiline & Newline Framing](#multiline--newline-framing)
   - [Concurrency, Threads & Critical Sections](#concurrency-threads--critical-sections)
   - [In-Memory State & Lifecycle](#in-memory-state--lifecycle)
5. [Tour of the Web Portal (Sections & Features)](#5-tour-of-the-web-portal-sections--features)
   - [Header & Global Navigation](#header--global-navigation)
   - [Section 1: Live Dashboard](#section-1-live-dashboard)
   - [Section 2: File Formal TCP Report](#section-2-file-formal-tcp-report)
   - [Section 3: Quick UDP Alert Portal](#section-3-quick-udp-alert-portal)
   - [Section 4: All Reports & Case Management](#section-4-all-reports--case-management)
   - [Section 5: Network Monitor & Communication Log](#section-5-network-monitor--communication-log)
6. [End-to-End Data Flow Scenarios](#6-end-to-end-data-flow-scenarios)
   - [Scenario A: Submitting a Formal Pothole Report over TCP](#scenario-a-submitting-a-formal-pothole-report-over-tcp)
   - [Scenario B: Dispatching a Quick Location Alert over UDP](#scenario-b-dispatching-a-quick-location-alert-over-udp)
   - [Scenario C: Pre-Submission Duplicate Verification](#scenario-c-pre-submission-duplicate-verification)
   - [Scenario D: Updating a Report Status](#scenario-d-updating-a-report-status)
7. [Wire Protocol & Command Reference](#7-wire-protocol--command-reference)
8. [Setup, Compilation & Demonstration Guide](#8-setup-compilation--demonstration-guide)
9. [Viva & Project Evaluation Q&A](#9-viva--project-evaluation-qa)

---

## 1. Executive Summary & Project Purpose

**NetLink** is a lightweight, high-performance client-server application developed for a college-level **Computer Networks (CNS)** course. It provides a real-time municipal road hazard reporting and tracking system while serving as an educational showcase of low-level network programming.

### Key Highlights
- **Zero Heavy Frameworks**: Built without Node.js, Python runtime, or SQL database engines.
- **Pure C Network Engine**: Implemented in ISO C99 using Windows Sockets 2 (`ws2_32.dll`).
- **Dual Transport Demonstration**: Demonstrates both **TCP** (reliable byte streams) and **UDP** (connectionless datagrams) under real-world usage patterns.
- **Modern Responsive Web Interface**: A clean, single-page web dashboard that communicates through a custom C HTTP gateway.

---

## 2. What Problem Does NetLink Solve?

Potholes and road depressions cause vehicle damage, traffic congestion, and severe road accidents. Traditional municipal reporting systems suffer from:
1. **Slow and Clunky Interfaces**: Citizens must navigate cumbersome government portals just to flag a dangerous road crater.
2. **Duplicate Submissions**: Multiple drivers report the exact same hazard, overwhelming public works departments with redundant data.
3. **Lack of Priority Classification**: A minor crack on a quiet lane is often queued with the same urgency as a tire-shredding crater on a high-speed arterial roadway.
4. **Poor Status Visibility**: Citizens rarely know whether their report was reviewed, queued, or resolved.

### How NetLink Solves This
- **Instant Dual-Path Reporting**: Citizens can file an in-depth formal investigation report over TCP (with GPS coordinates, severity metrics, and descriptions), or dispatch a rapid emergency alert over UDP in under 3 seconds.
- **Automated Severity & Priority Engine**: NetLink calculates hazard priority on the fly based on pothole depth, traffic volume, and immediate safety risk.
- **Automated Duplicate Detection**: Checks active reports before submission to prevent duplicate tickets for the same street and locality.
- **Real-Time Lifecycle Tracking**: Administrators can transition report states (`Pending` → `Under Review` → `In Progress` → `Resolved`).

---

## 3. System Architecture & Technology Stack

NetLink uses a 3-tier architecture:

```text
┌────────────────────────────────────────────────────────┐
│               1. Presentation Layer                    │
│   Web Browser (HTML5, Vanilla CSS3, JavaScript ES6)    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP REST-like JSON (Port 5000)
┌──────────────────────────▼─────────────────────────────┐
│                 2. Gateway Bridge Layer                 │
│              bridge.c / bridge.exe                     │
│  - Serves static web assets (HTML/CSS/JS)              │
│  - Validates API inputs & translates JSON ↔ wire format │
│  - Maintains persistent TCP session per browser tab    │
│  - Sends UDP datagrams to server                       │
└──────────────┬──────────────────────────┬──────────────┘
               │ TCP (Port 9090)          │ UDP (Port 9091)
┌──────────────▼──────────────────────────▼──────────────┐
│                 3. Core Engine Layer                   │
│              server.c / server.exe                     │
│  - Multithreaded TCP listener (up to 20 clients)       │
│  - Dedicated UDP datagram listener thread              │
│  - Thread-safe in-memory report store (CRITICAL_SECTION)│
│  - Priority scoring, duplicate check, status updates   │
└────────────────────────────────────────────────────────┘
                           ▲
                           │ Direct TCP/UDP (CLI)
┌──────────────────────────┴─────────────────────────────┐
│               Interactive CLI Client                   │
│              client.c / client.exe                     │
└────────────────────────────────────────────────────────┘
```

### Port Allocation & Roles

| Component | Network Address | Protocol | Role / Responsibility |
|---|---|---|---|
| **Web Portal** | `http://127.0.0.1:5000` | HTTP over TCP | Frontend GUI viewed by users in any modern browser |
| **HTTP Bridge** | `127.0.0.1:5000` | HTTP / TCP | Bridges browser HTTP requests to backend C sockets |
| **Core TCP Server** | `0.0.0.0:9090` | TCP (Stream) | Reliable command processing: reports, queries, updates |
| **Core UDP Server** | `0.0.0.0:9091` | UDP (Datagram)| Fast location telemetry and quick emergency alerts |

### Technology Breakdown

- **Core Server (`server.c`)**: Native C, Windows Sockets (`winsock2.h`), Windows Threading (`CreateThread`), Synchronization (`CRITICAL_SECTION`).
- **Gateway Bridge (`bridge.c`)**: Native C, multithreaded HTTP server parsing HTTP GET/POST, serving static files and routing API endpoints.
- **CLI Client (`client.c`)**: Interactive terminal console for manual testing and grading demonstrations.
- **Frontend (`web/`)**: Vanilla HTML5, modern CSS3 (custom CSS variables, responsive flex/grid, card UI), vanilla JavaScript (asynchronous `fetch`, DOM manipulation, polling timers).

---

## 4. Core Computer Networks Concepts in Action

### TCP vs. UDP: Two Distinct Communication Channels

A central goal of NetLink is comparing and contrasting the two primary Transport Layer protocols:

| Feature | TCP Path (Port 9090) | UDP Path (Port 9091) |
|---|---|---|
| **Primary Project Use** | Formal Reports, Report Lists, Details, Status Updates, Duplicate Check | Quick Location Alerts (`ALERT_V2`), Rapid Telemetry |
| **Connection State** | Connection-oriented (requires 3-way handshake: SYN → SYN-ACK → ACK) | Connectionless (no handshake; sender immediately transmits) |
| **Reliability** | Guaranteed delivery, automatic retransmissions, ordered byte stream | Best-effort; packets may be dropped, duplicated, or reordered |
| **Overhead** | Higher header overhead (20+ bytes), state tracking per connection | Minimal header overhead (8 bytes), stateless |
| **Application Acknowledgement** | Built into protocol; application receives synchronous JSON reply | Custom application-level `ACK|STATUS|...` or fire-and-forget |
| **Failure Handling** | Socket timeout or reconnect logic | Non-blocking `sendto()`; UI registers alert without waiting |

### Winsock Socket Programming
Both `server.c` and `bridge.c` initialize Windows Sockets using:
```c
WSADATA wsa;
WSAStartup(MAKEWORD(2, 2), &wsa);
```
- **TCP Socket Creation**: `socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)` followed by `bind()`, `listen()`, and `accept()`.
- **UDP Socket Creation**: `socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)` followed by `bind()` and `recvfrom()`.

### Multiline & Newline Framing
TCP is a byte-stream protocol without built-in message boundaries. If two messages are sent in rapid succession, TCP may coalesce them into a single packet, or split one message across multiple packets.
NetLink solves this using **delimiter-based framing**:
- Every TCP command is terminated with a newline character (`\n`).
- The server reads characters from the socket until it encounters `\n`, guaranteeing clean message parsing without packet boundary corruption.

### Concurrency, Threads & Critical Sections
`server.c` handles multiple simultaneous clients cleanly:
1. **TCP Client Concurrency**: When `accept()` accepts a connection, `server.c` creates a dedicated worker thread using `CreateThread()` running `client_handler()`. Up to 20 concurrent connections are supported (`MAX_CLIENTS = 20`).
2. **Dedicated UDP Worker**: A background thread runs `udp_handler()` continuously in an infinite loop listening on port 9091 via `recvfrom()`.
3. **Thread Safety**: Because multiple client threads read and write to the same shared memory arrays (`reports[]` and `udp_alerts[]`), race conditions are prevented using Win32 Critical Sections:
   - `reports_lock`: Guards the report array and `next_report_id`.
   - `alerts_lock`: Guards the UDP alert array and `next_udp_alert_id`.
   - `lock`: Guards the active client socket pool.
   - `log_lock`: Prevents interleaved console log messages.

### In-Memory State & Lifecycle
NetLink keeps all records in high-speed server RAM:
- **Formal Reports Array**: Stores up to 50 reports (`MAX_REPORTS = 50`). When full, the server cleanly rejects new entries with an informative error.
- **UDP Alerts Circular Buffer**: Stores up to 10 alerts (`MAX_UDP_ALERTS = 10`). When an 11th alert arrives, it shifts older alerts out (`memmove`) to prioritize the newest traffic hazard telemetry.
- **Ephemeral Lifecycle**: Stopping `server.exe` resets the store. This makes testing fast, clean, and repeatable.

---

## 5. Tour of the Web Portal (Sections & Features)

The NetLink web portal is organized into 5 primary views accessible via the persistent left-hand sidebar.

### Header & Global Navigation
- **Branding**: Displays the project title and course code ("NetLink · CNS AAT").
- **Live Status Indicator**: A real-time badge in the top corner. Every 5 seconds, JavaScript pings `/api/health`. If the C server is active, it glows emerald green ("System Online"). If the server is stopped, it turns red ("Disconnected").
- **Sidebar Menu**: Quick links to Dashboard, Formal Report, UDP Alert, Reports List, and Network Log.

---

### Section 1: Live Dashboard
The executive summary screen giving a bird's-eye view of road conditions:
- **Summary Metrics Cards**:
  1. *Total Reports*: Total number of formal tickets filed.
  2. *Active*: Reports currently in `Pending`, `Under Review`, or `In Progress` status.
  3. *Resolved*: Successfully fixed road hazards.
  4. *Critical*: High-priority hazards requiring immediate intervention.
- **Recent Activity Feed**: Real-time ticker showing recently submitted reports and incoming alerts.
- **Quick Action Buttons**: Shortcut buttons to jump directly into filing a report or reviewing high-priority items.

---

### Section 2: File Formal TCP Report
A comprehensive intake form for registering verified road hazards via reliable TCP:
- **Severity Level**: Dropdown with options `Low`, `Medium`, and `High`.
- **Traffic Level**: Dropdown with options `Low`, `Medium`, and `High`.
- **Immediate Danger Flag**: Checkbox for life-threatening situations (e.g., exposed rebar, crater on a dark blind turn).
- **Road & Locality**: Text inputs for street name and neighborhood/district.
- **Duplicate Check Trigger**: When moving out of the Road or Locality field, the browser automatically queries the server (`CHECK|road|locality`). If existing unresolved reports are found, an alert banner warns the user with matched IDs.
- **GPS Coordinates (Optional)**: Latitude and Longitude fields with format validation.
- **Description**: Textarea for observed physical dimensions, road markers, or damage.
- **Live Priority Estimator**: Dynamically computes the resulting priority score (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and recommended civic action before the user clicks Submit.
- **Submit Button**: Encodes fields into the pipe-delimited format, transmits through the bridge, and displays an assigned ticket ID (e.g., `PTH-000001`).

---

### Section 3: Quick UDP Alert Portal
Designed for rapid-response reporting (e.g., automated vehicle sensors, delivery drivers on the move):
- **Minimal Form**: Only requires Severity, Traffic, Immediate Danger, Road, and Locality.
- **Fire-and-Forget Transmission**: Dispatched as a single UDP datagram (`ALERT_V2`). The browser registers the dispatch instantly without waiting for connection handshakes.
- **Live UDP Alerts Feed**: Displays the 10 most recent UDP datagrams captured by `server.exe`.
- **Interactive Status Management**: Each alert card contains an inline dropdown (`Pending`, `Under Review`, `In Progress`, `Resolved`). Changing the dropdown sends an `ALERT_STATUS` command over UDP, verifying bidirectional datagram handling.

---

### Section 4: All Reports & Case Management
A searchable registry of all formal pothole tickets:
- **Search & Filter Bar**: Filter by status, priority, or search by road/locality names.
- **Report Cards**: Visual cards displaying ID, priority tag (color-coded), submission timestamp, location, and short description.
- **Detailed Modal**: Clicking any card opens a complete inspector showing GPS coordinates, calculation explanation, civic suggestions, and full timestamp history.
- **Status Transition Workflow**: Authorized reviewers can change the ticket status directly from the modal, notifying municipal road maintenance teams.

---

### Section 5: Network Monitor & Communication Log
An educational console displaying raw network packets as they flow:
- **Packet Log**: Chronological feed of HTTP, TCP, and UDP events.
- **Color-Coded Protocol Badges**: Distinct badges for `TCP` (blue), `UDP` (purple), and `HTTP` (green).
- **Payload Inspection**: Shows raw wire command strings (e.g., `REPORT|High|High|...`) and server JSON responses.
- **Clear & Pause Controls**: Allows students and evaluators to freeze the log to analyze individual packet handshakes during grading.

---

## 6. End-to-End Data Flow Scenarios

### Scenario A: Submitting a Formal Pothole Report over TCP

```text
Browser                       bridge.exe                     server.exe
   │                              │                              │
   │  1. HTTP POST /api/report    │                              │
   ├─────────────────────────────►│                              │
   │                              │  2. Format TCP wire string   │
   │                              │     REPORT|High|Med|MG Rd... │
   │                              ├─────────────────────────────►│
   │                              │                              │  3. Parse & Validate
   │                              │                              │  4. Priority Scoring
   │                              │                              │  5. Assign ID PTH-000001
   │                              │                              │  6. Store in reports[]
   │                              │  7. JSON Response Line       │
   │                              │◄─────────────────────────────┤
   │  8. HTTP 200 JSON Response   │                              │
   │◄─────────────────────────────┤                              │
   │                              │                              │
   ▼ 9. Render Confirmation Modal │                              │
```

1. The user fills out the form in the browser and clicks **Submit Report**.
2. JavaScript gathers the inputs and sends an HTTP POST request to `http://127.0.0.1:5000/api/report`.
3. `bridge.c` receives the HTTP request, validates the payload, and formats a pipe-delimited string:
   ```text
   REPORT|High|Medium|MG Road|Indiranagar|12.9716|77.5946|Deep crater near metro pillar 42|no\n
   ```
4. `bridge.c` writes this string over its persistent TCP socket connection to `server.c` on port 9090.
5. `server.c` worker thread reads the message up to `\n`, validates all fields, and enters `reports_lock`.
6. The server assigns the next sequential ID (e.g., `PTH-000001`), computes priority (`HIGH`), populates timestamps, and appends the record to `reports[]`.
7. `server.c` serializes the new report object into JSON and sends it back across the TCP socket.
8. `bridge.c` forwards this JSON payload as the HTTP response body.
9. JavaScript receives the JSON, updates the UI dashboard, appends the entry to the All Reports view, and presents a success confirmation modal.

---

### Scenario B: Dispatching a Quick Location Alert over UDP

```text
Browser                       bridge.exe                     server.exe
   │                              │                              │
   │  1. HTTP POST /api/udp-alert │                              │
   ├─────────────────────────────►│                              │
   │                              │  2. sendto() Datagram        │
   │                              │     ALERT_V2|High|Low|no|... │
   │                              ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ►│ (Port 9091)
   │  3. HTTP 200 { sent: true }  │                              │
   │◄─────────────────────────────┤                              │  4. recvfrom() in udp_handler
   │                              │                              │  5. Assign ID UDP-000001
   │                              │                              │  6. Append to udp_alerts[]
   ▼                              ▼                              ▼
```

1. The user inputs road and locality in the Quick Alert panel and clicks **Send Emergency Alert**.
2. JavaScript sends an HTTP POST to `/api/udp-alert`.
3. `bridge.c` formats an `ALERT_V2` datagram and calls the non-blocking Winsock function:
   ```c
   sendto(udp_sock, "ALERT_V2|High|Low|no|Ring Road|Hebbal", ...);
   ```
4. `sendto()` places the datagram directly onto the operating system network stack and returns immediately without waiting for a server handshake.
5. In `server.c`, the dedicated `udp_handler()` thread receives the packet via `recvfrom()`.
6. The server locks `alerts_lock`, generates an alert ID (`UDP-000001`), and adds the alert to the 10-item rolling buffer.
7. The browser polls `/api/udp-alerts` to refresh the alert table and display the new ticket.

---

### Scenario C: Pre-Submission Duplicate Verification

1. When the user finishes typing a road name or locality, the `blur` event triggers in `script.js`.
2. The browser sends an HTTP GET request to `/api/check?road=...&locality=...`.
3. `bridge.c` sends a TCP command `CHECK|<road>|<locality>\n` to `server.c`.
4. `server.c` locks `reports_lock` and inspects active reports. If any unresolved report matches either the road or the locality, it returns:
   ```json
   {"ok":true,"matches":[{"id":"PTH-000001","road":"MG Road","locality":"Central","status":"Pending"}],"duplicate":true}
   ```
5. If duplicates exist, the browser displays a subtle warning badge, letting the user view the existing ticket before submitting a redundant report.

---

### Scenario D: Updating a Report Status

1. An administrator views a report in the **All Reports** tab and selects a new status (e.g., `In Progress`).
2. The browser sends an HTTP POST to `/api/status` containing `{ "id": "PTH-000001", "status": "In Progress" }`.
3. `bridge.c` writes `STATUS|PTH-000001|In Progress\n` to `server.c` via TCP.
4. `server.c` locates the report by ID, updates its status and `status_updated_at` timestamp, and replies with the updated report JSON.
5. The UI updates the status badge across the dashboard, metrics counters, and report list.

---

## 7. Wire Protocol & Command Reference

### TCP Protocol (Port 9090 — Line-Delimited)

All TCP commands must end with a newline character (`\n`).

| Command Format | Arguments | Server Response | Description |
|---|---|---|---|
| `REPORT\|<sev>\|<traf>\|<road>\|<loc>\|<lat>\|<lon>\|<desc>\|<danger>` | Severity, traffic, road, locality, lat, lon, desc, danger | `{"ok":true,"report":{...}}` | Submits a new formal pothole report |
| `LIST` | *(None)* | `{"ok":true,"reports":[...]}` | Retrieves all active reports |
| `DETAIL\|<id>` | Report ID (e.g., `PTH-000001`) | `{"ok":true,"report":{...}}` | Fetches full metadata for one report |
| `STATUS\|<id>\|<new_status>` | Report ID, Status string | `{"ok":true,"report":{...}}` | Updates status (`Pending`, `Under Review`, `In Progress`, `Resolved`) |
| `CHECK\|<road>\|<locality>` | Road name, Locality | `{"ok":true,"matches":[...],"duplicate":bool}` | Checks for matching active reports |
| `PING` | *(None)* | `{"ok":true,"server":"online"}` | Liveness check |
| `STATS` | *(None)* | `{"ok":true,"activeClients":N,"maxClients":20,...}` | Server runtime statistics |
| `ALERTS` | *(None)* | `{"ok":true,"alerts":[...]}` | Lists stored UDP alerts over TCP |

### UDP Protocol (Port 9091 — Raw Datagrams)

| Datagram Format | Purpose | Server Action |
|---|---|---|
| `ALERT_V2\|<sev>\|<traf>\|<danger>\|<road>\|<loc>` | Fast location alert | Parses datagram, creates `UDP-XXXXXX`, saves to rolling buffer |
| `ALERT_STATUS\|<id>\|<status>` | Update alert status | Server updates status and sends `ACK\|STATUS\|<id>\|<status>` back via `sendto()` |

---

## 8. Setup, Compilation & Demonstration Guide

### Prerequisites
- Operating System: Windows 10 or 11
- Compiler: GCC for Windows (MinGW-w64 or MSYS2)
- Libraries: Windows Sockets 2 (`-lws2_32`)

### Step 1: Compilation

Open a PowerShell terminal in the project directory:

```powershell
gcc -o server.exe server.c -lws2_32
gcc -o bridge.exe bridge.c -lws2_32
gcc -o client.exe client.c -lws2_32
```

### Step 2: Running the System

Start the services in **two separate terminal windows**:

**Terminal 1 — Core Server:**
```powershell
.\server.exe
```
*Expected Output:*
```text
[HH:MM:SS] NetLink server listening on TCP 0.0.0.0:9090 and UDP 0.0.0.0:9091
```

**Terminal 2 — Gateway Bridge:**
```powershell
.\bridge.exe
```
*Expected Output:*
```text
[HH:MM:SS] HTTP bridge listening on http://127.0.0.1:5000
```

### Step 3: Accessing the Web Portal

Open any web browser and navigate to:
```text
http://127.0.0.1:5000/
```

### Step 4: (Optional) Testing with the CLI Client

**Terminal 3 — Interactive CLI:**
```powershell
.\client.exe
```
Provides an interactive menu to test TCP reports, UDP alerts, and ping tests directly from the console.

---

## 9. Viva & Project Evaluation Q&A

### Q1: Why did you create an HTTP bridge instead of connecting the browser directly to the C TCP server?
**Answer:** Web browsers run in a strict security sandbox. Standard JavaScript executing in a browser cannot open raw TCP or UDP sockets directly (to prevent malicious scripts from scanning internal networks or sending forged packets). The browser can only communicate via HTTP, HTTPS, or WebSockets. The C HTTP bridge (`bridge.c`) acts as an application-layer gateway: it receives standard HTTP requests from the browser and translates them into raw TCP byte streams and UDP datagrams for `server.c`.

### Q2: Why use UDP for alerts and TCP for formal reports?
**Answer:** TCP is connection-oriented and provides reliable, in-order delivery via acknowledgements and retransmissions. This is critical for formal reports where data integrity, ticket numbers, and complete descriptions cannot be lost. UDP is connectionless and lightweight with zero connection-establishment delay. It is ideal for rapid location pings or automated telemetry where speed matters more than guaranteed delivery.

### Q3: How does the server prevent message corruption when multiple commands arrive over TCP?
**Answer:** TCP is a continuous byte stream with no intrinsic record delimiters. NetLink implements **newline message framing**. The sender appends a newline character (`\n`) to each command. The server reads incoming bytes one by one into a buffer until it encounters `\n`, ensuring each command is processed as a complete, independent unit.

### Q4: How is concurrency handled when multiple users submit reports at the same time?
**Answer:** The server uses multithreading via the Windows API. When a client connects on TCP port 9090, `server.c` accepts the connection and invokes `CreateThread()` to spawn a dedicated worker thread. To prevent race conditions when multiple threads access the shared `reports[]` array or modify `next_report_id`, code blocks are wrapped in Win32 `EnterCriticalSection(&reports_lock)` and `LeaveCriticalSection(&reports_lock)`.

### Q5: What happens if `server.exe` crashes or is stopped while `bridge.exe` is running?
**Answer:** If the server is stopped, `bridge.c` detects the broken socket when sending commands. Instead of crashing, it gracefully logs the failure and attempts reconnection on the next request. Meanwhile, the browser's live status pill detects the health-check failure and displays "Disconnected" in red. Once `server.exe` is restarted, the bridge reconnects automatically without requiring a browser reload.

---
*NetLink — Built with C, Winsock, and Vanilla Web Technologies for Computer Networks (CNS).*
