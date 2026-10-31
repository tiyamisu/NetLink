# NetLink — Pothole Reporting System

A **Computer Networks (CNS)** project demonstrating TCP and UDP client-server communication using **C and Windows Sockets (Winsock)**. Multiple browser clients and a CLI client send pothole reports to a single C server over TCP; a separate UDP path sends lightweight location alerts.

## What this project demonstrates

| Concept | Where |
|---|---|
| TCP connection setup (3-way handshake) | Every report or query from the browser |
| Reliable, ordered byte-stream delivery | TCP commands sent to port 9090 |
| Newline message framing | `server.c` reads one line per command |
| UDP connectionless datagrams | ALERT_V2 datagrams sent to port 9091 |
| Application-level ACK over UDP | Status acknowledgements after ALERT_STATUS |
| Concurrent TCP clients | One Windows thread per `accept()`-ed client |
| Critical section synchronisation | Protecting shared report/alert arrays |
| HTTP as an application-layer protocol | Browser ↔ bridge on port 5000 |
| OSI model in practice | Browser → HTTP → Bridge → TCP/UDP → C Server |

---

## Architecture

```text
Browser (HTML + CSS + JavaScript)
    │  HTTP POST/GET  ·  http://127.0.0.1:5000
    ▼
bridge.exe  (bridge.c — C HTTP server)
    │  TCP command  ·  127.0.0.1:9090  (REPORT / LIST / DETAIL / STATUS / CHECK / PING / STATS / ALERTS)
    ▼
server.exe  (server.c — C Winsock server)
    ▲
    │  UDP datagram  ·  port 9091  (ALERT_V2 / ALERT_STATUS)
    └──────────── bridge.exe  and  client.exe
```

`server.c` binds to `0.0.0.0` (`INADDR_ANY`) — it listens on all interfaces. `bridge.c` binds its HTTP listener to `127.0.0.1`, so the portal is accessed on the same PC. All bridge–server communication uses the `127.0.0.1` loopback.

---

## Ports and protocols

| Port | Protocol | Used by | Purpose |
|---|---|---|---|
| **5000** | HTTP (over TCP) | Bridge | Serves the browser portal and API |
| **9090** | TCP | Bridge, client.exe | Reports, list, detail, status, ping, stats, alerts list |
| **9091** | UDP | Bridge, client.exe | Location alerts (ALERT_V2) and status updates |

---

## Files

| File | Description |
|---|---|
| `server.c` | Winsock TCP/UDP server. Accepts up to 20 TCP clients (one thread each), validates commands, assigns report IDs and priorities, and stores everything in memory. |
| `bridge.c` | C HTTP server on port 5000. Serves the `web/` directory, validates browser API input, holds one TCP session per browser tab, and sends UDP alerts with `sendto()`. |
| `client.c` | Optional interactive CLI client. Connects directly to port 9090 for TCP commands and port 9091 for UDP. |
| `web/index.html` | Browser UI — five sections: Dashboard, TCP Report form, UDP Alerts, All Reports, and Network Info. |
| `web/style.css` | Dark navy design system — card layout, TCP/UDP colour coding, responsive. |
| `web/script.js` | All client-side logic — navigation, API calls, report rendering, UDP alert management, communication log. |
| `server.exe` | Compiled server (recompile after editing `server.c`). |
| `bridge.exe` | Compiled bridge (recompile after editing `bridge.c`). |
| `client.exe` | Compiled CLI client (recompile after editing `client.c`). |

No Python, Node.js, database, or durable store. All data lives in the C server's memory and is lost on restart.

---

## Build (Windows — GCC / MinGW)

```powershell
gcc -o server.exe server.c -lws2_32
gcc -o bridge.exe bridge.c -lws2_32
gcc -o client.exe client.c -lws2_32
```

---

## Run

Open **three separate terminals** (or use `Start-Process`) and run each in the project directory:

```powershell
.\server.exe        # Terminal 1 — starts TCP (9090) and UDP (9091) listeners
.\bridge.exe        # Terminal 2 — starts HTTP server on port 5000
.\client.exe        # Terminal 3 (optional) — interactive CLI client
```

Then open **http://127.0.0.1:5000/** in your browser.

> **Note:** Start `server.exe` before `bridge.exe` to avoid connection failures on the first request. If `bridge.exe` starts first it will reconnect automatically on the next request.

---

## TCP report flow (step by step)

1. Browser submits the form → HTTP POST to `bridge.exe` at `http://127.0.0.1:5000/api/report`.
2. Bridge validates field lengths and characters, then sends over its TCP socket to `server.exe`:
   ```
   REPORT|severity|traffic|road|locality|lat|lon|description|immediateDanger\n
   ```
3. Server validates, assigns an ID (`RPT-XXXXXX`), calculates priority:
   - Severity score: Low=1, Medium=2, High=3
   - Traffic score: Low=1, Medium=2, High=3
   - Total 2 → LOW · 3–4 → MEDIUM · 5 → HIGH · 6 → CRITICAL
4. Server replies with a JSON line back over the same TCP connection.
5. Bridge returns that JSON as an HTTP response.
6. Browser shows the assigned ID and priority.

---

## UDP alert flow

1. Browser submits the quick-alert form → HTTP POST to `/api/udp-alert`.
2. Bridge calls `sendto()` with the datagram:
   ```
   ALERT_V2|severity|traffic|immediateDanger|road|locality
   ```
