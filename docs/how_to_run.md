# NetLink — How to Run (Quick Terminal Commands)

---

### Option 1: One-Click Startup (Recommended)

Run from PowerShell or Command Prompt in the project directory:

```powershell
.\start.bat
```

---

### Option 2: Manual Terminal Commands

#### 1. Compile All Programs (Run once)

```powershell
gcc -o server.exe server.c -lws2_32
gcc -o bridge.exe bridge.c -lws2_32
gcc -o client.exe client.c -lws2_32
```

#### 2. Start Core Server (Terminal 1)

```powershell
.\server.exe
```
*(Listens on TCP `9090` and UDP `9091`)*

#### 3. Start HTTP Bridge (Terminal 2)

```powershell
.\bridge.exe
```
*(Listens on HTTP `5000`)*

#### 4. Open Web Portal (Terminal 3 or Browser)

```powershell
start http://127.0.0.1:5000/
```

#### 5. (Optional) Run CLI Client (Terminal 4)

```powershell
.\client.exe
```

---

### Stop All Running Servers

To instantly kill all background NetLink processes:

```powershell
Stop-Process -Name "server", "bridge", "client" -Force -ErrorAction SilentlyContinue
```

---

### Fix Port in Use (Error 10048)

If a port is locked from a previous run:

```powershell
Stop-Process -Name "server", "bridge" -Force -ErrorAction SilentlyContinue
```
