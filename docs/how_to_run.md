# NetLink — How to Run (Quick Terminal Commands)

---

### Option 1: One-Click Startup (Recommended)

Run from PowerShell or Command Prompt in the project directory:

```powershell
.\start.bat
```
*(Or in Command Prompt: `cmd.exe /c start.bat`)*

---

### Option 2: Manual Terminal Commands

#### 1. Compile All C Programs (Run once)

```powershell
gcc -Wall -Wextra -o server.exe server.c -lws2_32
gcc -Wall -Wextra -o bridge.exe bridge.c -lws2_32
gcc -Wall -Wextra -o client.exe client.c -lws2_32
```

#### 2. Start Core Server (Terminal 1)

```powershell
.\server.exe
```
*(Listens on TCP `9090` for reports/management and UDP `9091` for broadcast alerts)*

#### 3. Start HTTP Bridge (Terminal 2)

```powershell
.\bridge.exe
```
*(Listens on HTTP `5000` to serve the web interface, static model shards, upload endpoints, and forward requests to the core server)*

#### 4. Open Web Portal (Browser)

Navigate to:
```
http://127.0.0.1:5000/
```

---

### Option 3: Mobile Device Access & GPS Location Testing

Modern mobile browsers (Chrome, Safari, Edge) strictly enforce the W3C **Secure Context** policy (`window.isSecureContext`): the Geolocation API is disabled over plain HTTP on LAN IP addresses (e.g., `http://192.168.x.x:5000`).

To use real mobile GPS on your phone with this C backend:

#### Method A: Chrome USB Port Forwarding (Recommended — 100% Secure Context)
1. Connect your Android phone to your laptop via USB cable with **USB Debugging** enabled.
2. In Google Chrome on your laptop, open:
   ```
   chrome://inspect/#devices
   ```
3. Click **Port Forwarding...**.
4. Add a rule:
   - **Port:** `5000`
   - **IP address and port:** `localhost:5000`
   - Check **Enable port forwarding** and click **Done**.
5. On your phone's Chrome browser, navigate to:
   ```
   http://localhost:5000/
   ```
   *Because the URL is `localhost`, Chrome on mobile recognizes it as an official Secure Context, enabling high-accuracy phone GPS and camera upload without needing SSL certificates or third-party servers!*

#### Method B: Chrome Mobile Flag for LAN IP Testing
If testing over Wi-Fi without USB cable:
1. On your phone's Chrome browser, navigate to:
   ```
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```
2. Enable the flag and enter your laptop's LAN address:
   ```
   http://<YOUR_LAPTOP_IP>:5000
   ```
3. Tap **Relaunch**. Chrome will now permit Geolocation on that LAN IP.

---

### GPS Location Tracker & Reverse Geocoding Technical Details

1. **Browser Geolocation API:**
   - Invokes `navigator.geolocation.getCurrentPosition()` with `{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }`.
   - Acquires true hardware GPS/GNSS coordinates (`latitude`, `longitude`) and accuracy radius in metres.
2. **OpenStreetMap Nominatim Reverse Geocoding:**
   - Queries `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=...&lon=...&zoom=18&addressdetails=1`.
   - Extracts road name by strict priority: `road` $\rightarrow$ `pedestrian` $\rightarrow$ `residential` $\rightarrow$ `highway` $\rightarrow$ `footway`.
   - Extracts locality by priority: `suburb` $\rightarrow$ `neighbourhood` $\rightarrow$ `quarter` $\rightarrow$ `locality` $\rightarrow$ `village` $\rightarrow$ `town` $\rightarrow$ `city_district`.
   - Autofills form inputs while preserving user manual edits.
3. **Network Protocol Flow (TCP `REPORT_V3`):**
   - Browser $\rightarrow$ HTTP Bridge (`bridge.c:5000`) via `POST /api/report` (JSON with `latitude`, `longitude`, `accuracy`, `imageRef`).
   - Bridge validates field ranges (`-90 <= lat <= 90`, `-180 <= lon <= 180`, `accuracy >= 0`) and formats:
     ```
     REPORT_V3|severity|traffic|road|locality|lat|lon|accuracy|desc|danger|imageRef\n
     ```
   - Bridge transmits via Winsock TCP stream to Core Daemon (`server.c:9090`).
   - Server decodes, locks shared memory via `CRITICAL_SECTION`, computes priority score, assigns `PTH-XXXXXX`, and stores report.
   - Server returns JSON; Bridge returns HTTP 200; frontend displays stored coordinates with clickable Google Maps link (`https://www.google.com/maps?q=lat,lon`) and compact Leaflet map.

---

### Option 4: (Optional) Run CLI Client (Terminal 3)

```powershell
.\client.exe
```

---

### 🤖 AI Pothole Recognition System

The AI model is pre-trained, packaged, and ready to use in `web/model/`.

#### How to Demonstrate AI Image Recognition:
1. Open the web interface at `http://127.0.0.1:5000/`.
2. Scroll to the **File Formal TCP Report** section.
3. In the **Upload Road Photo for AI Analysis** card, click to select an image or drag-and-drop a road picture (e.g., `web/model/pothole.jpeg`).
4. TensorFlow.js automatically executes client-side inference on the image.
5. The UI shows the real detection result (**Pothole Detected 🔴** or **No Pothole Detected 🟢**) along with the model's confidence percentage and confidence bar.
6. Submit the report: the image is uploaded to `/api/upload-image` on the C bridge, saved in `uploads/`, and its `imageRef` is registered in `server.exe` via `REPORT_V2`.
7. View the report in the **All Reports** table to see the thumbnail and full image in the report details view.

#### (Optional) Retraining the AI Model:
If you want to retrain the neural network on the `taroii/pothole-detection` HuggingFace dataset:

```powershell
pip install tensorflow tensorflowjs datasets pillow
python train_model.py
```
This automatically updates `web/model/model.json`, the binary weight shards, and `metadata.json`.

---

### Stop All Running Servers

To instantly kill all background NetLink processes:

```powershell
Stop-Process -Name "server", "bridge", "client" -Force -ErrorAction SilentlyContinue
```

---

### Fix Port in Use (Error 10048)

If port 9090, 9091, or 5000 is locked from an earlier instance:

```powershell
Stop-Process -Name "server", "bridge" -Force -ErrorAction SilentlyContinue
```
