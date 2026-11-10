# NetLink — Technical Implementation Guide: AI Pothole Image Recognition & Automatic GPS Location Tracking

> **Course / Project:** Computer Networks (CNS AAT)  
> **System:** NetLink – Pothole Reporting System  
> **Core Architecture:** 3-Tier C/Winsock Client-Gateway-Daemon Architecture  
> **Document Purpose:** Comprehensive technical explanation of the AI image recognition and GPS tracking subsystems for project review, evaluation, and viva defense.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Section One: AI-Based Pothole Image Recognition](#2-section-one-ai-based-pothole-image-recognition)
   - [2.1 Purpose & Motivation](#21-purpose--motivation)
   - [2.2 Dataset & Provenance](#22-dataset--provenance)
   - [2.3 Model Architecture](#23-model-architecture)
   - [2.4 Model Training & Empirical Evaluation](#24-model-training--empirical-evaluation)
   - [2.5 TensorFlow.js Browser Integration](#25-tensorflowjs-browser-integration)
   - [2.6 Complete Image Detection & Upload Lifecycle](#26-complete-image-detection--upload-lifecycle)
   - [2.7 Technologies & Files Used](#27-technologies--files-used)
   - [2.8 Limitations & Edge Cases](#28-limitations--edge-cases)
3. [Section Two: Automatic GPS Location Detection & Tracking](#3-section-two-automatic-gps-location-detection--tracking)
   - [3.1 Purpose & Motivation](#31-purpose--motivation)
   - [3.2 Browser Geolocation API](#32-browser-geolocation-api)
   - [3.3 Reverse Geocoding via OpenStreetMap Nominatim](#33-reverse-geocoding-via-openstreetmap-nominatim)
   - [3.4 Form Autofill & User Edit Protection](#34-form-autofill--user-edit-protection)
   - [3.5 Interactive Leaflet Map Preview](#35-interactive-leaflet-map-preview)
   - [3.6 Complete GPS & Reporting Workflow](#36-complete-gps--reporting-workflow)
   - [3.7 Technologies & Files Used](#37-technologies--files-used)
   - [3.8 Error Handling & Edge Cases](#38-error-handling--edge-cases)
   - [3.9 Mobile Browser Compatibility & Secure Contexts](#39-mobile-browser-compatibility--secure-contexts)
4. [Section Three: How Both Features Work Together](#4-section-three-how-both-features-work-together)
   - [4.1 The Synergistic Pipeline](#41-the-synergistic-pipeline)
   - [4.2 Unified End-to-End Submission Walkthrough](#42-unified-end-to-end-submission-walkthrough)
5. [Section Four: Architectural Integrity & Network Protocol Evolution](#5-section-four-architectural-integrity--network-protocol-evolution)
   - [5.1 Preservation of C/Winsock Architecture](#51-preservation-of-cwinsock-architecture)
   - [5.2 End-to-End Network Data Flow Diagram](#52-end-to-end-network-data-flow-diagram)
   - [5.3 Protocol Evolution: REPORT, REPORT_V2, and REPORT_V3](#53-protocol-evolution-report-report_v2-and-report_v3)
   - [5.4 Concurrency & Critical Section Safety](#54-concurrency--critical-section-safety)
6. [Section Five: Feature Comparison Matrix](#6-section-five-feature-comparison-matrix)
7. [Section Six: Professor Review & Viva Preparation Guide](#7-section-six-professor-review--viva-preparation-guide)

---

## 1. Executive Overview

NetLink is an academic Computer Networks project implementing a full-stack, distributed **Pothole Reporting and Civic Alert System**. Its networking foundation is written from scratch in **C using Windows Sockets 2 (Winsock)**, structured as a 3-tier topology:

```
[ Web Browser Client ]
       │  HTTP / REST (JSON)
       ▼
[ C HTTP Bridge: Port 5000 ] (bridge.c)
       │  Custom Text Protocol over TCP Stream (Port 9090)
       │  Connectionless Datagrams over UDP (Port 9091)
       ▼
[ C Core Backend Daemon ] (server.c)
       │
       ▼
[ In-Memory Thread-Safe Data Store ]
```

Following Review-1, two major modern capabilities were requested to elevate the system from a manual text intake form to an intelligent, automated civic incident responder:

1. **AI-Based Pothole Image Recognition**: Automatically analyzes uploaded road photographs directly on the client machine using a Deep Convolutional Neural Network (CNN) in TensorFlow.js, determining whether a pothole is present with exact confidence probability before submission.
2. **Automatic GPS Location Detection & Reverse Geocoding**: Uses the browser's hardware Geolocation API to capture precise latitude, longitude, and accuracy radius, queries OpenStreetMap Nominatim to resolve human-readable road and locality names, displays an interactive Leaflet map preview, and transmits coordinates to the C server via an upgraded `REPORT_V3` protocol.

**Crucial Architectural Rule Preserved:**  
Neither addition replaced or bypassed the core C networking backend. No external frameworks (Node.js, Flask, Django, Express, MongoDB) were introduced. All backend logic, socket management, thread concurrency, and protocol framing remain implemented in pure C.

---

## 2. Section One: AI-Based Pothole Image Recognition

### 2.1 Purpose & Motivation

In traditional road maintenance portals, users manually type descriptions of road hazards. This creates three critical problems:
1. **False or Spam Submissions**: Users might submit photos of clean roads, indoor spaces, or irrelevant objects.
2. **Ambiguous Descriptions**: A citizen may report a "huge crater" when it is merely a minor asphalt patch, or underestimate severe vehicular hazards.
3. **Manual Verification Bottlenecks**: Civic authorities must manually inspect every submission to confirm if a road hazard genuinely exists.

The AI Image Recognition feature addresses this by performing an automated preliminary verification right in the citizen's browser. When a user attaches a photo, the AI immediately classifies the image into **Pothole Detected** or **No Pothole Detected** and computes an exact statistical confidence percentage.

---

### 2.2 Dataset & Provenance

To avoid fabricated or synthetic data, the model was trained using an authentic, publicly accessible academic benchmark dataset from the Hugging Face Hub:

* **Dataset Identifier:** `taroii/pothole-detection`
* **Repository Link:** [https://huggingface.co/datasets/taroii/pothole-detection](https://huggingface.co/datasets/taroii/pothole-detection)
* **Licence:** Open Public / Academic Research Use
* **Total Images Available:** 437 real-world photographs taken across urban and rural roads under varied lighting, shadows, and asphalt textures.
* **Target Classes:**
  * `0` = **No Pothole** (Clean, undamaged roads, normal asphalt surfaces, speed breakers, lane markings).
  * `1` = **Pothole** (Cratered surfaces, deep road cavities, edge breakages, fractured asphalt).
* **Data Splits (Stratified):**
  * **Training Set:** 310 images (used to optimize network weights).
  * **Validation Set:** 55 images (used during training to monitor generalization and prevent overfitting).
  * **Test Set:** 72 unseen images (46 potholes, 26 normal roads; strictly held out for final empirical evaluation).

---

### 2.3 Model Architecture

The model is a **Deep Convolutional Neural Network (CNN)**.

#### What is a CNN?
A Convolutional Neural Network is a class of artificial neural networks designed specifically for processing visual data (images). Unlike standard neural networks that flatten an image into a simple 1D array of numbers (losing all spatial geometry), a CNN uses small sliding windows called **kernels (filters)** that move across the image pixels to detect visual features:
- Early layers detect low-level edges, asphalt lines, and dark-light boundaries.
- Middle layers combine edges into textures, surface rough spots, and pavement contours.
- Late layers recognize complete structural patterns, such as the circular depressions, rough cracked perimeters, and internal shadows typical of a pothole.

#### Architectural Breakdown (`build_pothole_cnn()` in `train_model.py`)

```
Input Image [224 × 224 × 3 RGB] (Normalized to [0.0, 1.0])
       │
       ▼
[ Conv2D (32 filters, 3×3, ReLU, Same Padding) ] ──► Extracts basic surface edges
       │
[ MaxPooling2D (2×2) ] ──► Reduces spatial size to 112 × 112
       │
       ▼
[ Conv2D (64 filters, 3×3, ReLU, Same Padding) ] ──► Extracts corner & texture patterns
       │
[ MaxPooling2D (2×2) ] ──► Reduces spatial size to 56 × 56
       │
       ▼
[ Conv2D (128 filters, 3×3, ReLU, Same Padding) ] ──► Extracts cavity & perimeter features
       │
[ MaxPooling2D (2×2) ] ──► Reduces spatial size to 28 × 28
       │
       ▼
[ Conv2D (128 filters, 3×3, ReLU, Same Padding) ] ──► Deep structural representation
       │
[ MaxPooling2D (2×2) ] ──► Reduces spatial size to 14 × 14
       │
       ▼
[ Flatten Layer ] ──► Transforms 14 × 14 × 128 into a 1D vector of 25,088 features
       │
       ▼
[ Dense Layer (128 units, ReLU) ] ──► Fully connected reasoning over extracted features
       │
[ Dropout (0.5) ] ──► Randomly zeroes 50% of units during training to prevent memorization (overfitting)
       │
       ▼
[ Dense Layer (1 unit, Sigmoid) ] ──► Single scalar output probability in range [0.0, 1.0]
```

#### Key Technical Terms:
- **ReLU (Rectified Linear Unit):** An activation function ($f(x) = \max(0, x)$) that introduces non-linearity, allowing the network to learn complex patterns without computational slowdown.
- **MaxPooling:** A downsampling operation that selects the maximum pixel value in each $2\times 2$ block, reducing data dimensions while preserving the strongest detected features.
- **Dropout (0.5):** A regularization technique where half the neurons are randomly deactivated during each training step, forcing the network to learn robust features that do not rely on any single neuron.
- **Sigmoid Output:** A mathematical function ($\sigma(z) = \frac{1}{1 + e^{-z}}$) that squashes the final score into a continuous probability value between `0.0` (definitely no pothole) and `1.0` (definitely a pothole).

---

### 2.4 Model Training & Empirical Evaluation

The training process is automated via `train_model.py`.

#### Training Parameters:
- **Optimizer:** Adam (Adaptive Moment Estimation) with a learning rate of $3 \times 10^{-4}$ ($0.0003$).
- **Loss Function:** Binary Cross-Entropy (the standard statistical measure of error for two-class probability predictions).
- **Batch Size:** 16 images per step.
- **Epochs:** 12 complete passes over the training dataset.
- **Total Training Duration:** 114.9 seconds on standard hardware.

#### Empirical Evaluation Results on 72 Unseen Test Photographs:
These metrics are recorded inside `web/model/metadata.json`:

| Metric | Score | Explanation |
|:---|:---:|:---|
| **Test Accuracy** | **61.11%** | Percentage of unseen test images correctly classified overall. |
| **Validation Accuracy** | **85.45%** | Peak accuracy achieved on the validation split during training. |
| **Test Precision** | **80.00%** | When the model declares "Pothole Detected", it is correct 80% of the time (low false-alarm rate). |
| **Test Recall** | **52.17%** | Percentage of all actual potholes present in the test set that the model successfully caught. |
| **Test F1-Score** | **63.16%** | The harmonic mean of precision and recall. |
| **Test Loss** | **0.8033** | Binary cross-entropy loss value on test set. |

#### Confusion Matrix (72 Unseen Test Samples):
- **True Positives (TP): 24** — Actual potholes correctly identified as potholes.
- **True Negatives (TN): 20** — Clean roads correctly identified as clean roads.
- **False Positives (FP): 6** — Clean roads mistakenly flagged as potholes.
- **False Negatives (FN): 22** — Potholes missed by the classifier (evaluated $< 0.5$).

The high precision (**80.00%**) is particularly beneficial for civic operations: when NetLink alerts authorities to a pothole, there is an 80% empirical probability that a true road defect exists.

---

### 2.5 TensorFlow.js Browser Integration

Rather than deploying an external Python server or calling an expensive cloud vision API, NetLink converts the trained Keras model into **TensorFlow.js LayersModel** format (`model.json` + binary weight shards).

#### How Browser-Side Execution Works:
1. **Zero Cloud Dependency:** Inference runs 100% inside the client's web browser using client CPU/WebGL resources via TensorFlow.js (`tfjs@4.22.0`).
2. **`model.json` (Topology):** Contains the architecture graph (layer names, kernel dimensions, activation functions, and connections).
3. **Weight Shards (`group1-shard[1-4]of4.bin`):** Binary files storing the floating-point filter weights (~13.3 MB total).
4. **Memory Leak Prevention (`tf.tidy()`):** In JavaScript, WebGL tensors allocated on GPU memory do not get garbage-collected automatically. NetLink wraps all tensor allocations in `tf.tidy()`, ensuring GPU buffers are freed immediately after prediction.
5. **Model Caching:** The model is preloaded on page startup and cached in a global variable (`potholeModel`). Subsequent image selections run inference in milliseconds without re-fetching model files.

---

### 2.6 Complete Image Detection & Upload Lifecycle

```
[ Step 1: User Selects File ] (Click or Drag & Drop in UI)
             │
             ▼
[ Step 2: Client-side Validation ] (Type: JPG/PNG/WEBP, Max: 5 MB)
             │
             ▼
[ Step 3: Base64 Preview & Async Image Decode ]
  • FileReader reads DataURL
  • await img.decode() ensures browser bitmap is ready
             │
             ▼
[ Step 4: TensorFlow.js Inference ]
  • tf.tidy() normalizes pixels: [224, 224, 3] / 255.0
  • model.predict(tensor) -> sigmoid score s in [0.0, 1.0]
  • Display: s >= 0.5 ? "🔴 Pothole Detected" : "🟢 No Pothole Detected"
  • Confidence: (s * 100).toFixed(2)%
             │
             ▼
[ Step 5: Background Upload to C HTTP Bridge ]
  • POST /api/upload-image (MIME type + base64 data)
  • bridge.exe decodes base64, generates safe filename "img_abc123.jpg"
  • Saves file into uploads/ directory; returns { ok: true, imageRef: "..." }
             │
             ▼
[ Step 6: Submission over TCP ]
  • User completes form and clicks Submit
  • bridge.exe formats REPORT_V2 or REPORT_V3 command with imageRef
  • Transmits to server.exe on TCP port 9090
             │
             ▼
[ Step 7: Record Storage & Display ]
  • server.exe stores imageRef in reports[i] struct
  • In All Reports / Detail view: thumbnail & full image rendered via GET /uploads/<imageRef>
```

---

### 2.7 Technologies & Files Used

| Component / Technology | File / Location | Functional Role |
|:---|:---|:---|
| **Python 3 / Keras** | `train_model.py` | Model definition, dataset loading, training loop, evaluation. |
| **TensorFlow.js Converter** | `train_model.py` | Exports Keras `.keras` model into WebGL-compatible `model.json` and `.bin` shards. |
| **Model Storage** | `web/model/` | Stores `model.json`, 4 weight shards, `metadata.json`, and sample test image. |
| **Client Inference Engine** | `web/script.js` | Loads model via `tf.loadLayersModel`, preprocesses DOM image, runs inference, updates UI. |
| **Image Upload Gateway** | `bridge.c` | Implements `/api/upload-image`, base64 decoding (`b64_decode`), directory creation, and file persistence. |
| **Image Server** | `bridge.c` | Implements `serve_upload_file()`, streaming files from `uploads/` with proper `image/jpeg` or `image/png` headers. |
| **TCP Report Daemon** | `server.c` | Stores `image_ref` in `Report` struct; returns `imageRef` in JSON responses. |
| **Uploaded Files Directory** | `uploads/` | Local directory storing submitted road photos. |

---

### 2.8 Limitations & Edge Cases

1. **Classification vs. Object Detection:**  
   The model is an *image classifier*, not an *object detector* (like YOLO or Faster R-CNN). It answers *"Does this photo contain a pothole?"* but does not draw bounding boxes or measure depth/width in centimeters.
2. **False Positives on Complex Shadows:**  
   Sharp shadows cast by trees, overhead bridges, or dark water patches on asphalt can occasionally produce false positives (reflected in the 6 false positives on the test set).
3. **Severe Weather & Night Conditions:**  
   Photographs taken in heavy rain or unlit night conditions with severe glare may reduce detection confidence.
4. **Advisory Role:**  
   The AI serves as a *decision-support filter*, not an absolute authority. If a citizen's legitimate pothole photo is classified as "No Pothole" (false negative), NetLink displays a warning dialog (`#aiRejectWarning`) that allows the user to click **Submit Anyway** to ensure no genuine road hazard is suppressed.

---

## 3. Section Two: Automatic GPS Location Detection & Tracking

### 3.1 Purpose & Motivation

When road hazards are reported manually, location errors are the number one cause of municipal inaction:
- Citizens often do not know the official municipal road name or sector number.
- Landmark descriptions (e.g., *"near the big banyan tree"*) are impossible for repair crews to pinpoint.
- Typing coordinates manually ($12.9716, 77.5946$) on mobile keyboards is tedious and error-prone.

The **Automatic GPS Location Tracker** resolves this by reading the device's hardware satellite/network coordinates with a single click, resolving human-readable street names automatically, and transmitting both to the C backend.

---

### 3.2 Browser Geolocation API

NetLink queries the hardware positioning unit using the standardized W3C Geolocation API:

```javascript
navigator.geolocation.getCurrentPosition(successCallback, errorCallback, {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0
});
```

#### What These Options Mean:
- **`enableHighAccuracy: true`**: Instructs the operating system to power on dedicated GPS/GNSS receivers rather than relying solely on coarse IP-lookup or cell-tower triangulation.
- **`timeout: 15000` (15 seconds)**: Ensures the interface will not hang indefinitely if satellite lock is unavailable.
- **`maximumAge: 0`**: Prevents the browser from returning a stale, cached location from minutes earlier.

#### Understanding the Output:
- **Latitude & Longitude:** Coordinate pair identifying an exact point on Earth's surface (stored to 6 decimal places, providing sub-meter precision).
- **GPS Accuracy Radius ($\pm X$ metres):** Returned by the browser operating system as `coords.accuracy`. An accuracy of $\pm 8\text{ m}$ means there is a 68% statistical probability that the user is located within a circle of radius 8 meters centered on the reported coordinates.

---

### 3.3 Reverse Geocoding via OpenStreetMap Nominatim

Raw coordinates (`28.6139, 77.2090`) are essential for computers and mapping applications, but civic workers require readable street addresses.

**Reverse Geocoding** is the process of converting geographic coordinates into human-readable postal address components (Road Name, Suburb, Locality, City).

NetLink integrates **OpenStreetMap Nominatim**:
```text
GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=LATITUDE&lon=LONGITUDE&zoom=18&addressdetails=1
```

#### Strict Address Field Hierarchy:
Different countries and administrative zones structure OpenStreetMap address tags differently. To prevent placing a city name into a road field or fabricating addresses, NetLink uses a deterministic extraction hierarchy:

1. **Road Name Extraction Hierarchy:**
   $$\text{addr.road} \longrightarrow \text{addr.pedestrian} \longrightarrow \text{addr.residential} \longrightarrow \text{addr.highway} \longrightarrow \text{addr.footway} \longrightarrow \text{addr.path} \longrightarrow \text{addr.cycleway}$$
   *Rule:* City, district, and country tags are **never** placed into the Road Name field. If no valid street tag exists, the field is left blank for manual entry.
2. **Locality / Area Extraction Hierarchy:**
   $$\text{addr.suburb} \longrightarrow \text{addr.neighbourhood} \longrightarrow \text{addr.quarter} \longrightarrow \text{addr.locality} \longrightarrow \text{addr.village} \longrightarrow \text{addr.town} \longrightarrow \text{addr.city\_district} \longrightarrow \text{addr.city}$$

#### Compliance with Nominatim Policy:
- Requests include appropriate headers.
- Requests are triggered **only upon explicit user interaction** (clicking "Detect My Location" or "Refresh GPS"), strictly complying with Nominatim's 1-request-per-second rate limit.

---

### 3.4 Form Autofill & User Edit Protection

A common UI frustration occurs when an automated tool overwrites a user's carefully typed input. NetLink implements **state tracking** via `userHasEditedRoad` and `userHasEditedLocality`:

- **Case 1 (Fresh Form):** If the user has not typed anything, clicking "Detect My Location" immediately autofills the Road and Locality inputs.
- **Case 2 (User Already Typed):** If the citizen already typed a specific landmark (e.g., *"Opposite Gate 4"*), GPS detection will **not** overwrite their text. Instead, NetLink displays an address suggestion banner (`#geoSuggestionBanner`) with an explicit button:  
  `Detected: "Kartavya Path, Raisina Hill" [Apply to Form]`  
  The user retains full control.

---

### 3.5 Interactive Leaflet Map Preview

Upon successful coordinate detection, NetLink renders an embedded interactive map using **Leaflet 1.9.4** and OpenStreetMap tile layers:
- The map automatically centers at `[latitude, longitude]` with zoom level 16.
- A distinctive marker is dropped at the location.
- Clicking the marker displays an address tooltip with exact coordinates and accuracy radius.
- Re-detecting location animates the map to the updated coordinates.

---

### 3.6 Complete GPS & Reporting Workflow

```
1. Citizen clicks [ 📍 Detect My Location ]
                  │
                  ▼
2. Browser displays native permission prompt ("Allow NetLink to access your location?")
                  │
                  ▼
3. Device GPS hardware locks coordinates:
   • Latitude: 12.971600
   • Longitude: 77.594600
   • Accuracy: ±12 m (High Accuracy tier)
                  │
                  ▼
4. Coordinates rendered in UI Readout Grid & hidden inputs
                  │
                  ▼
5. Asynchronous GET to OpenStreetMap Nominatim reverse geocoder
                  │
                  ▼
6. Road & Locality extracted; Form autofilled (or suggested if already typed)
                  │
                  ▼
7. Leaflet map preview displays marker and OpenStreetMap tile layer
                  │
                  ▼
8. Citizen reviews form, types description, and clicks [ Submit Report ]
                  │
                  ▼
9. POST /api/report sent to bridge.exe (contains lat, lon, accuracy, imageRef)
                  │
                  ▼
10. bridge.exe validates ranges (-90 <= lat <= 90, -180 <= lon <= 180, acc >= 0)
                  │
                  ▼
11. bridge.exe formats newline-delimited TCP command:
    REPORT_V3|High|Medium|MG Road|Koramangala|12.971600|77.594600|12.00|Desc|No|img_abc.jpg\n
                  │
                  ▼
12. server.exe parses stream, computes priority, stores record in reports[] array
                  │
                  ▼
13. Report rendered in All Reports with live Google Maps deep link:
    https://www.google.com/maps?q=12.971600,77.594600
```

---

### 3.7 Technologies & Files Used

| Technology / Component | File / Location | Functional Role |
|:---|:---|:---|
| **W3C Geolocation API** | `web/script.js` | Direct browser hardware communication (`getCurrentPosition`). |
| **Nominatim API** | `web/script.js` | Public OpenStreetMap reverse geocoding gateway. |
| **Leaflet v1.9.4** | `web/index.html`, `web/script.js` | Client-side lightweight interactive map rendering. |
| **UI Component & Styling** | `web/index.html`, `web/style.css` | Location Tracker card, readout grid, pulsating status dots, map container. |
| **Bridge Protocol Handler** | `bridge.c` | Extracts `accuracy` from JSON, validates numbers, constructs `REPORT_V3`. |
| **TCP Core Server** | `server.c` | Parses `REPORT_V3`, stores `latitude`, `longitude`, `accuracy` in `Report` struct, outputs JSON. |

---

### 3.8 Error Handling & Edge Cases

| Scenario | System Behavior & User Feedback |
|:---|:---|
| **Permission Denied** (`code 1`) | Status displays: *"Location permission denied. Please allow location access in your browser settings."* Form remains open for manual entry. |
| **GPS Unavailable** (`code 2`) | Status displays: *"Location unavailable. Ensure device GPS / location services are turned on."* |
| **Request Timeout** (`code 3`) | Status displays: *"Location request timed out. Please try again or enter details manually."* |
| **Poor Accuracy ($> 50\text{ m}$)** | Status displays warning badge: *(Low accuracy — consider testing outdoors)* with option to retry. |
| **Nominatim Offline / Timeout** | Status displays: *"Coordinates saved ($\pm 12\text{m}$). Reverse geocoding failed; please enter road and locality manually."* Coordinates remain saved. |
| **Rural / Unmapped Road** | Status displays: *"Coordinates saved. Road name could not be identified — please enter manually."* |
| **Submission Without GPS** | Fully supported. If coordinates are blank, report is submitted via legacy `REPORT` protocol with `null` coordinates. |

---

### 3.9 Mobile Browser Compatibility & Secure Contexts

#### The W3C Secure Context Restriction:
Under the modern W3C security specification, all major mobile browsers (Google Chrome on Android, Apple Safari on iOS) enforce a strict security policy:  
**`navigator.geolocation` is completely disabled on non-secure origins.**

- `http://localhost:5000` and `http://127.0.0.1:5000` are treated by browser engines as **Secure Contexts by definition**.
- If a mobile phone accesses the laptop over a local Wi-Fi IP (e.g., `http://192.168.1.15:5000`), mobile browsers flag the connection as insecure HTTP and block GPS access.

#### How to Test on a Physical Phone with Full GPS Support:

1. **Method A: Chrome USB Port Forwarding (Recommended — 100% True Secure Context):**
   - Connect your Android phone to the PC with a USB cable (USB Debugging enabled).
   - In desktop Chrome, open `chrome://inspect/#devices`.
   - Click **Port forwarding...**, add rule: `5000` $\longrightarrow$ `localhost:5000`.
   - On the phone, browse to `http://localhost:5000/`. Because the domain is literally `localhost`, mobile Chrome enables hardware GPS and camera access natively!
2. **Method B: Chrome Mobile Insecure Flag:**
   - In phone Chrome, navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
   - Add `http://<LAPTOP_IP>:5000`, set to **Enabled**, and relaunch Chrome.

*Current Verification Status:* Desktop browser GPS and loopback mobile emulation are verified and tested. Final physical-device field testing in outdoor moving traffic remains to be evaluated during final trial runs.

---

## 4. Section Three: How Both Features Work Together

### 4.1 The Synergistic Pipeline

The two additions form a complete, complementary incident intake pipeline:

| Dimension | AI Pothole Recognition | GPS Location Tracker |
|:---|:---|:---|
| **Question Answered** | **"WHAT is the hazard?"** | **"WHERE is the hazard?"** |
| **Nature of Data** | Visual evidence & classification score | Spatial coordinates & street address |
| **Execution Point** | Client-side TensorFlow.js WebGL | Hardware GNSS receiver + Nominatim API |
| **Output to Server** | `imageRef` (e.g., `"img_0000c889.jpg"`) | `latitude`, `longitude`, `accuracy` |

Together, they eliminate both fake reports and inaccurate locations before data ever reaches the C backend.

---

### 4.2 Unified End-to-End Submission Walkthrough

```mermaid
sequenceDiagram
    autonumber
    actor User as Citizen (Browser)
    participant TF as TensorFlow.js (Client)
    participant Geo as Geolocation & Nominatim
    participant Bridge as C HTTP Bridge (bridge.c:5000)
    participant Server as C TCP Server (server.c:9090)

    User->>Geo: Click "Detect My Location"
    Geo-->>User: Coordinates (lat, lon, accuracy) + Road/Locality autofilled
    User->>TF: Selects road photo
    TF-->>User: Instant prediction ("🔴 Pothole Detected", 84.72% confidence)
    User->>Bridge: Background upload image (POST /api/upload-image)
    Bridge-->>User: Return imageRef ("img_0000a1b2.jpg")
    User->>Bridge: Click "Submit Report" (POST /api/report with GPS + imageRef)
    Note over Bridge: Validates coordinates, accuracy & imageRef
    Bridge->>Server: TCP Stream: REPORT_V3|Severity|Traffic|Road|Locality|Lat|Lon|Acc|Desc|Danger|imageRef\n
    Note over Server: CriticalSection lock, computes priority score, assigns PTH-000001
    Server-->>Bridge: TCP Stream: {"ok":true,"report":{"id":"PTH-000001",...}}\n
    Bridge-->>User: HTTP 200 JSON Response
    User->>User: Form resets; Card appears with Leaflet pin & Google Maps link
```

---

## 5. Section Four: Architectural Integrity & Network Protocol Evolution

### 5.1 Preservation of C/Winsock Architecture

A core requirement of this academic Computer Networks demonstration was to maintain the native C Winsock foundation. The system separates high-bandwidth media and low-latency protocol framing cleanly:

1. **Heavy Binary Data (Images):** Transmitted via HTTP multipart/base64 to `bridge.c` and stored as static files in `uploads/`. Heavy JPEG blobs are **never** dumped into the high-performance TCP server stream.
2. **Lightweight Control & State (TCP):** The C server deals strictly with compact, newline-delimited command strings containing scalar values and file reference handles (`imageRef`).
3. **No External Web Frameworks:** The entire HTTP parsing, routing, header emission, and socket translation is handled in native C.

---

### 5.2 End-to-End Network Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      WEB BROWSER (Client)                       │
│  ┌───────────────────────┐         ┌─────────────────────────┐  │
│  │ TensorFlow.js (WebGL) │         │ Leaflet / Nominatim API │  │
│  │ (Client-side AI Model)│         │ (GPS Coordinates / Map) │  │
│  └───────────┬───────────┘         └────────────┬────────────┘  │
└──────────────┼──────────────────────────────────┼───────────────┘
               │ 1. POST /api/upload-image        │ 2. POST /api/report
               ▼ (Base64 JPEG Payload)            ▼ (JSON: coords, acc, imageRef)
┌─────────────────────────────────────────────────────────────────┐
│                    C HTTP BRIDGE (bridge.exe)                   │
│                       Listening on :5000                        │
│                                                                 │
│  • Writes decoded image to: uploads/img_xxxx.jpg                │
│  • Validates: -90<=lat<=90, -180<=lon<=180, acc>=0              │
│  • Formats command: REPORT_V3|...|lat|lon|acc|...|imageRef\n    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 3. Winsock TCP Socket (Port 9090)
                                ▼ (Newline-framed text stream)
┌─────────────────────────────────────────────────────────────────┐
│                  C CORE BACKEND DAEMON (server.exe)             │
│                       Listening on :9090                        │
│                                                                 │
│  • recv_line() reads complete message terminated by '\n'        │
│  • process_report_v3() parses fields using strchr()             │
│  • EnterCriticalSection(&reports_lock) prevents data races      │
│  • Computes deterministic Priority Score (Severity + Traffic)   │
│  • Stores in Report reports[MAX_REPORTS] array in RAM           │
│  • LeaveCriticalSection(&reports_lock)                          │
│  • Formats JSON response line and sends over TCP socket         │
└─────────────────────────────────────────────────────────────────┘
```

---

### 5.3 Protocol Evolution: REPORT, REPORT_V2, and REPORT_V3

To prevent breaking existing native CLI clients (`client.c`), the server implements backward-compatible command dispatching using string prefixes:

```c
// Inside process() in server.c:
if (!strncmp(msg, "REPORT_V3|", 10)) {
    return process_report_v3(msg, resp, n);
} else if (!strncmp(msg, "REPORT_V2|", 10)) {
    return process_report_v2(msg, resp, n);
} else if (!strncmp(msg, "REPORT|", 7)) {
    return process_report(msg, resp, n);
}
```

#### Protocol Specification Comparison:

1. **Legacy `REPORT` Protocol (Plain Text, Original):**
   ```text
   REPORT|severity|traffic|road|locality|latitude|longitude|description|immediateDanger\n
   ```
   *Usage:* Submitted by native terminal CLI clients or text-only web submissions without images or GPS accuracy.
2. **`REPORT_V2` Protocol (Image Evidence Support):**
   ```text
   REPORT_V2|severity|traffic|road|locality|latitude|longitude|description|immediateDanger|imageRef\n
   ```
   *Usage:* Used when photo evidence is uploaded, but no GPS accuracy radius is available.
3. **`REPORT_V3` Protocol (Full AI & GPS Telemetry, Current):**
   ```text
   REPORT_V3|severity|traffic|road|locality|latitude|longitude|accuracy|description|immediateDanger|imageRef\n
   ```
   *Usage:* The unified production protocol carrying high-precision coordinates, GPS accuracy in metres, and photo evidence references.

#### In-Memory Data Structure in `server.c`:
```c
typedef struct {
    char id[20];                           // Formatted ID: "PTH-000001"
    char severity[16];                     // "Low", "Medium", "High"
    char traffic[16];                      // "Low", "Medium", "High"
    char priority[16];                     // "LOW", "MEDIUM", "HIGH", "CRITICAL"
    char explanation[96];                  // Algorithmic explanation
    char suggestion[192];                  // Actionable civic advice
    char road[MAX_LOCATION + 1];           // Street name
    char locality[MAX_LOCATION + 1];       // Suburb / locality
    char description[MAX_DESCRIPTION + 1]; // User remarks
    char status[20];                       // "Pending", "In Progress", etc.
    char image_ref[128];                   // Filename in uploads/ (or empty)
    int priority_score;                    // Sum of severity + traffic weights
    int immediate_danger;                  // 1 = Yes, 0 = No
    int has_coordinates;                   // 1 if lat/lon provided, 0 if null
    double latitude;                       // IEEE 754 64-bit float
    double longitude;                      // IEEE 754 64-bit float
    int has_accuracy;                      // 1 if GPS accuracy provided
    double accuracy;                       // Accuracy radius in metres
    time_t submitted_at;                   // Unix timestamp
    time_t status_updated_at;              // Unix timestamp
} Report;
```

---

### 5.4 Concurrency & Critical Section Safety

The C server spawns a dedicated Windows worker thread (`CreateThread`) for every accepted TCP connection. When multiple citizens submit reports or check for duplicates simultaneously, concurrent threads attempt to read and write to the global `reports[MAX_REPORTS]` array.

To guarantee ACID-like consistency and prevent memory corruption, all report writes and ID increments are wrapped inside Win32 **Critical Sections**:

```c
EnterCriticalSection(&reports_lock);
// Safely increment report count and append to shared memory
snprintf(report.id, sizeof(report.id), "PTH-%06d", next_report_id++);
reports[report_count++] = report;
LeaveCriticalSection(&reports_lock);
```

---

## 6. Section Five: Feature Comparison Matrix

| Attribute | AI Pothole Recognition | GPS Location Tracker |
|:---|:---|:---|
| **Primary Purpose** | Automated visual verification of road defect | Automated physical location identification |
| **Main Technology** | TensorFlow.js (MobileNet/Deep CNN) | W3C Geolocation API + OpenStreetMap Nominatim |
| **Execution Environment**| Client Browser (Local CPU / WebGL) | Browser Hardware GNSS + External HTTP REST |
| **Input Data** | Photographic image (JPG, PNG, WEBP $\le 5\text{MB}$) | Satellite / Wi-Fi positioning hardware signals |
| **Intermediate Processing**| 4-stage Conv2D feature extraction & Sigmoid score | Decimal coordinate extraction & reverse address lookup |
| **Output to User** | `🔴 Pothole` / `🟢 No Pothole` + Confidence % | Road, Locality, Coordinates, Accuracy, Leaflet Map |
| **Network Payload** | Base64 JPEG $\longrightarrow$ stored in `uploads/` | Coordinates + Accuracy float $\longrightarrow$ `REPORT_V3` stream |
| **Backend Integration** | Image token (`imageRef`) stored in `Report` struct | Stored in `Report.latitude`, `longitude`, `accuracy` |
| **Failure Mode** | Warning banner displayed; manual override enabled | Form remains editable; manual location input enabled |

---

## 7. Section Six: Professor Review & Viva Preparation Guide

Here are expected technical questions from Computer Networks evaluators and concise, accurate answers based on the actual codebase:

### Q1: "Why did you run the AI model in the browser instead of writing a Python Flask server?"
> *"Running the model client-side in the browser using TensorFlow.js preserves the project's original 3-tier C/Winsock architecture. If we had introduced Flask or FastAPI, the project would have become a generic Python application rather than a true demonstration of C socket programming. Furthermore, client-side inference eliminates server GPU costs, preserves citizen privacy by keeping raw images on their device until they choose to submit, and avoids sending megabytes of video/image frames through the C TCP server stream."*

### Q2: "Why does the C server not accept base64 image data directly over the TCP port 9090 connection?"
> *"TCP is a stream-oriented protocol. Transmitting multi-megabyte base64 image blobs over the same socket used for high-frequency control messages (like duplicate checking and status updates) would block the server's per-client buffer, increase memory overhead, and complicate newline stream framing. Instead, NetLink uses a standard distributed design: the HTTP bridge stores the binary file in the filesystem, and only passes a compact 32-byte reference handle (`imageRef`) through the C TCP stream."*

### Q3: "What happens if a user submits a report without an internet connection to OpenStreetMap?"
> *"NetLink handles reverse geocoding as a progressive enhancement. If Nominatim is unreachable or times out, the browser still captures the raw GPS coordinates and accuracy radius from the device hardware. The system alerts the user that reverse geocoding failed, autofills the coordinates, and allows the citizen to type the road name manually. The report is still successfully submitted over TCP with full coordinate telemetry."*

### Q4: "How does the C server distinguish between old reports and new reports with GPS accuracy?"
> *"Through protocol versioning. The original implementation used `REPORT\|...`. When image support was introduced, we added `REPORT_V2\|...`. For GPS accuracy support, we added `REPORT_V3\|...`. The server inspects the first tokens of the stream using `strncmp()` and routes the message to the appropriate parser. Older clients continue to work without modification."*

### Q5: "How do you prevent thread race conditions when multiple users submit reports at the same time?"
> *"Every TCP client connection is handled by an independent Windows thread spawned via `CreateThread()`. Shared state—specifically the `reports[]` array and `next_report_id` counter—is strictly guarded by Windows `CRITICAL_SECTION` primitives (`EnterCriticalSection` and `LeaveCriticalSection`). Only one thread can modify the array or allocate a report ID at any given instant."*

---

*Documentation compiled and verified against the NetLink codebase on 2026-11-10.*

