# NetLink: Pothole Reporting System

A small Windows Computer Networks demonstration. Multiple clients send pothole reports to one C/Winsock server over TCP. A separate UDP path sends lightweight location alerts and demonstrates optional application-level acknowledgements/status updates. The existing browser portal is served by a C HTTP bridge.

## What this project demonstrates

- Client/server communication and request/response messages.
- TCP connection establishment and reliable, ordered byte-stream transfer.
- Newline framing, which marks message boundaries in a TCP byte stream.
- UDP connectionless datagrams and the fact that application acknowledgements do not make UDP itself reliable.
- Concurrent TCP clients using Windows threads and critical sections.
- HTTP at the browser-to-bridge boundary, followed by TCP or UDP between C programs.

## Architecture

```text
Browser (HTML/CSS/JavaScript)
    | HTTP requests and page files
    | http://127.0.0.1:5000
    v
bridge.exe (bridge.c, C HTTP server)
    | TCP commands to 127.0.0.1:9090
    v
server.exe (server.c, C Winsock report server)
    ^
    | UDP datagram to port 9091
    +---------------- bridge.exe

client.exe (client.c) ---------------- TCP directly to server.exe:9090
client.exe (client.c) ---------------- UDP directly to server.exe:9091
```

`server.c` binds its TCP and UDP sockets to `0.0.0.0` (`INADDR_ANY`), meaning it listens on available local interfaces. The bridge binds its HTTP listener to `127.0.0.1`, so the portal is intended to be opened on the same PC. The bridge's backend TCP/UDP destination is also `127.0.0.1`.

## Ports and protocols

| Port | Protocol | Purpose |
|---|---|---|
| 5000 | HTTP over TCP | Browser page and API, served by `bridge.exe` |
| 9090 | TCP | Reports, list/detail/status, duplicate checks, stats and TCP test |
| 9091 | UDP | Location alerts, alert-list queries, and alert-status updates |

HTTP is an application-layer protocol; TCP and UDP are transport-layer protocols; IP is a network-layer protocol. Winsock is the Windows socket API used by the C programs.

## Files

