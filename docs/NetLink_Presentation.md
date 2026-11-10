# NetLink — Complete Project Presentation & Concept Guide
### A Visual, Slide-by-Slide Presentation Guide to Low-Level Socket Programming, Dual-Transport Architecture (TCP & UDP), and Systems Design

---

> **Presentation Overview:**  
> This document is structured in a clear **presentation / slide-deck format**. Each slide contains visual diagrams, high-yield bullet points, and an accompanying **"Speaker Notes / What to Say"** script designed for presentations, viva voce examinations, and classroom walkthroughs.

---

## Slide Index

1. [Slide 1: Title & Project Overview](#slide-1-title--project-overview)
2. [Slide 2: The Problem Statement & Real-World Motivation](#slide-2-the-problem-statement--real-world-motivation)
3. [Slide 3: What is NetLink? (High-Level Solution)](#slide-3-what-is-netlink-high-level-solution)
4. [Slide 4: Computer Networks 101: The Layered Model & Sockets](#slide-4-computer-networks-101-the-layered-model--sockets)
5. [Slide 5: Core Network Concept: TCP vs. UDP Comparison](#slide-5-core-network-concept-tcp-vs-udp-comparison)
6. [Slide 6: Low-Level Network Programming with Windows Sockets (Winsock)](#slide-6-low-level-network-programming-with-windows-sockets-winsock)
7. [Slide 7: NetLink 3-Tier System Architecture](#slide-7-netlink-3-tier-system-architecture)
8. [Slide 8: Tier 1 & 2: Browser Client & The C HTTP Bridge (`bridge.c`)](#slide-8-tier-1--2-browser-client--the-c-http-bridge-bridgec)
9. [Slide 9: Tier 3: Core C Network Server Engine (`server.c`)](#slide-9-tier-3-core-c-network-server-engine-serverc)
10. [Slide 10: Wire Protocol & Byte-Stream Message Framing](#slide-10-wire-protocol--byte-stream-message-framing)
11. [Slide 11: Core Algorithms: Priority Scoring & Duplicate Detection](#slide-11-core-algorithms-priority-scoring--duplicate-detection)
12. [Slide 12: Multithreading, Concurrency & Critical Section Locks](#slide-12-multithreading-concurrency--critical-section-locks)
13. [Slide 13: End-to-End Use Cases & Data Flows](#slide-13-end-to-end-use-cases--data-flows)
14. [Slide 14: Server Configuration, Ports & Environment](#slide-14-server-configuration-ports--environment)
15. [Slide 15: Error Handling, Reliability & Security Realities](#slide-15-error-handling-reliability--security-realities)
16. [Slide 16: Live Demonstration Walkthrough & Viva Q&A Cheatsheet](#slide-16-live-demonstration-walkthrough--viva-qa-cheatsheet)
17. [Slide 17: Summary & Key Takeaways](#slide-17-summary--key-takeaways)

---

## Slide 1: Title & Project Overview

```
========================================================================================
                                     NetLink
               TCP/UDP-Based Client-Server Pothole Reporting System
               Computer Networks and Security (CNS) Project Presentation
========================================================================================
```

### Key Highlights
- **Language & Tech Stack:** Pure ISO C99, Windows Sockets 2 (`ws2_32.dll`), HTML5, CSS3, ES6 JavaScript.
- **Zero Heavy Runtimes:** No Node.js, Python, Apache, NGINX, or external database engines.
- **Dual-Transport Demonstration:** Integrates **TCP** (reliable byte-stream) and **UDP** (lightweight datagrams) simultaneously in a single application.
- **Academic Focus:** Demonstrates error-free client-server communication, multithreaded concurrency, and protocol translation.

> **🎤 Speaker Notes / What to Say:**  
> *"Good morning. Today I am presenting NetLink, a high-performance client-server pothole reporting system developed in pure C using the Windows Sockets API. Rather than relying on modern heavyweight web frameworks like Node.js or Python, NetLink implements low-level network programming from scratch to demonstrate how transport-layer protocols—specifically TCP and UDP—behave under real-world conditions."*

---

## Slide 2: The Problem Statement & Real-World Motivation

### The Challenge with Municipal Road Hazard Reporting

```
+-------------------+       +--------------------+       +----------------------+
| Citizen on Road   |       | Municipal Bottlenecks|     | Result               |
| Encounters Pothole| ----> | - Slow portals     | ----> | - Uninspected hazards|
|                   |       | - Duplicate tickets|       | - Vehicle damage     |
|                   |       | - No prioritization|       | - Severe accidents   |
+-------------------+       +--------------------+       +----------------------+
```

1. **Slow & Bloated Interfaces:** Most municipal reporting forms require multi-page registration, discouraging commuters from reporting hazards quickly.
2. **Duplicate Report Swamping:** Multiple drivers report the same pothole on a busy street, creating hundreds of redundant complaints that overwhelm road authorities.
3. **Lack of Automated Prioritization:** A minor 2-inch depression on a quiet side-street is often treated with the same urgency as a tire-shredding crater on a high-speed arterial roadway.
4. **Poor Status Visibility:** Reporters have no visibility into whether their complaint was reviewed, scheduled, or resolved.

> **🎤 Speaker Notes / What to Say:**  
> *"Potholes are more than just an inconvenience—they cause significant vehicular damage and fatal two-wheeler accidents. Traditional municipal portals fail because they are cumbersome to use, fail to catch duplicate reports, and cannot distinguish an emergency crater on a highway from a minor crack on a quiet lane. NetLink solves these problems with automated priority scoring, duplicate detection, and a dual-channel reporting model."*

---

## Slide 3: What is NetLink? (High-Level Solution)

### A Dual-Channel Civic Reporting Platform

NetLink provides two distinct reporting paths tailored to situational needs:

```
+---------------------------------------------------------------------------------------+
|                                     NetLink                                           |
+------------------------------------------+--------------------------------------------+
| 🔵 Formal Report (TCP Channel)            | 🟣 Quick Alert (UDP Channel)                |
| - Port 9090                              | - Port 9091                                |
| - High integrity, guaranteed delivery    | - Low latency, connectionless datagram     |
| - GPS coordinates, depth, description    | - Instant 3-second hazard broadcast        |
| - Pre-submission duplicate verification  | - Fire-and-forget best-effort delivery     |
| - Lifecycle tracking (Pending->Resolved) | - Ring-buffered alert feed                 |
+------------------------------------------+--------------------------------------------+
```

### Key Solution Features
- **Dual-Path Architecture:** Citizens can file an in-depth formal investigation report over TCP or dispatch a rapid emergency alert over UDP in under 3 seconds.
- **Automated Priority Engine:** Priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) is automatically computed from severity and traffic impact scores.
- **Pre-Submission Deduplication:** Automatically warns reporters if an active ticket already exists for the same street and locality.
- **Transparent Network Monitoring:** Built-in dashboard visualizes active socket connections, server statistics, and real-time communication event logs.

> **🎤 Speaker Notes / What to Say:**  
> *"NetLink introduces a dual-channel approach: when a user has time to provide detailed information—like photos, descriptions, and GPS coordinates—they use the connection-oriented TCP channel. But if a commuter is in transit and needs to send a split-second hazard warning, they use the connectionless UDP channel. The system then automatically prioritizes, deduplicates, and manages the lifecycle of these reports."*

---

## Slide 4: Computer Networks 101: The Layered Model & Sockets

### Where Does NetLink Live in the Network Stack?

```
+-----------------------------+----------------------------------------------------+
| OSI / TCP-IP Layer          | NetLink Implementation / Component                 |
+-----------------------------+----------------------------------------------------+
| 5. Application Layer        | Web UI (script.js), Custom Wire Protocol (REPORT|..)|
| 4. Transport Layer          | TCP (Port 9090) and UDP (Port 9091)                |
| 3. Network (Internet) Layer | IPv4 (127.0.0.1 / Loopback and 0.0.0.0 / INADDR_ANY)|
| 2. Data Link Layer          | Ethernet / Wi-Fi Frames (OS Network Driver)        |
| 1. Physical Layer           | Network Interface Card (NIC) & Physical Medium     |
+-----------------------------+----------------------------------------------------+
```

### Fundamental Concepts Explained Simply
- **What is an IP Address?**  
  A logical numerical identifier for a device on a network (e.g., `127.0.0.1` refers to the local machine, also called loopback).
- **What is a Port Number?**  
  A 16-bit integer ($0$ to $65535$) identifying a specific application or service running on that IP address. NetLink uses port `5000` (HTTP), `9090` (TCP Server), and `9091` (UDP Server).
- **What is a Socket?**  
  An operating system communication endpoint created by calling `socket()`. Think of a socket as the software door through which data enters and leaves an application.

> **🎤 Speaker Notes / What to Say:**  
> *"In computer networking, applications communicate across defined layers. NetLink operates primarily at the Transport and Application layers. When an application needs to talk across a network, it requests a socket from the operating system. By combining an IP address with a port number, the operating system knows exactly which process should receive incoming packets."*

---

## Slide 5: Core Network Concept: TCP vs. UDP Comparison

### The Two Pillars of Transport Layer Communication

```
           TCP (Transmission Control Protocol)                UDP (User Datagram Protocol)
           ===================================                ============================
Connection: Required (3-Way Handshake)                         None (Connectionless)
Delivery:   Guaranteed (Sequence numbers & Retransmission)     Best-Effort (No retransmission)
Data Model: Continuous Byte Stream                             Discrete Independent Datagrams
Overhead:   Higher (20-byte header + state tracking)           Minimal (8-byte header, no state)
Speed:      Slower initial setup, rock-solid reliability       Ultra-fast, instantaneous transmission
Analogy:    A certified phone call with confirmation           A postcard dropped into a mailbox
```

### The TCP Three-Way Handshake
Before any data flows over TCP, client and server synchronize state:
```
Client                              Server
  |                                   |
  | -------- SYN (Seq = x) ---------> |  Step 1: Client requests connection
  |                                   |
  | <--- SYN-ACK (Seq=y, Ack=x+1) --- |  Step 2: Server acknowledges & agrees
  |                                   |
  | -------- ACK (Ack = y+1) -------> |  Step 3: Client confirms; Connection established
  |                                   |
```

### How NetLink Uses Both
- **TCP (Port 9090):** Used where **data integrity** is paramount: filing formal reports, querying detailed lists, updating ticket repair statuses, and diagnostic ping tests.
- **UDP (Port 9091):** Used where **speed and simplicity** are paramount: firing quick, lightweight road alerts without waiting for connection negotiation.

> **🎤 Speaker Notes / What to Say:**  
> *"The choice between TCP and UDP is one of the most fundamental decisions in network design. TCP is connection-oriented: it requires a three-way handshake to establish a connection and guarantees that every byte arrives in order without loss. UDP is connectionless: it sends datagrams immediately with zero setup time, but delivery is not guaranteed. In NetLink, we use TCP for detailed records where data loss is unacceptable, and UDP for quick alerts where transmission speed is critical."*

---

## Slide 6: Low-Level Network Programming with Windows Sockets (Winsock)

### The Life of a Socket in C

```
              TCP SERVER LIFECYCLE                               TCP CLIENT LIFECYCLE
              ====================                               ====================
                 WSAStartup()                                        WSAStartup()
                      |                                                   |
                   socket()   [Create TCP socket]                      socket()
                      |                                                   |
                    bind()    [Bind to 0.0.0.0:9090]                      |
                      |                                                   |
                   listen()   [Set passive queue]                         |
                      |                                                   |
                   accept()   <===== 3-Way Handshake =====            connect()
                      |                                                   |
              CreateThread()  [Worker thread per client]                  |
                      |                                                   |
                   recv()     <========== Data Transmission ===========> send()
                   send()     <========== Data Transmission ===========> recv()
                      |                                                   |
                 closesocket()                                       closesocket()
                      |                                                   |
                 WSACleanup()                                        WSACleanup()
```

### Core Winsock Functions Used in NetLink
- `WSAStartup()` / `WSACleanup()`: Initializes and releases the Windows Sockets DLL (`ws2_32.dll`).
- `socket()`: Allocates streaming sockets (`SOCK_STREAM` for TCP) or datagram sockets (`SOCK_DGRAM` for UDP).
- `bind()`: Links the socket to an IP address (`INADDR_ANY`) and port.
- `listen()` & `accept()`: Puts the TCP socket into listening mode and accepts incoming connections.
- `send()` / `recv()`: Transmits and receives data over TCP byte streams.
- `sendto()` / `recvfrom()`: Sends and receives discrete UDP datagrams with destination/source addresses.
- `setsockopt()`: Configures socket parameters, such as a $3$-second receive timeout (`SO_RCVTIMEO`).

> **🎤 Speaker Notes / What to Say:**  
> *"Winsock is Microsoft Windows' implementation of the Berkeley Sockets API. On this slide, you see the exact lifecycle we programmed in C. The server initializes Winsock, creates a socket, binds it to a port, listens, and accepts connections. When a connection arrives, it spawns a worker thread to handle communication via `recv()` and `send()`. When done, sockets are closed and resources are released."*

---

## Slide 7: NetLink 3-Tier System Architecture

### End-to-End System Topology

```
+---------------------------------------------------------------------------------------+
|                                TIER 1: CLIENT LAYER                                   |
|   Web Browser (HTML5/CSS3/ES6 JS)            Interactive CLI Client (client.exe)      |
+--------------------------+---------------------------------+--------------------------+
                           | HTTP POST (Port 5000)           | Direct TCP (Port 9090)
                           | JSON Payloads                   | / Direct UDP (Port 9091)
+--------------------------v---------------------------------+--------------------------+
|                        TIER 2: PROTOCOL GATEWAY BRIDGE                                |
|   bridge.exe (C HTTP Gateway)                                                         |
|   - Serves static assets (HTML/CSS/JS)                                                |
|   - Validates incoming JSON API requests                                              |
|   - Maintains persistent TCP session per browser tab                                  |
|   - Dispatches UDP datagrams to server:9091                                           |
+--------------------------+---------------------------------+--------------------------+
                           | TCP (Port 9090)                 | UDP (Port 9091)
                           | Custom Byte Stream              | Datagrams
+--------------------------v---------------------------------v--------------------------+
|                             TIER 3: CORE SERVER ENGINE                                |
|   server.exe (C Winsock Engine)                                                       |
|   - Concurrent TCP Client Listener (up to 20 clients)                                 |
|   - Dedicated UDP Alert Receiver Thread                                               |
|   - Thread-Safe In-Memory State Store (Protected by CRITICAL_SECTION)                 |
|   - Priority Scoring, Deduplication & Status Lifecycle                                |
+---------------------------------------------------------------------------------------+
```

### Why Do We Need the Gateway Bridge (`bridge.c`)?
- **Browser Security Restrictions:** Modern web browsers run in a strict security sandbox. JavaScript running inside a browser **cannot open raw TCP sockets or send raw UDP packets**.
- **The Bridge's Role:** `bridge.c` acts as a protocol translator. The browser speaks standard HTTP/JSON to the bridge on port `5000`. The bridge translates those requests into NetLink's custom raw TCP and UDP wire protocols on ports `9090` and `9091`.

> **🎤 Speaker Notes / What to Say:**  
> *"NetLink uses a clean three-tier architecture. Tier 1 is the client layer, featuring both a modern web browser and a command-line tool. Tier 2 is our custom HTTP gateway bridge written in C. Because web browsers are sandboxed and cannot create raw TCP or UDP sockets, our bridge translates HTTP requests into raw socket calls. Tier 3 is the core C server engine that processes commands and maintains state."*

---

## Slide 8: Tier 1 & 2: Browser Client & The C HTTP Bridge (`bridge.c`)

### Inside the Gateway Bridge

```
   BROWSER                             BRIDGE (bridge.exe)                      SERVER (server.exe)
      |                                         |                                         |
      | --- HTTP POST /api/report -----------> |                                         |
      |     {"road":"MG Road", ...}             | --- Translates to Wire Command -------> |
      |                                         |     REPORT|High|High|MG Road|...        |
      |                                         |                                         |
      |                                         | <--- JSON Response from TCP Stream ---- |
      | <--- HTTP 200 OK (JSON) --------------- |     {"ok":true,"report":{...}}          |
      |                                         |                                         |
```

### Bridge Capabilities
1. **Zero-Dependency HTTP Web Server:** Custom-built HTTP/1.1 parsing engine serving `index.html`, `style.css`, and `script.js` directly from disk.
2. **REST API Routing:** Implements distinct endpoints:
   - `/api/health`: Probes backend connectivity.
   - `/api/report`: Relays formal report submissions.
   - `/api/reports`: Queries all active reports (`LIST`).
   - `/api/duplicate-check`: Executes pre-submission validation (`CHECK`).
   - `/api/udp-alert`: Fires best-effort UDP datagrams.
   - `/api/udp-status`: Manages UDP status updates with timeout handling.
3. **Session Tunneling:** Manages per-browser-tab persistent TCP sockets so requests flow smoothly without reconnecting on every click.

> **🎤 Speaker Notes / What to Say:**  
> *"The bridge is an essential architectural piece. It is a fully functional, multithreaded HTTP web server written in C. It serves the web UI files, listens for REST API requests, translates JSON data into our custom socket protocol, and forwards it to the core server. It also maintains session isolation across browser tabs."*

---

## Slide 9: Tier 3: Core C Network Server Engine (`server.c`)

### The Brain of NetLink

```
+---------------------------------------------------------------------------------------+
|                               server.exe Architecture                                 |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|   +--------------------------+                     +------------------------------+   |
|   | TCP Main Thread          |                     | UDP Listener Thread          |   |
|   | - Binds to 0.0.0.0:9090  |                     | - Binds to 0.0.0.0:9091      |   |
|   | - accept() loop          |                     | - Continuous recvfrom() loop |   |
|   +------------+-------------+                     +--------------+---------------+   |
|                |                                                  |                   |
|   +------------v-------------+                                    |                   |
|   | Worker Threads (1 to 20) |                                    |                   |
|   | - Spawns 1 per client    |                                    |                   |
|   | - recv_line() & process()|                                    |                   |
|   +------------+-------------+                                    |                   |
|                |                                                  |                   |
|                +--------------------+       +---------------------+                   |
|                                     |       |                                         |
|                               +-----v-------v-----+                                   |
|                               | CRITICAL_SECTION  |                                   |
|                               | Mutex Protection  |                                   |
|                               +---------+---------+                                   |
|                                         |                                             |
|                               +---------v---------+                                   |
|                               | In-Memory State   |                                   |
|                               | - reports[] (50)  |                                   |
|                               | - alerts[]  (10)  |                                   |
|                               +-------------------+                                   |
+---------------------------------------------------------------------------------------+
```

### Server Engine Responsibilities
- **Dual Socket Binding:** Listens simultaneously on TCP port `9090` and UDP port `9091`.
- **Thread Pool Management:** Accepts up to 20 concurrent TCP connections, delegating each to an independent Windows worker thread.
- **In-Memory Volatile Storage:** Holds up to 50 detailed reports and 10 UDP alerts in bounded memory arrays.
- **Graceful Shutdown:** Implements Win32 console signal trapping (`SetConsoleCtrlHandler`) to cleanly disconnect clients, release mutexes, and free ports on `Ctrl+C`.

> **🎤 Speaker Notes / What to Say:**  
> *"The core server is where the business logic and networking converge. It binds to two ports simultaneously: TCP 9090 and UDP 9091. When TCP clients connect, the server accepts them and delegates each to an isolated worker thread. Meanwhile, a dedicated background thread continuously monitors the UDP port. All shared data is protected by thread-safe critical section locks."*

---

## Slide 10: Wire Protocol & Byte-Stream Message Framing

### The TCP Stream Problem & Newline Framing Solution

```
THE PROBLEM: TCP is a continuous byte stream without packet boundaries.
Client sends:  [ Message 1 ] and then [ Message 2 ]
Server might receive:
   Case A (Coalesced):  [ Message 1Message 2 ]        <-- Nagle's Algorithm
   Case B (Fragmented): [ Mess ] then [ age 1Message 2 ] <-- Network fragmentation

THE NETLINK SOLUTION: Newline-Delimited Framing (\n)
Every command MUST terminate with ASCII newline '\n' (0x0A).
```

### NetLink Command Syntax Reference

| Command Type | Protocol Syntax (Wire Format) | Transport | Expected Response |
| :--- | :--- | :--- | :--- |
| **Ping Test** | `PING\n` | TCP | `{"ok":true,"server":"online"}\n` |
| **Server Stats** | `STATS\n` | TCP | `{"ok":true,"activeClients":X,...}\n` |
| **Submit Report**| `REPORT\|sev\|traf\|road\|loc\|lat\|lon\|desc\|danger\n`| TCP | `{"ok":true,"report":{...}}\n` |
| **Check Duplicate**| `CHECK\|road\|locality\n` | TCP | `{"ok":true,"matches":[...]}\n` |
| **List Reports** | `LIST\n` | TCP | `{"ok":true,"reports":[...]}\n` |
| **Report Details**| `DETAIL\|PTH-XXXXXX\n` | TCP | `{"ok":true,"report":{...}}\n` |
| **Update Status**| `STATUS\|PTH-XXXXXX\|NewStatus\n` | TCP | `{"ok":true,"report":{...}}\n` |
| **Quick Alert** | `ALERT_V2\|sev\|traf\|danger\|road\|locality` | UDP | `ACK\|OK\|UDP-XXXXXX` |
| **Alert Status** | `ALERT_STATUS\|UDP-XXXXXX\|NewStatus` | UDP | `ACK\|STATUS\|UDP-XXXXXX\|status` |

> **🎤 Speaker Notes / What to Say:**  
> *"A common mistake in network programming is assuming that one `send()` on the client equals one `recv()` on the server. Because TCP is a continuous byte stream, messages can merge together or arrive in fragments. To solve this, NetLink uses newline message framing: every command terminates with `\n`. The server reads byte-by-byte until it detects `\n`, guaranteeing clean, uncorrupted message boundaries."*

---

## Slide 11: Core Algorithms: Priority Scoring & Duplicate Detection

### 1. Deterministic Priority Calculation Algorithm

NetLink does not rely on subjective urgency. It computes an objective numeric score:

$$\text{Composite Score} = \text{Score}_{\text{severity}} + \text{Score}_{\text{traffic}}$$

```
   Severity Score             Traffic Impact Score             Priority Classification
   ==============             ====================             =======================
   Low    = 1                 Low    = 1                       Score 2   --> LOW
   Medium = 2                 Medium = 2                       Score 3-4 --> MEDIUM
   High   = 3                 High   = 3                       Score 5   --> HIGH
                                                               Score 6   --> CRITICAL
```

- **Example 1:** Low Severity ($1$) + Low Traffic ($1$) = **Score 2 (`LOW`)**
- **Example 2:** Medium Severity ($2$) + Medium Traffic ($2$) = **Score 4 (`MEDIUM`)**
- **Example 3:** High Severity ($3$) + High Traffic ($3$) = **Score 6 (`CRITICAL`)**
- *Immediate Danger Override:* If injury or danger is flagged, emergency safety instructions are immediately appended.

---

### 2. Pre-Submission Duplicate Detection Algorithm

```mermaid
flowchart TD
    Start[User Enters Road & Locality] --> QueryBridge[Bridge sends CHECK|road|locality]
    QueryBridge --> AcquireLock[Server Acquires reports_lock]
    AcquireLock --> Iterate[Iterate Through All Stored Reports]
    Iterate --> CheckResolved{Is Report Resolved?}
    CheckResolved -- Yes --> Skip[Ignore Record] --> NextReport
    CheckResolved -- No --> StringMatch{Case-Insensitive Match on Road OR Locality?}
    StringMatch -- Yes --> AddMatch[Add to Matches Array] --> NextReport
    StringMatch -- No --> NextReport{More Reports?}
    NextReport -- Yes --> Iterate
    NextReport -- No --> ReleaseLock[Release reports_lock]
    ReleaseLock --> ReturnJSON[Return JSON: duplicate true/false]
    ReturnJSON --> UIAction{Any Matches?}
    UIAction -- Yes --> ShowWarning[Show Duplicate Warning in UI]
    UIAction -- No --> AllowSubmit[Proceed with Direct Submission]
```

> **🎤 Speaker Notes / What to Say:**  
> *"Our priority calculation algorithm assigns numerical weights to severity and traffic impact. The combined score mathematically determines if a report is Low, Medium, High, or Critical. Additionally, our duplicate check algorithm scans active records before submission. If another commuter has already reported a pothole on that road, the system warns the user to prevent duplicate tickets."*

---

## Slide 12: Multithreading, Concurrency & Critical Section Locks

### Why Concurrency Protection is Mandatory

```
   WITHOUT LOCKS (Race Condition Hazard):
   Thread A (Client 1): Reads report_count = 5 ----------------------------+
   Thread B (Client 2): Reads report_count = 5 ---------------+            |
   Thread A: Overwrites reports[5] and sets next_id = 6       | Memory     | DATA CORRUPTION!
   Thread B: Overwrites reports[5] and sets next_id = 6 <-----+ Collision  | Duplicate IDs!
```

### The NetLink Solution: Win32 Critical Sections

```c
// Source: server.c
EnterCriticalSection(&reports_lock);  // <--- Mutex acquired (Thread B waits here)

snprintf(report.id, sizeof(report.id), "PTH-%06d", next_report_id++);
reports[report_count++] = report;    // Safely write to shared array

LeaveCriticalSection(&reports_lock);  // <--- Mutex released (Thread B can now enter)
```

### Dedicated Synchronization Primitives Used
1. `lock`: Protects client socket handles (`clients[]`) and connection count.
2. `reports_lock`: Protects formal report storage (`reports[]`) and ID incrementing.
3. `alerts_lock`: Protects UDP alert array (`udp_alerts[]`) and sliding window shifting.
4. `log_lock`: Serializes console terminal logging so multi-threaded log lines do not overlap.

> **🎤 Speaker Notes / What to Say:**  
> *"When multiple clients connect simultaneously, their worker threads access the same in-memory report array. Without synchronization, a race condition occurs: two threads might write to the same array index at the same time, corrupting data. NetLink uses four Windows `CRITICAL_SECTION` locks to guarantee mutual exclusion. When one thread is writing, all other threads wait until the lock is released."*

---

## Slide 13: End-to-End Use Cases & Data Flows

### Use Case A: Submitting a Formal Pothole Report (TCP)

```
[Browser UI]                 [C HTTP Bridge]                   [C Winsock Server]
     |                              |                                  |
     | 1. Form submitted            |                                  |
     |    (POST /api/report) ------>| 2. Validates & formats           |
     |                              |    "REPORT|High|High|..." ------>| 3. recv_line() reads frame
     |                              |                                  | 4. Calculates Priority (6=CRITICAL)
     |                              |                                  | 5. Assigns ID "PTH-000001"
     |                              |                                  | 6. Saves in reports[]
     |                              |<-- 7. Returns JSON string -------|
     |<-- 8. Returns HTTP 200 OK ---|
     | 9. UI shows confirmation     |
```

### Use Case B: Dispatching a Quick Emergency Alert (UDP)

```
[Browser UI]                 [C HTTP Bridge]                   [C Winsock Server]
     |                              |                                  |
     | 1. Quick alert clicked       |                                  |
     |    (POST /api/udp-alert) --->| 2. Calls sendto()                |
     |                              |    "ALERT_V2|..." -------------->| 3. recvfrom() wakes thread
     |                              |    (Connectionless dispatch)     | 4. Assigns "UDP-000001"
     |<-- 5. "Datagram Dispatched" -|                                  | 5. Stores in sliding window (10 max)
     |       (Delivery unconfirmed) |                                  | 6. Calls sendto() with ACK:
     |                              |<-- 7. Datagram "ACK|OK|..." -----|    "ACK|OK|UDP-000001"
```

> **🎤 Speaker Notes / What to Say:**  
> *"These two sequence diagrams illustrate the difference in communication flow. In Use Case A, the formal report travels through an end-to-end TCP stream with full validation and guaranteed delivery. In Use Case B, the quick alert is dispatched over UDP instantly. The bridge informs the user that the datagram has been dispatched on a best-effort basis, and the server acknowledges receipt with a return datagram."*

---

## Slide 14: Server Configuration, Ports & Environment

### Deployment Topology & Port Allocations

```
+---------------------------------------------------------------------------------------+
| Local Host Machine (127.0.0.1)                                                        |
|                                                                                       |
|  +---------------------------------------------------------------------------------+  |
|  | C HTTP Gateway Bridge (bridge.exe)                                              |  |
|  | - Port: HTTP 5000                                                               |  |
|  | - Bound to: 0.0.0.0:5000 (Accessible via http://127.0.0.1:5000/)                   |  |
|  +------------------------+-------------------------------+------------------------+  |
|                           | Loopback TCP                  | Loopback UDP              |
|                           | Connection                    | Datagrams                 |
|  +------------------------v-------------------------------v------------------------+  |
|  | Core C Winsock Server (server.exe)                                              |  |
|  | - TCP Port: 9090 (Formal Reports, Lists, Status, PING)                          |  |
|  | - UDP Port: 9091 (Quick Location Alerts, Rapid Status ACKs)                     |  |
|  | - Bound to: 0.0.0.0:9090 & 0.0.0.0:9091 (All network interfaces)                |  |
|  | - Maximum Concurrent TCP Clients: 20                                            |  |
|  +---------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------+
```

### Compilation & Execution Commands

```powershell
# 1. Compile all executables using GCC with the Winsock library (-lws2_32)
gcc -o server.exe server.c -lws2_32
gcc -o bridge.exe bridge.c -lws2_32
gcc -o client.exe client.c -lws2_32

# 2. Run with one click
.\start.bat

# 3. Access in browser
http://127.0.0.1:5000/
```

> **🎤 Speaker Notes / What to Say:**  
> *"Here is our deployment configuration. `server.exe` binds to TCP 9090 and UDP 9091 on all interfaces (`0.0.0.0`). `bridge.exe` binds to HTTP port 5000. Compiling is straightforward: we compile using GCC with the `-lws2_32` flag to link Microsoft's Windows Sockets library. Running `start.bat` launches both processes and opens the browser portal automatically."*

---

## Slide 15: Error Handling, Reliability & Security Realities

### Honest Academic Assessment of Communication Security

```
+----------------------------------------------------+--------------------------------------------------+
| What NetLink Implements                            | Current Academic Boundaries                      |
+----------------------------------------------------+--------------------------------------------------+
| [x] TCP transport reliability (Retransmission/ACK) | [!] Cleartext transmission (No TLS/HTTPS)        |
| [x] Newline byte-stream framing (No buffer splits) | [!] In-memory volatile state (Cleared on restart)|
| [x] Input sanitization & delimiter protection (|)  | [!] No user authentication or password hashing   |
| [x] Application-level UDP ACKs with 3s timeout     | [!] Demo only (Does not dispatch physical crews) |
| [x] Thread-safe concurrency (CRITICAL_SECTION)     |                                                  |
+----------------------------------------------------+--------------------------------------------------+
```

### Key Technical Distinctions
1. **TCP Reliability vs. Application Reliability:** TCP guarantees that bytes sent will be received in order without error. However, application-level validation is still required to ensure the bytes form a valid command.
2. **Application ACKs over UDP do NOT make UDP Reliable:** Adding an application ACK verifies whether a specific packet arrived, but it does not change UDP's underlying transport nature (packets can still be dropped, duplicated, or reordered by the network).
3. **Future Production Hardening:** In a real-world municipal deployment, TCP streams would be wrapped in **TLS 1.3** encryption, UDP alerts would use **DTLS**, and administrative status updates would require **JWT (JSON Web Tokens)**.

> **🎤 Speaker Notes / What to Say:**  
> *"Academic honesty is essential in engineering. In NetLink, communication is error-free at the transport layer thanks to TCP sequence numbers and our newline framing algorithm. We sanitize all inputs to prevent delimiter injection. However, because this is an educational prototype, traffic travels in cleartext without TLS encryption, and data is stored in memory. In a commercial deployment, we would add TLS 1.3, DTLS, and cryptographic authentication."*

---

## Slide 16: Live Demonstration Walkthrough & Viva Q&A Cheatsheet

### 5-Step Live Demonstration Script
1. **Step 1 (Dashboard):** Open `http://127.0.0.1:5000/`. Show the green *"C server connected"* status pill and live statistics.
2. **Step 2 (TCP Report & Duplicate Warning):** Go to *Report (TCP)*. Fill in "MG Road". Show the dynamic priority banner calculate `CRITICAL`. Click submit; show the duplicate check alert box; click *Submit Anyway*.
3. **Step 3 (Terminal Verification):** Switch to the `server.exe` terminal. Point out the live connection log: `Client #X sent: "REPORT|..."` and the JSON response.
4. **Step 4 (UDP Quick Alert):** Go to *UDP Alerts*. Send a quick alert. Point out the note explaining connectionless delivery, and show the server console receiving `ALERT_V2` and sending `ACK|OK|UDP-XXXXXX`.
5. **Step 5 (Status Transition & Diagnostic Ping):** In *All Reports*, update a ticket to `In Progress`. In *Network Info*, run the *TCP PING Test* and inspect the live *Communication Log*.

---

### Top Viva / Oral Exam Questions & Model Answers

**Q1: Why did you use both TCP and UDP in the same project?**  
*Answer:* To demonstrate when to use each protocol. TCP is used for detailed formal reports where guaranteed, ordered delivery is required. UDP is used for rapid hazard alerts where minimal transmission latency is prioritized over reliability.

**Q2: What is the "TCP framing problem" and how did you solve it?**  
*Answer:* TCP is a byte-stream protocol with no built-in message boundaries. Multiple messages can merge or fragment. We solved this by implementing newline-delimited framing (`\n`), reading byte-by-byte via `recv_line()` until `\n` is encountered.

**Q3: Why is the HTTP Bridge necessary? Why couldn't the browser connect to the C server directly?**  
*Answer:* Browser security sandboxes prevent client-side JavaScript from opening raw TCP or UDP sockets. The bridge acts as a gateway: the browser communicates over standard HTTP/JSON, and the bridge translates those requests into raw socket calls.

**Q4: How do you prevent race conditions when multiple clients report potholes at once?**  
*Answer:* The server initializes Win32 `CRITICAL_SECTION` mutexes. Worker threads acquire these locks using `EnterCriticalSection()` before reading or writing to shared memory arrays (`reports[]`, `udp_alerts[]`), ensuring only one thread accesses the data at a time.

> **🎤 Speaker Notes / What to Say:**  
> *"During our live demonstration, we will walk the evaluators through these five steps, showing the web UI, the C server terminal logs, and the communication monitor in tandem. On the right side of this slide is a cheatsheet answering the most common technical questions asked during networking project evaluations."*

---

## Slide 17: Summary & Key Takeaways

### What NetLink Achieved

```
+---------------------------------------------------------------------------------------+
|                                    Key Takeaways                                      |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|  1. Pure Systems Programming: Implemented a robust client-server architecture         |
|     in ISO C without third-party frameworks.                                          |
|                                                                                       |
|  2. Real-World Protocol Comparison: Demonstrated the practical trade-offs between      |
|     TCP (reliable byte streams) and UDP (connectionless datagrams).                   |
|                                                                                       |
|  3. Concurrency & Thread Safety: Managed up to 20 simultaneous clients using          |
|     Windows threads and critical sections.                                            |
|                                                                                       |
|  4. End-to-End Architectural Integration: Bridged modern web interfaces with low-level |
|     C socket engines.                                                                 |
|                                                                                       |
|  5. Civic Tech Alignment: Conceptually aligned with UN Sustainable Development        |
|     Goals (SDG 11 - Sustainable Cities, SDG 9 - Resilient Infrastructure).             |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

### Project Resources
- **Core Server:** [`NetLink/server.c`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/server.c)
- **HTTP Gateway Bridge:** [`NetLink/bridge.c`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/bridge.c)
- **CLI Client:** [`NetLink/client.c`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/client.c)
- **Web Frontend:** [`NetLink/web/index.html`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/web/index.html) & [`NetLink/web/script.js`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/web/script.js)
- **Formal Academic Report:** [`NetLink/docs/NetLink_CNS_Report.md`](file:///c:/Users/TIYASHA%20SARKAR/OneDrive/Desktop/PROJECTS/CNS%20AAT/NetLink/docs/NetLink_CNS_Report.md)

---

> **🎤 Final Concluding Statement:**  
> *"To conclude, NetLink bridges theoretical computer networks principles with low-level systems programming. By building our own socket routines, message framing, multithreaded synchronization, and HTTP gateway, we gained deep practical insight into how data actually travels across a network. Thank you, and I am now happy to answer any questions."*