3. `sendto()` returns immediately — **delivery is not confirmed**.
4. If the server received it, it stores the alert with ID `UDP-XXXXXX` and status `Pending`.
5. The browser then calls `/api/udp-alerts` (via TCP through the bridge) to list stored alerts.
6. Status updates use `ALERT_STATUS|id|status` — the server replies `ACK|STATUS|id|status` or `NACK|reason`.

---

## TCP commands (text protocol — newline terminated)

| Command | Description |
|---|---|
| `REPORT\|sev\|traffic\|road\|locality\|lat\|lon\|desc\|danger` | Submit a new pothole report |
| `LIST` | Return JSON array of all reports |
| `DETAIL\|RPT-XXXXXX` | Return full JSON for one report |
| `STATUS\|RPT-XXXXXX\|New Status` | Update report status |
| `CHECK\|road\|locality` | Duplicate check |
| `PING` | Health check (server replies with pong JSON) |
| `STATS` | Server configuration and client count |
| `ALERTS` | List all UDP alerts stored by server |

## UDP commands (datagram — no reply guaranteed)

| Datagram | Description |
|---|---|
| `ALERT_V2\|sev\|traffic\|danger\|road\|locality` | Send a location alert |
| `ALERT_STATUS\|UDP-XXXXXX\|status` | Update an alert's status (server sends ACK/NACK) |

Valid status values: `Pending`, `Under Review`, `In Progress`, `Resolved`

---

## Browser portal — sections

| Section | Protocol used | What you can do |
|---|---|---|
| **Dashboard** | TCP (background) | See live counts of all reports; navigate to other sections |
| **Report (TCP)** | TCP via HTTP | Fill in the report form; see priority preview; detect duplicates |
| **UDP Alerts** | UDP + TCP | Send a location alert datagram; view and update stored alerts |
| **All Reports** | TCP via HTTP | Search, filter, sort; update status; fetch full detail per report |
| **Network Info** | TCP via HTTP | View server config; run a PING test; see architecture; read protocol explanations |

---

## Client.exe commands

```
list            # TCP LIST — fetch all reports
report          # TCP REPORT — interactive report submission
detail <id>     # TCP DETAIL|id — fetch one report
status <id>     # TCP STATUS|id|status — update status
check           # TCP CHECK|road|locality — duplicate check
ping            # TCP PING — health check
stats           # TCP STATS — server information
udp             # UDP ALERT_V2 — send location alert
udp-list        # UDP list (via TCP ALERTS command)
udp-status <id> # UDP ALERT_STATUS|id|status — update alert
quit            # Disconnect and exit
```

---

## Common viva questions

**Q: What is a socket?**
A socket is an OS-managed endpoint for network communication, identified by an IP address and a port number. In C (Winsock), you call `socket()` → `bind()` → `listen()` → `accept()` on the server, and `socket()` → `connect()` on the client.

**Q: Why does TCP need a three-way handshake?**
It synchronises sequence numbers between both endpoints so that either side can detect out-of-order or lost segments and retransmit them. The handshake (SYN → SYN-ACK → ACK) happens automatically in the OS TCP stack when `connect()` and `accept()` are called.

**Q: What is newline framing and why is it needed?**
TCP is a byte stream — there are no built-in message boundaries. A single `send()` call may arrive in multiple `recv()` calls, or several `send()` calls may arrive in one `recv()`. By agreeing that each message ends with `\n`, both sides know exactly where one message ends.

**Q: Why use UDP for alerts when it is unreliable?**
UDP has lower overhead (no connection setup, no ACKs from the OS). For a brief location alert, the cost of establishing a TCP connection may outweigh the benefit if the message is time-sensitive. The application layer can add its own lightweight ACK if confirmation is needed.

**Q: What is INADDR_ANY / 0.0.0.0?**
`INADDR_ANY` tells `bind()` to accept connections on all network interfaces (e.g. loopback, Ethernet, Wi-Fi). The loopback address `127.0.0.1` routes traffic only within the same machine.

**Q: What is a critical section?**
A critical section is a Windows synchronisation primitive that allows only one thread at a time to execute a protected block of code. In this project, `EnterCriticalSection()` and `LeaveCriticalSection()` protect the shared report and alert arrays from concurrent writes by multiple client threads.

**Q: Describe the OSI layers used in this project.**
- Application: HTTP (browser ↔ bridge), and the custom text protocol (bridge ↔ server).
- Transport: TCP for reports and queries; UDP for alerts.
- Network: IP (IPv4) for routing between endpoints.
- Data link / Physical: Ethernet or Wi-Fi (handled by the OS and NIC).

---

## Design notes

- The project has no Python, Node.js, or any non-C backend. All networking is done with Windows Sockets (Winsock).
- Reports are stored in a fixed-size array in server memory; they are lost when the server is restarted.
- The bridge maintains one persistent TCP connection per browser session (identified by a session UUID generated in JavaScript), reconnecting automatically if the server drops it.
- UDP status updates use a 3-second `SO_RCVTIMEO` timeout to wait for an application-level `ACK`. A timeout does not mean the update failed — it means no acknowledgement was received within 3 seconds.
- The portal is intentionally structured as a simple, professional demonstration, not a production SaaS application.