- `server.c`: Winsock TCP/UDP server. Accepts up to 20 TCP connections, starts a Windows thread for each accepted client, validates report/status commands, assigns report IDs and priorities, stores reports and received UDP alerts in memory, and logs connections, commands, replies, and alerts. UDP alerts receive IDs and start as `Pending`; terminal UDP requests can list alerts and update their status, with acknowledgements sent after successful processing. JSON replies are pretty-printed in the terminal log. Critical sections protect the shared client, report, and alert arrays.
- `bridge.c`: C HTTP server on port 5000. Serves files from `web\`, validates browser API input, maintains a TCP connection per browser session, forwards report operations to `server.c`, and sends UDP alerts using `sendto()`. Its health endpoint checks TCP backend connectivity.
- `client.c`: Optional interactive C/Winsock command-line client. Connects directly to TCP port 9090 for report, list, detail, and status commands; these commands remain available only when the TCP connection is up. UDP commands (`udp`, `udp-list`, and `udp-status`) work independently of that TCP connection. The client waits up to three seconds for UDP replies, and JSON replies are printed with fields on separate lines. TCP `list` output shows one non-resolved report per line; resolved reports can still be viewed with `detail`.
- `web/index.html`: Browser structure, report form, separate TCP/UDP columns, dashboard, network information, communication log, and expandable networking/viva explanations.
- `web/script.js`: Browser validation and API calls; the report questionnaire and severity preview; report submission/list/detail/status; duplicate checks; live dashboard counts; priority/status filters and sorting; periodic refresh and report age; UDP alert submission; network status/test; and user-action communication log.
- `web/style.css`: Dark visual theme, responsive layout, and styles for the portal/dashboard/network panel/viva guide. It also retains older CSS rules that are not used by the current page.
- `server.exe`, `bridge.exe`, `client.exe`: Compiled executables. Recompile them after changing their respective `.c` file.

There is no Python backend, Node.js backend, database, or durable report store. `__pycache__`, if present, is not required to run this application.

## TCP report flow

1. The browser sends an HTTP POST to `bridge.exe` (for example, `/api/report`).
2. The bridge validates field lengths and characters, then sends a text command over its TCP socket to `server.exe`.
3. TCP establishes a connection before data transfer. The Windows TCP stack uses the three-way handshake (SYN, SYN-ACK, ACK); the application uses Winsock `connect()`/`accept()` and does not manually create those packets.
4. The bridge sends the complete command and newline. Both bridge and server use send-all/read-line helpers: TCP is a byte stream, and a single `send()` is not assumed to match one `recv()`.
5. The user selects severity, traffic impact, and whether anyone is injured or in immediate danger. The C server validates those values, assigns an ID, calculates priority from severity and traffic, adds a suggestion, saves the report under a critical section, and returns JSON terminated by a newline.
6. The bridge returns the server's response to the browser as HTTP JSON. The page displays the actual response.

The report command is:

```text
REPORT|severity|traffic|road|locality|latitude|longitude|description|immediateDanger
```

Other report-related commands are `LIST`, `DETAIL|report-id`, `STATUS|report-id|status`, and `CHECK|road|locality`. `PING` tests TCP reachability; `STATS` returns the server's configured ports and a live count of active TCP sockets.

Both the terminal and website ask for severity (Low/Medium/High), traffic impact (Low/Medium/High), and whether anyone is injured or in immediate danger (Yes/No). Severity is selected by the user; it is not automatically inferred. The server calculates priority from severity plus traffic, where Low=1, Medium=2, High=3: total 2=LOW, 3-4=MEDIUM, 5=HIGH, 6=CRITICAL. A Yes danger answer adds urgent safety guidance, but does not silently change the selected severity or priority. The guidance clarifies that this demo does not dispatch emergency help. New reports start as `Pending`; allowed updates are `Pending`, `Under Review`, `In Progress`, and `Resolved`.

## UDP alert flow

The terminal can use UDP independently of its TCP connection. The server must still be running and reachable on UDP port 9091.

1. In `client.exe`, use `udp` and enter road, locality, severity, traffic impact, and whether anyone is injured or in immediate danger.
2. The client sends `ALERT_V2|severity|traffic|danger|road|locality` as one UDP datagram. The browser asks for the same fields.
3. The server validates and stores the alert as `Pending`, assigns an ID such as `UDP-000001`, then replies `ACK|OK|id`.
4. Use `udp-list` to request recent alerts and their IDs/statuses over UDP.
5. Use `udp-status` and enter an alert ID and one of `Pending`, `Under Review`, `In Progress`, or `Resolved`. The server updates the in-memory alert and acknowledges the new status.

The terminal waits up to three seconds for a response. An acknowledgement confirms that the server processed that request, but UDP can still lose the request or response; a timeout means the result is unknown. The browser bridge sends alerts without waiting for this acknowledgement, so its UI still describes delivery as unconfirmed. Alerts are separate from pothole reports and only the ten most recent are retained in memory.

## Multiple clients and shared data

The TCP server has a 20-connection limit and one Windows handler thread per accepted connection. A critical section protects the active client slots; separate critical sections protect report and UDP alert arrays. The browser bridge serializes operations made through an individual browser session's TCP socket. Multiple browser sessions and CLI clients can still communicate with the central server.

The network panel's active-client number is read from `server.c` using `STATS`. It counts currently accepted TCP sockets, including the bridge's persistent connection for the browser session that requested the count; it is not a count of human users or browser tabs.

## Build on Windows with MSYS2 UCRT64 GCC

Open the **MSYS2 UCRT64** terminal, change to the project root (adjust the drive/path if the project is elsewhere), and compile:

```sh
cd "/c/All Files/CnsClientServer"
gcc -Wall -Wextra -Werror -o server.exe server.c -lws2_32
gcc -Wall -Wextra -Werror -o bridge.exe bridge.c -lws2_32
gcc -Wall -Wextra -Werror -o client.exe client.c -lws2_32
```

In VS Code, open the project folder and use two separate terminals with the project root as the working directory. Start the server first:

```powershell
.\server.exe
```

In the second terminal, start the bridge:

```powershell
.\bridge.exe
```

Open `http://127.0.0.1:5000/`. Keep both terminals running. Press Ctrl+C in the server terminal to stop the server. Stop the bridge separately.

For the direct command-line client, open another terminal:

```powershell
.\client.exe 127.0.0.1
```

The client supports:

- `report`: enter road, locality, severity, traffic, optional coordinates, and description.
- `list`: retrieve the server's report list.
- `detail`: retrieve one report by ID.
- `status`: request one of the server-allowed statuses.
- `udp`: enter road, locality, severity, traffic impact, and danger/injury, then send the alert by UDP.
- `udp-list`: request recent UDP alerts and their current statuses.
- `udp-status`: change a UDP alert's status without using the TCP connection.
- `quit`: close the client connection.

## Manual demonstration and expected results

### Browser TCP report

1. Start `server.exe` and `bridge.exe`; confirm the server console lists TCP 9090 and UDP 9091 and the portal says the C server is connected.
2. Submit a report in the TCP column.
3. Expect the server console to show a client connection, received `REPORT` command, and response. The page should show the server-created `PTH-...` ID and calculated priority.
4. The report appears in the list and dashboard. Choose a status; the page should confirm the server saved it.

### Two direct TCP clients

