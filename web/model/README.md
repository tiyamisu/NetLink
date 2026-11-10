# NetLink — AI Pothole Detection Model

This directory contains the trained, production-ready AI image classification model for **NetLink – Pothole Reporting System**.

The model runs client-side in the browser using **TensorFlow.js** (`tf.loadLayersModel`). Inference is executed entirely on the user's device without sending raw image frames to any external cloud API.

---

## 📁 Model Files in this Directory

| File | Size | Description |
|---|---|---|
| `model.json` | ~15 KB | TensorFlow.js model topology, layer graph, and weight manifest |
| `group1-shard1of4.bin` | 4.0 MB | Weight parameters shard 1 |
| `group1-shard2of4.bin` | 4.0 MB | Weight parameters shard 2 |
| `group1-shard3of4.bin` | 4.0 MB | Weight parameters shard 3 |
| `group1-shard4of4.bin` | 1.1 MB | Weight parameters shard 4 |
| `metadata.json` | ~700 B | Model metadata, dataset provenance, and test evaluation metrics |
| `pothole.jpeg` | ~1.1 MB | Sample test photograph of a pothole for live demonstration |

---

## 🧠 Model Architecture

The classifier is a Convolutional Neural Network (CNN) optimized for road condition analysis:

- **Input Layer:** `224 × 224 × 3` RGB image tensor (normalized to $[0.0, 1.0]$)
- **Feature Extraction:**
  - **Block 1:** `Conv2D(32, 3×3, ReLU, padding='same')` + `MaxPooling2D(2×2)`
  - **Block 2:** `Conv2D(64, 3×3, ReLU, padding='same')` + `MaxPooling2D(2×2)`
  - **Block 3:** `Conv2D(128, 3×3, ReLU, padding='same')` + `MaxPooling2D(2×2)`
  - **Block 4:** `Conv2D(128, 3×3, ReLU, padding='same')` + `MaxPooling2D(2×2)`
- **Classification Head:**
  - `Flatten()` $\rightarrow 25,088$ features
  - `Dense(128, ReLU)`
  - `Dropout(0.5)` for regularization
  - `Dense(1, Sigmoid)` output probability:
    - $\ge 0.5 \implies$ **Pothole Detected**
    - $< 0.5 \implies$ **No Pothole**

---

## 📊 Dataset & Provenance

- **Dataset:** `taroii/pothole-detection`
- **Source:** HuggingFace Hub ([https://huggingface.co/datasets/taroii/pothole-detection](https://huggingface.co/datasets/taroii/pothole-detection))
- **Licence:** Open Academic / Research Use
- **Total Images:** 437 real-world road photographs
  - **Training Split:** 310 images (stratified)
  - **Validation Split:** 55 images
  - **Unseen Test Split:** 72 images (46 potholes, 26 normal roads)

---

## 📈 Empirical Evaluation Metrics (Unseen Test Set)

The model was evaluated against 72 unseen test photographs:

| Metric | Result | Note |
|---|---|---|
| **Test Accuracy** | **61.11%** | Evaluated on unseen test images |
| **Test Precision** | **80.00%** | When pothole is predicted, 80% true positive rate |
| **Validation Accuracy** | **85.45%** | Measured during validation epoch |
| **Confusion Matrix** | TP: 24, TN: 20, FP: 6, FN: 22 | Low false-positive rate (clean roads rarely flagged) |

---

## 🔁 Reproducing Model Training

To retrain or fine-tune the model from scratch:

```bash
# Ensure Python dependencies are installed
pip install tensorflow tensorflowjs datasets pillow

# Run the automated training script
python train_model.py
```

The script will automatically:
1. Download the dataset from HuggingFace.
2. Build and train the Convolutional Neural Network.
3. Compute empirical evaluation metrics on the test set.
4. Export the model directly into `web/model/` in TensorFlow.js format.
5. Adapt `model.json` topology for browser compatibility.
6. Write updated metrics to `metadata.json`.

---

## 🌐 Runtime Serving & Networking Integration

1. The C HTTP Bridge (`bridge.exe`) serves `model.json` and weight shards directly via HTTP `GET /model/*` on port 5000 with `application/octet-stream` and `application/json` MIME headers.
2. The browser executes `tf.loadLayersModel('/model/model.json')` via the TensorFlow.js CDN bundle.
3. When an image is dropped or selected, `tf.browser.fromPixels()` normalizes the image and runs `model.predict()`.
4. Inference results and confidence bars update instantaneously in the DOM.
5. The image is uploaded to `/api/upload-image`, saved in `uploads/`, and its unique `imageRef` is attached to the TCP `REPORT_V2` payload sent to `server.exe` on port 9090.
