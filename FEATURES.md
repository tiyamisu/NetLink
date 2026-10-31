# NetLink — Pothole Reporting System
# Complete Features & Technical Specification

> **Course / Subject:** Computer Networks (CNS)  
> **Core Technology:** C (Windows Sockets / Winsock2), HTML5, CSS3, Vanilla JavaScript  
> **Network Protocols:** HTTP/1.1, TCP, UDP, IPv4  
> **Architecture:** 3-Tier Client-Gateway-Daemon Architecture  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture & Network Topology](#2-system-architecture--network-topology)
3. [Core Backend Daemon Features (`server.c`)](#3-core-backend-daemon-features-serverc)
   - [3.1 Multi-Threaded TCP Server (Port 9090)](#31-multi-threaded-tcp-server-port-9090)
   - [3.2 Windows Critical Sections & Thread Safety](#32-windows-critical-sections--thread-safety)
   - [3.3 TCP Newline Stream Framing](#33-tcp-newline-stream-framing)
   - [3.4 Priority Calculation Algorithm](#34-priority-calculation-algorithm)
   - [3.5 Duplicate Detection Engine](#35-duplicate-detection-engine)
   - [3.6 In-Memory Report Lifecycle Management](#36-in-memory-report-lifecycle-management)
   - [3.7 Asynchronous UDP Listener (Port 9091)](#37-asynchronous-udp-listener-port-9091)
   - [3.8 UDP Sliding-Window Alert Buffer](#38-udp-sliding-window-alert-buffer)
   - [3.9 Application-Level Acknowledgement (ACK/NACK)](#39-application-level-acknowledgement-acknack)
   - [3.10 Command Set & Text Protocol Grammar](#310-command-set--text-protocol-grammar)
4. [HTTP Gateway Bridge Features (`bridge.c`)](#4-http-gateway-bridge-features-bridgec)
   - [4.1 Embedded C HTTP/1.1 Web Server (Port 5000)](#41-embedded-c-http11-web-server-port-5000)
   - [4.2 Static File Delivery & MIME Mapping](#42-static-file-delivery--mime-mapping)
   - [4.3 Session Management & Connection Pooling](#43-session-management--connection-pooling)
   - [4.4 Session Reaper Garbage Collector](#44-session-reaper-garbage-collector)
   - [4.5 Request Validation & Security Sanitization](#45-request-validation--security-sanitization)
   - [4.6 UDP Datagram Dispatcher](#46-udp-datagram-dispatcher)
   - [4.7 Complete REST API Specification](#47-complete-rest-api-specification)
5. [Native Interactive CLI Client Features (`client.c`)](#5-native-interactive-cli-client-features-clientc)
   - [5.1 Dual-Protocol Terminal Console](#51-dual-protocol-terminal-console)
   - [5.2 CLI Command Reference](#52-cli-command-reference)
6. [Web Portal Features (`web/`)](#6-web-portal-features-web)
   - [6.1 Responsive Modern Dark-Navy Design System](#61-responsive-modern-dark-navy-design-system)
   - [6.2 Section 1: Real-Time Operations Dashboard](#62-section-1-real-time-operations-dashboard)
   - [6.3 Section 2: TCP Pothole Reporting Form](#63-section-2-tcp-pothole-reporting-form)
   - [6.4 Section 3: UDP Fast Alerts Terminal](#64-section-3-udp-fast-alerts-terminal)
   - [6.5 Section 4: Report Registry & Management](#65-section-4-report-registry--management)
   - [6.6 Section 5: Network Diagnostics & Learning Center](#66-section-5-network-diagnostics--learning-center)
   - [6.7 Real-Time Protocol Event Logger](#67-real-time-protocol-event-logger)
7. [Computer Networking Concepts Demonstrated](#7-computer-networking-concepts-demonstrated)
8. [Compilation, Execution & Operation](#8-compilation-execution--operation)

---

## 1. Project Overview

**NetLink** is a road-hazard and pothole reporting system created to demonstrate core **Computer Networks** concepts through functional systems programming. Unlike typical web projects built entirely on high-level runtimes (such as Node.js, Python Flask, or Django), NetLink uses **pure C and the Windows Sockets API (Winsock2)** to implement low-level networking primitives.

### Primary Educational & Technical Goals
- **Demonstrate Transport Layer Differences**: Provide a side-by-side practical demonstration of **Transmission Control Protocol (TCP)** and **User Datagram Protocol (UDP)**.
- **Socket Programming in C**: Illustrate socket creation, binding, listening, connection acceptance, non-blocking operations, and datagram transmission.
- **Application-Layer Protocol Bridging**: Show how a lightweight C server can act as an HTTP gateway, bridging standard web browsers to custom socket-based text daemons.
- **Thread Concurrency & Synchronization**: Demonstrate multi-threaded client servicing using Windows threads (`CreateThread`) and thread synchronization via `CRITICAL_SECTION`.
- **Zero Heavy Dependencies**: Completely self-contained; requires only GCC (MinGW) on Windows with `ws2_32.lib`. No external libraries or database servers are required.

---

## 2. System Architecture & Network Topology

The project is structured into three distinct layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                            │
│                                                                        │
│   Web Browser Portal (SPA)                     Native C CLI Client     │
│   (HTML5 / CSS3 / Vanilla JS)                      (client.c)          │
│   UUID Session Tracking                        Direct Socket I/O       │
└──────────────────┬─────────────────────────────────────┬───────────────┘
                   │ HTTP/1.1 POST/GET                   │
                   │ (Port 5000)                         │
                   ▼                                     │
┌──────────────────────────────────────┐                 │
│         HTTP GATEWAY BRIDGE          │                 │
│               (bridge.c)             │                 │
│   - Winsock HTTP/1.1 Server          │                 │
│   - Static Asset Dispatcher          │                 │
│   - Persistent TCP Session Pool      │                 │
│   - Session Reaper Thread            │                 │
│   - Protocol Converter (HTTP ↔ TCP)  │                 │
│   - UDP sendto() Dispatcher          │                 │
└──────────┬───────────────────┬───────┘                 │
           │ TCP               │ UDP                     │
           │ (Port 9090)       │ (Port 9091)             │
           ▼                   ▼                         │
┌────────────────────────────────────────────────────────┴───────────────┐
│                          BACKEND DAEMON LAYER                          │
│                                (server.c)                              │
│                                                                        │
│   TCP Listener (0.0.0.0:9090)             UDP Listener (0.0.0.0:9091)  │
│   - Thread Pool (max 20 clients)          - Dedicated UDP thread       │
│   - Newline Message Framing               - Sliding-Window Ring Buffer │
│   - Report Store (max 50)                 - Application-Level ACK      │
│   - Priority Calculation Engine           - Unreliable Datagram Ingest │
│   - Duplicate Detection Engine                                         │
│   - Critical Section Protection (4 Mutexes)                            │
└────────────────────────────────────────────────────────────────────────┘
```

### Network Ports & Endpoint Configuration

| Port | Protocol | Binding Address | Component | Purpose |
|---|---|---|---|---|
| **5000** | HTTP / 1.1 (TCP) | `127.0.0.1` | `bridge.exe` | Serves web assets (`index.html`, `style.css`, `script.js`) and handles REST API requests from the browser. |
| **9090** | TCP (Custom Text) | `0.0.0.0` (`INADDR_ANY`) | `server.exe` | Reliable, connection-oriented channel for report submissions, status updates, detail retrieval, stats, and queries. |
| **9091** | UDP (Datagrams) | `0.0.0.0` (`INADDR_ANY`) | `server.exe` | Fast, connectionless channel for lightweight emergency alerts and status acknowledgements. |

---

## 3. Core Backend Daemon Features (`server.c`)

The backend server is implemented in `server.c` as an independent Win32 console application managing both TCP and UDP communications simultaneously.

### 3.1 Multi-Threaded TCP Server (Port 9090)
- **Binding Address**: Binds to `0.0.0.0` (`INADDR_ANY`), enabling it to accept connections from local loopback or local network interfaces.
- **Client Capacity**: Supports up to **20 concurrent TCP clients** (`MAX_CLIENTS = 20`).
- **Thread-per-Client Model**: When `accept()` returns a new client socket, the server creates a dedicated worker thread using the Windows API `CreateThread(..., client_handler, ...)`.
- **Client Registry**: Maintains an active client table containing:
  - Socket descriptor (`SOCKET sock`)
  - Unique numerical client identifier (`int id`)
  - Active status flag (`int active`)
  - Remote IP address string (`char ip[64]`)

### 3.2 Windows Critical Sections & Thread Safety
Because multiple threads read and mutate shared memory buffers concurrently, `server.c` implements four fine-grained `CRITICAL_SECTION` synchronization objects:
1. `lock`: Protects the `clients[]` array and sequential client ID generation (`next_id`).
2. `reports_lock`: Protects the `reports[]` store, the report counter (`report_count`), and report ID generation (`next_report_id`).
3. `alerts_lock`: Protects the UDP alert ring buffer (`udp_alerts[]`), alert count, and alert ID generation.
4. `log_lock`: Synchronizes thread-safe formatted console logging (`slog`) to prevent interleaved output in the server console.

### 3.3 TCP Newline Stream Framing
TCP is a byte-stream protocol without inherent message boundaries. A message sent via `send()` might arrive fragmented across multiple `recv()` calls or coalesced into one buffer.
- `server.c` implements newline (`\n`) message framing.
- The server reads bytes from the socket into an internal client buffer until a newline character `\n` is encountered, stripping carriage returns (`\r`).
- Only complete, framed command lines are dispatched to the command parser.

### 3.4 Priority Calculation Algorithm
When a report is received, the server computes a deterministic priority score and generates an action suggestion:
- **Severity Scoring**:
  - `Low` = 1 point
  - `Medium` = 2 points
  - `High` = 3 points
- **Traffic Scoring**:
  - `Low` = 1 point
  - `Medium` = 2 points
  - `High` = 3 points
- **Combined Priority Matrix**:
  - **Score = 2**: Priority **`LOW`** (Label: "Low")
  - **Score = 3 – 4**: Priority **`MEDIUM`** (Label: "Medium")
  - **Score = 5**: Priority **`HIGH`** (Label: "High")
  - **Score = 6**: Priority **`CRITICAL`** (Label: "Critical")
- **Immediate Danger Escalation**:
  - If the `immediateDanger` flag is set to `Yes`, the report is assigned an emergency action directive instructing users to contact emergency services immediately, overriding default advisory suggestions.
- **Dynamic Text Generation**:
  - Generates explanation string: `"<Severity> severity + <Traffic> traffic = <Priority> priority."`
  - Generates suggested action guidance customized to the calculated severity.

### 3.5 Duplicate Detection Engine
Before or during report submission, clients can invoke the duplicate check engine:
- Command: `CHECK|<road>|<locality>`
- Compares incoming `road` and `locality` against all active (non-`Resolved`) reports.
- Employs case-insensitive string matching (`_stricmp`).
- Returns `{ "ok": true, "duplicate": true/false, "matches": [...] }` containing matching report IDs, roads, localities, and statuses.

### 3.6 In-Memory Report Lifecycle Management
- **Storage Buffer**: In-memory fixed array of up to **50 reports** (`MAX_REPORTS = 50`).
- **Report Identifier**: Formatted as `PTH-%06d` (e.g., `PTH-000001`).
- **Fields Stored per Report**:
  - ID, Severity, Traffic Level, Priority, Priority Score, Explanation, Suggested Action.
  - Road/Street (up to 120 chars), Area/Locality (up to 120 chars), Description (up to 280 chars).
  - Geographic Coordinates: Latitude and Longitude (with boolean flag `has_coordinates`).
  - Status string: `Pending`, `Under Review`, `In Progress`, or `Resolved`.
  - Timestamps: `submitted_at` (epoch seconds) and `status_updated_at` (epoch seconds).
- **Status Progression**:
  - Clients can update a report's status via `STATUS|<id>|<new_status>`.
  - Status changes update `status_updated_at` and are reflected across all clients.

### 3.7 Asynchronous UDP Listener (Port 9091)
- Initialized on a dedicated background thread (`udp_handler`).
- Executes a continuous blocking `recvfrom()` loop on socket `udp_sock`.
- Captures the sender's endpoint address (`struct sockaddr_in sender`) to identify the origin IP and port.

### 3.8 UDP Sliding-Window Alert Buffer
- Stores up to **10 recent UDP alerts** (`MAX_UDP_ALERTS = 10`).
- Generates alert IDs formatted as `UDP-%06d` (e.g., `UDP-000001`).
- **FIFO Ring Buffer / Sliding Window**: When the alert capacity reaches 10, the oldest alert is evicted using `memmove()` to accommodate the newest arrival.

### 3.9 Application-Level Acknowledgement (ACK/NACK)
Because UDP does not provide transport-layer delivery acknowledgements, `server.c` implements an **application-layer ACK protocol** for status updates:
- When a client sends a datagram: `ALERT_STATUS|<id>|<status>`
- If the ID is valid and updated, the server calls `sendto()` to send back:
  ```
  ACK|STATUS|<id>|<status>
  ```
- If the alert is not found or invalid, the server responds with:
  ```
  NACK|<reason>
  ```

### 3.10 Command Set & Text Protocol Grammar

#### TCP Commands (Sent to Port 9090, Newline-Terminated)

| Command Syntax | Parameters | Server Response | Description |
|---|---|---|---|
| `REPORT\|sev\|traf\|road\|loc\|lat\|lon\|desc\|danger` | Pipe-delimited fields | JSON: `{"ok":true,"report":{...}}` | Submits a new pothole report. Validates fields, calculates priority, and stores in memory. |
| `LIST` | *None* | JSON: `{"ok":true,"reports":[...]}` | Returns an array of all active reports in memory. |
| `DETAIL\|<id>` | `id`: Report ID | JSON: `{"ok":true,"report":{...}}` | Retrieves full metadata for a single report. |
| `STATUS\|<id>\|<status>` | `id`: Report ID, `status`: Target status | JSON: `{"ok":true,"report":{...}}` | Updates a report's status (`Pending`, `Under Review`, `In Progress`, `Resolved`). |
| `CHECK\|<road>\|<locality>` | Road name, Locality name | JSON: `{"ok":true,"matches":[...],"duplicate":bool}` | Checks for existing unresolved reports at the same location. |
| `PING` | *None* | JSON: `{"ok":true,"server":"online"}` | Diagnostics health check. |
| `STATS` | *None* | JSON: `{"ok":true,"serverBindAddress":"0.0.0.0","tcpPort":9090,...}` | Returns operational statistics and active client counts. |
| `ALERTS` | *None* | JSON: `{"ok":true,"alerts":[...]}` | Retrieves all UDP alerts stored in the server's ring buffer. |
| `ALERT_STATUS\|<id>\|<status>` | Alert ID, Target status | JSON: `{"ok":true,"id":"...","status":"..."}` | Updates a UDP alert status over TCP. |
| `HELLO` | *None* | Text: `SUCCESS: Hello! Your request was received.` | Educational greeting test. |
| `TIME` | *None* | Text: `SUCCESS: Server time is <timestamp>` | Fetches backend system time. |
| `ECHO <text>` | String to echo | Text: `SUCCESS: Server echo: <text>` | Echoes back received string. |
| `QUIT` | *None* | Text: `Goodbye! Connection closing.` | Closes the client's TCP socket. |

#### UDP Commands (Sent to Port 9091 as Raw Datagrams)

| Datagram Syntax | Format / Parameters | Response from Server | Description |
|---|---|---|---|
| `ALERT_V2\|sev\|traf\|danger\|road\|loc` | Pipe-delimited fields | *None (Fire-and-forget)* or `NACK` if malformed | Fast location hazard alert. Ingested into the 10-slot alert buffer. |
| `ALERT_STATUS\|<id>\|<status>` | Alert ID and new status | Datagram: `ACK\|STATUS\|<id>\|<status>` or `NACK\|<reason>` | Status update with application-level acknowledgment. |

---

## 4. HTTP Gateway Bridge Features (`bridge.c`)

The bridge executable (`bridge.c`) serves as an intermediary between standard web browsers (which speak HTTP) and the low-level C server (which speaks custom TCP and UDP).

### 4.1 Embedded C HTTP/1.1 Web Server (Port 5000)
- Written in pure C using Winsock2; does not use external web libraries.
- Binds to `127.0.0.1:5000` to provide secure local access.
- Parses incoming HTTP request headers, methods (`GET`, `POST`, `OPTIONS`), content lengths, and JSON payloads.
- Includes standard CORS and cache-control headers (`Cache-Control: no-store`, `Access-Control-Allow-Origin: *`).

### 4.2 Static File Delivery & MIME Mapping
- Directly serves front-end files from the `web/` subfolder:
  - `/` or `/index.html` → `web/index.html` (`text/html; charset=utf-8`)
  - `/style.css` → `web/style.css` (`text/css; charset=utf-8`)
  - `/script.js` → `web/script.js` (`application/javascript; charset=utf-8`)
- Uses binary file reads and sets appropriate `Content-Length` headers.

### 4.3 Session Management & Connection Pooling
- **Browser Tab Identification**: The browser generates a unique UUID `session` identifier stored in JavaScript.
- **Dedicated TCP Sockets**: For each unique session UUID, `bridge.c` maintains a dedicated, persistent TCP connection to `server.c:9090`.
- **Session Registry**: Tracks up to **256 active sessions** (`MAX_SESSIONS = 256`) containing:
  - Session UUID string (`char id[65]`)
  - Connected TCP socket (`SOCKET tcp`)
  - Timestamps: `last_seen` and `last_presence`
  - Per-session critical section lock (`CRITICAL_SECTION lock`)
- **Automatic Reconnection**: If the backend server restarts or a TCP connection is severed, the bridge automatically re-establishes the TCP socket on the next request.

### 4.4 Session Reaper Garbage Collector
- Runs on an independent background thread.
- Periodically scans the session table and reaps sessions idle for more than **300 seconds** (`IDLE_SECONDS = 300`).
- Gracefully shuts down (`shutdown(..., SD_BOTH)`) and closes sockets to prevent resource leaks.

### 4.5 Request Validation & Security Sanitization
Before forwarding any payload to `server.c`, `bridge.c` enforces strict validation:
- **Field Length Limits**: Road (max 120), Locality (max 120), Description (max 280), ID (max 19).
- **Delimiter Injection Protection**: Rejects input containing unauthorized pipe (`|`) characters to prevent protocol injection.
- **Coordinate Validation**: Ensures latitude (-90 to +90) and longitude (-180 to +180) are well-formed numbers, requiring both or neither.

### 4.6 UDP Datagram Dispatcher
- Creates a UDP socket and invokes `sendto()` targeting `127.0.0.1:9091`.
- For `ALERT_V2`, dispatches datagrams instantly without waiting for a reply, returning `{ "ok": true, "sent": true, "deliveryGuaranteed": false }` to the browser.
- For `ALERT_STATUS`, sets a socket receive timeout (`SO_RCVTIMEO`) of **3000 ms** (3 seconds). If the server's `ACK` is received within 3 seconds, it returns confirmation; otherwise, it returns a 504 Gateway Timeout.

### 4.7 Complete REST API Specification

| Endpoint | Method | Required Payload | Backend Action | Response Structure |
|---|---|---|---|---|
| `/api/health` | `GET` | *None* | Tests TCP socket connectivity to port 9090 | `{"bridge":"ok","backend":"online"}` |
| `/api/network-info` | `POST` | `{"session":"<uuid>"}` | Sends `STATS` over TCP | `{"ok":true,"serverBindAddress":"0.0.0.0","httpPort":5000,"tcpPort":9090,"udpPort":9091,"activeClients":1,"maxClients":20}` |
| `/api/tcp-test` | `POST` | `{"session":"<uuid>"}` | Sends `PING` over TCP | `{"ok":true,"server":"online"}` |
| `/api/report` | `POST` | `{"session":"...","road":"...","locality":"...","latitude":"...","longitude":"...","severity":"...","traffic":"...","immediateDanger":"...","description":"..."}` | Validates and sends `REPORT\|...` over TCP | `{"ok":true,"report":{"id":"PTH-000001","priority":"HIGH",...}}` |
| `/api/reports` | `POST` | `{"session":"<uuid>"}` | Sends `LIST` over TCP | `{"ok":true,"reports":[{...},{...}]}` |
| `/api/report-detail` | `POST` | `{"session":"<uuid>","id":"PTH-000001"}` | Sends `DETAIL\|<id>` over TCP | `{"ok":true,"report":{...}}` |
| `/api/report-status` | `POST` | `{"session":"...","id":"PTH-000001","status":"In Progress"}` | Sends `STATUS\|<id>\|<status>` over TCP | `{"ok":true,"report":{...}}` |
| `/api/duplicate-check` | `POST` | `{"session":"...","road":"...","locality":"..."}` | Sends `CHECK\|<road>\|<locality>` over TCP | `{"ok":true,"matches":[...],"duplicate":true}` |
| `/api/udp-alert` | `POST` | `{"session":"...","road":"...","locality":"...","severity":"...","traffic":"...","immediateDanger":"..."}` | Formats and sends `ALERT_V2` via UDP `sendto()` | `{"ok":true,"sent":true,"deliveryGuaranteed":false,"confirmed":false}` |
| `/api/udp-alerts` | `POST` | `{"session":"<uuid>"}` | Sends `ALERTS` over TCP | `{"ok":true,"alerts":[{...}]}` |
| `/api/udp-status` | `POST` | `{"session":"...","id":"UDP-000001","status":"Resolved"}` | Sends `ALERT_STATUS` datagram via UDP and waits up to 3s for `ACK` | `{"ok":true,"id":"UDP-000001","status":"Resolved","confirmed":true}` |

---

## 5. Native Interactive CLI Client Features (`client.c`)

In addition to the web browser interface, the project includes an interactive Command-Line Interface client implemented in `client.c`.

### 5.1 Dual-Protocol Terminal Console
- Connects directly to the backend server via native Winsock calls without going through the HTTP bridge.
- Opens a dedicated TCP socket to `127.0.0.1:9090` for structured interactive commands.
- Configures a UDP socket targeting `127.0.0.1:9091` with a 3-second `SO_RCVTIMEO` for datagram commands.

### 5.2 CLI Command Reference

```text
============================================================
              NETLINK CLI COMMAND REFERENCE                 
============================================================
  list            - Requests and prints all active reports (TCP)
  report          - Interactive prompt to submit a new pothole report (TCP)
  detail <id>     - Fetches full record for specified report ID (TCP)
  status <id>     - Prompts for new status and updates report (TCP)
  check           - Prompts for road & locality to check duplicates (TCP)
  ping            - Runs backend health check (TCP)
  stats           - Prints server network configuration and client count (TCP)
  udp             - Prompts for location and dispatches fast alert (UDP)
  udp-list        - Fetches stored UDP alerts from server (TCP)
  udp-status <id> - Sends UDP ALERT_STATUS and awaits application ACK (UDP)
  quit            - Sends QUIT command, closes sockets, and exits
============================================================
```

---

## 6. Web Portal Features (`web/`)

The front-end is a clean Single Page Application (SPA) designed to give users real-time visibility into networking operations.

### 6.1 Responsive Modern Dark-Navy Design System
- **Color Palette**: Dark slate and navy background (`#0b111e`, `#111c30`, `#1a2942`) with high-contrast typography and subtle borders.
- **Protocol Color Coding**:
  - **TCP Elements**: Mint Emerald Green (`#3dcb82` / `rgba(61, 203, 130, 0.15)`) representing reliability, confirmation, and connection state.
  - **UDP Elements**: Cobalt Blue (`#5b9cf6` / `rgba(91, 156, 246, 0.15)`) representing datagrams, speed, and best-effort delivery.
- **Typography**: Google Font `Inter` (weights 400, 500, 600, 700) with monospace formatting for IDs, coordinates, and network logs.
- **Mobile Responsive**: Adaptive navigation bar with drawer toggle for smaller viewports.

### 6.2 Section 1: Real-Time Operations Dashboard
- **Live Statistics Cards**:
  1. **Total Reports**: Total number of registered road hazards.
  2. **Pending**: New hazards awaiting inspection.
  3. **Under Review / In Progress**: Active maintenance cases.
  4. **Resolved**: Successfully repaired potholes.
  5. **Critical Priority**: Hazards marked with highest urgency.
- **Live Connection Health Indicator**:
  - Displays green/red pulse indicator with status text (`C server connected` / `C server offline`).
  - Automatically queries `/api/health` every 5 seconds.
- **Automated Data Polling**:
  - Automatically polls `/api/reports` every 8 seconds to synchronize dashboard counts.
- **Recent Reports Feed**:
  - Displays the 5 most recent hazard submissions with priority badges and direct navigation links.
- **Quick-Action Shortcuts**:
  - One-click buttons to quickly jump to the TCP Report Form or UDP Quick Alert form.

### 6.3 Section 2: TCP Pothole Reporting Form
- **Form Input Fields**:
  - Road / Street name (text, max 120 characters).
  - Area / Locality name (text, max 120 characters).
  - Severity Level selector (`Low`, `Medium`, `High`).
  - Traffic Volume selector (`Low`, `Medium`, `High`).
  - Immediate Danger toggle checkbox.
  - Optional GPS Coordinates: Latitude (-90 to +90) and Longitude (-180 to +180).
  - Description textarea (max 280 characters).
- **Interactive Live Priority Preview**:
  - Computes the priority score dynamically as the user changes severity or traffic dropdowns.
  - Displays priority badge (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), calculated score, and advisory recommendations before submission.
- **Pre-Flight Duplicate Detection**:
  - As the user types the road and locality, an asynchronous duplicate check queries `/api/duplicate-check`.
  - Warns the user if an existing report matches the location, displaying the existing report ID and status.
- **Duplicate Confirmation Modal**:
  - If a potential duplicate is detected upon clicking submit, a modal presents the matching hazards and asks the user whether to proceed or cancel.
- **Educational Explainer Card**:
  - "How TCP Works Here" breakdown highlighting socket establishment, 3-way handshake, reliable streaming, and server acknowledgment.

### 6.4 Section 3: UDP Fast Alerts Terminal
- **Rapid Alert Form**:
  - Streamlined form for quick emergency dispatches requiring minimal input (Severity, Traffic, Immediate Danger, Road, Locality).
  - Sends datagrams via UDP without establishing a handshake.
- **Stored UDP Alerts Table**:
  - Fetches and displays the server's 10-slot circular alert buffer.
  - Shows Alert ID (`UDP-XXXXXX`), Road, Locality, Severity, Traffic, Received Timestamp, and Status.
- **Interactive UDP Status Updates**:
  - Dropdown selector allows users to change alert statuses.
  - Dispatches an `ALERT_STATUS` datagram and displays confirmed status upon receiving the application-level `ACK`.
- **Educational Explainer Card**:
  - "How UDP Works Here" breakdown detailing datagram structure, connectionless transport, zero-handshake latency benefits, and why application-level ACKs are used.

### 6.5 Section 4: Report Registry & Management
- **Full Report Catalog**:
  - Displays every report currently stored in the server's memory.
- **Search & Filtering Toolbar**:
  - **Text Search**: Real-time searching across Road, Locality, Report ID, and Description.
  - **Priority Filter**: Filter by `All Priorities`, `Low`, `Medium`, `High`, or `Critical`.
  - **Status Filter**: Filter by `All Statuses`, `Pending`, `Under Review`, `In Progress`, or `Resolved`.
  - **Sort Order**: Sort by `Newest First` or `Oldest First`.
- **Inline Status Changer**:
  - Dropdown menu on each report card allows immediate status transitions via TCP.
- **Report Detail Modal**:
  - Clicking "View Full Details" opens an inspection modal displaying:
    - Unique ID, Current Status, Submission Date/Time, Last Updated Timestamp.
    - Full Road and Locality.
    - Exact GPS Latitude and Longitude coordinates.
    - Severity, Traffic, Priority Score, and Immediate Danger status.
    - Full Description text.
    - Server-generated Explanation and Suggested Action.

### 6.6 Section 5: Network Diagnostics & Learning Center
- **Live Configuration Cards**:
  - Server Bind Address (`0.0.0.0` / `INADDR_ANY`)
  - HTTP Web Port (`5000`)
  - TCP Backend Port (`9090`)
  - UDP Alert Port (`9091`)
  - Active TCP Clients (`N / 20`)
- **Interactive TCP PING Test**:
  - Dedicated "Run TCP PING Test" button that sends a `PING` command over TCP and measures backend availability.
- **Interactive Viva Voce Exam Q&A**:
  - Expandable accordion containing 7 fundamental Computer Networks exam questions with detailed technical answers.

### 6.7 Real-Time Protocol Event Logger
- Embedded console widget located in the Network Info section.
- Records every network transaction initiated by the web portal in real time.
- Color-coded log items:
  - Green for **TCP** operations (`[HH:MM:SS] TCP SEND: ...`, `[HH:MM:SS] TCP RECV: ...`)
  - Blue for **UDP** operations (`[HH:MM:SS] UDP SEND: ...`, `[HH:MM:SS] UDP RECV: ...`)
  - Red for **Errors** (`[HH:MM:SS] TCP ERROR: ...`)
- Maintains a rolling history of the last 50 events.

---

## 7. Computer Networking Concepts Demonstrated

| Networking Concept | Implementation in NetLink | Academic Significance |
|---|---|---|
| **OSI Model Mapping** | - **Application**: HTTP/1.1 (Browser ↔ Bridge) and Custom Text Protocol (Bridge ↔ Server)<br>- **Transport**: TCP (Port 9090) & UDP (Port 9091)<br>- **Network**: IPv4 Routing (`127.0.0.1` and `0.0.0.0`)<br>- **Data Link / Physical**: Loopback interface / Ethernet / Wi-Fi | Demonstrates how layered network stacks operate in actual software systems. |
| **TCP 3-Way Handshake** | Triggered whenever a client connects via `connect()` and the server responds via `accept()`. SYN → SYN-ACK → ACK exchange. | Establishes synchronized sequence numbers and dedicated virtual circuits before data transfer. |
| **Stream vs. Datagram Transport** | - **TCP**: Continuous byte stream requiring newline (`\n`) message framing.<br>- **UDP**: Discrete datagrams (`recvfrom` reads exactly one packet per call). | Contrasts stream-based delivery with packet-based transmission boundaries. |
| **Reliability & Guarantees** | TCP automatically retransmits dropped packets, checks parity/checksums, and guarantees ordered delivery. UDP offers best-effort delivery with no retransmissions. | Illustrates why transactional databases and report registries choose TCP over UDP. |
| **Transport Overhead & Latency** | UDP alerts require zero handshake packets and zero teardown overhead, minimizing latency for urgent notifications. | Shows the design trade-offs between transmission reliability and speed. |
| **Application-Layer ACK** | Implemented on UDP port 9091 (`ALERT_STATUS` triggers `ACK|STATUS|...`). | Demonstrates how applications can build custom confirmation logic on top of unreliable transport protocols. |
| **Socket Binding Semantics** | - `server.c` binds to `0.0.0.0` (`INADDR_ANY`) to listen on all interfaces.<br>- `bridge.c` binds to `127.0.0.1` (`INADDR_LOOPBACK`) for host isolation. | Highlights socket configuration differences between public daemons and local gateways. |
| **Multi-Threaded Server Concurrency** | Main TCP thread accepts connections and spawns worker threads (`CreateThread`) to handle multiple simultaneous clients. | Teaches concurrent client handling without blocking the master listening socket. |
| **Critical Section Synchronization** | Four Win32 `CRITICAL_SECTION` mutexes protect in-memory arrays from concurrent write corruption. | Demonstrates shared-memory race condition prevention in network daemons. |

---

## 8. Compilation, Execution & Operation

### Prerequisites
- Windows OS (Windows 10/11 or Windows Server)
- GCC with MinGW (e.g., `w64devkit`, MinGW-w64, or MSYS2)
- Windows Sockets Library (`ws2_32`)

### 8.1 Compilation
Run the following commands in PowerShell or Command Prompt from the project directory:

```powershell
# Compile the backend server daemon
gcc -o server.exe server.c -lws2_32

# Compile the HTTP gateway bridge
gcc -o bridge.exe bridge.c -lws2_32

# Compile the optional CLI client
gcc -o client.exe client.c -lws2_32
```

### 8.2 Execution Methods

#### Method A: One-Click Startup (`start.bat`)
Double-click `start.bat` or run:
```cmd
start.bat
```
This batch script will:
1. Compile `server.c` and `bridge.c` if binaries are missing.
2. Launch `server.exe` in its own console window.
3. Wait 2 seconds for sockets to bind.
4. Launch `bridge.exe` in its own console window.
5. Open your default web browser to `http://127.0.0.1:5000/`.

#### Method B: Manual Multi-Terminal Startup
Open two separate terminal windows:

**Terminal 1 (Backend Daemon):**
```powershell
.\server.exe
```
*Output: Displays timestamped logs of TCP port 9090 and UDP port 9091 listening.*

**Terminal 2 (HTTP Gateway):**
```powershell
.\bridge.exe
```
*Output: Displays HTTP server listening on `http://127.0.0.1:5000`.*

**Terminal 3 (Optional CLI Client):**
```powershell
.\client.exe
```

Open your browser to: **`http://127.0.0.1:5000/`**