1. Start two terminals and run `.\client.exe 127.0.0.1` in each.
2. In Client 1, use `report` and submit a report.
3. In Client 2, use `list`. It should show the same report ID and server-stored data.
4. The server console should show both clients and their commands. The network panel reports active TCP sockets, including bridge sockets if the portal is open.

### UDP alert

1. Use `udp` in `client.exe` to send an alert; note the returned `UDP-...` ID.
2. Use `udp-list` to see the alert and its initial `Pending` status.
3. Use `udp-status`, enter the alert ID, then enter `Resolved`.
4. Use `udp-list` again to verify the updated status. This works even if the client's TCP connection is unavailable.
5. A browser UDP alert can still be sent from the webpage, but that path does not wait for or display the UDP acknowledgement.

### Connectivity and failure

1. Use “Run real TCP test.” It sends `PING` through the bridge to the C TCP server and shows the actual response.
2. Use “Refresh network info” to request server `STATS`, including the current connection count.
3. To test backend failure, stop `server.exe` but leave `bridge.exe` running. The web page may still load because the bridge serves files independently. Health/TCP test/report operations should report the backend offline or an explicit connection/timeout error. A UDP `sendto()` success would still not prove the server received the packet.

### Browser communication log

The page logs explicit user actions such as TCP PING, report/list/detail/status requests, and UDP datagram contents/send result. Automatic polling is intentionally not logged to prevent the display from filling with repetitive background entries. The authoritative low-level server logs are in the `server.exe` console.

## Network concepts and likely viva questions

- **Computer network:** Connected devices exchange data. Here, browser/bridge/server/CLI exchange data over IP.
- **Client:** Initiates requests. Here, the browser and `client.exe` are clients; `bridge.c` is also a TCP client of `server.c`.
- **Server:** Listens and responds. Here, `server.c` accepts TCP and UDP traffic.
- **IP address:** Network-layer host/interface address. `127.0.0.1` is local loopback; `0.0.0.0` means bind to all local interfaces and is not a destination clients should use.
- **Port:** Identifies a transport endpoint/service. This project uses 5000 (HTTP bridge), 9090 (TCP server), and 9091 (UDP listener).
- **Socket:** An OS networking endpoint/handle. Winsock sockets use addresses that include an IP address and port.
- **TCP:** Connection-oriented transport with ordered, reliable byte-stream delivery while connected. NetLink uses it for report operations and server replies.
- **UDP:** Connectionless datagram transport without delivery/order/duplicate guarantees. NetLink uses it for quick alerts.
- **HTTP:** Application-layer request/response protocol. Browser traffic to `bridge.exe` uses HTTP over TCP.
- **Winsock:** Windows API for socket networking; C code initializes it with `WSAStartup`.
- **Three-way handshake:** TCP setup sequence SYN, SYN-ACK, ACK performed by the operating system before application data.
- **Connection-oriented/connectionless:** TCP establishes a connection; UDP sends datagrams without one.
- **Reliable/best effort:** TCP retransmits/orders bytes; UDP makes no such guarantee. TCP does not guarantee the application accepted a request unless the application returns a response.
- **Client-server architecture:** Clients request a central service; the server's in-memory report array is authoritative while the server is running.
- **Concurrency:** Handler threads serve multiple TCP clients; critical sections prevent races while accessing shared data.
- **Request/response:** Client sends a command and server sends a result. Newlines delimit messages because TCP itself has no message boundaries.
- **Localhost/loopback:** `127.0.0.1` routes back to the same computer. Another computer's 127.0.0.1 refers to that other computer, not this server.
- **Server unavailable:** The bridge can serve static files while backend TCP operations fail. The browser should display offline/error state; UDP sends still have no receiver confirmation.

## Known limitations

- Reports, statuses, and recent UDP alerts are only in memory and disappear when `server.exe` restarts. The server holds up to 50 reports and ten recent UDP alerts.
- Status changes have no PIN/authentication; they are for a local classroom demonstration, not production.
- `Resolved` is a simulated status and does not establish that road repair occurred.
- Duplicate matching is an exact case-insensitive road OR locality comparison against unresolved reports; it can produce false matches and does not discard reports.
- Coordinates are optional and entered manually; no map service or browser geolocation feature is used.
- The bridge binds to loopback for the portal. Remote browsers cannot access it without changing the bind/security configuration; do not expose this educational HTTP bridge directly to an untrusted network.
- UDP alerts are not stored as reports, are limited to the ten most recent in-memory alerts, and have no retry or deduplication. The terminal client uses application-level acknowledgements, but UDP itself remains best-effort; status changes are also unauthenticated and intended only for a local classroom demonstration.
- The C bridge uses a small project-specific HTTP/JSON implementation, not a production web framework. Do not treat it as hardened for public deployment.
- The server still accepts older generic commands (HELLO, TIME, ECHO, HELP, QUIT), and the bridge retains legacy chat-style endpoints. They are not required by the current pothole UI.
