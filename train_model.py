"""
NetLink - train_model.py
Autonomous AI Pothole Detection Model Training & Export Script

Dataset: taroii/pothole-detection (HuggingFace Hub)
         Academic use dataset with real-world road and pothole photographs.
         Classes: 0 = 'no pothole', 1 = 'pothole'
         Splits: 310 train, 55 validation, 72 test images (224x224 RGB).

Architecture: Deep Convolutional Neural Network with 4 Conv2D feature blocks,
              Dropout regularization, and Dense classification head.
Export: TensorFlow.js LayersModel format (model.json + group1-shard1of1.bin)
        placed in web/model/ for browser-side inference via tf.loadLayersModel.
"""

import os
import sys
import json
import time
import numpy as np
from PIL import Image

# Suppress excessive TensorFlow logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

import tensorflow as tf
from tensorflow import keras
from datasets import load_dataset
import tensorflowjs as tfjs

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_OUT_DIR = os.path.join(PROJECT_DIR, "web", "model")

def load_data_split(ds_split):
    images = []
    labels = []
    for item in ds_split:
        img = item['image']
        if img.mode != 'RGB':
            img = img.convert('RGB')
        if img.size != (224, 224):
            img = img.resize((224, 224), Image.Resampling.BILINEAR)
        arr = np.array(img, dtype=np.float32) / 255.0
        images.append(arr)
        labels.append(float(item['label']))
    return np.array(images, dtype=np.float32), np.array(labels, dtype=np.float32)

def build_pothole_cnn():
    model = keras.Sequential([
        keras.layers.Input(shape=(224, 224, 3), name='input_image'),

        # Block 1: 32 filters
        keras.layers.Conv2D(32, (3, 3), activation='relu', padding='same', name='conv1'),
        keras.layers.MaxPooling2D((2, 2), name='pool1'),

        # Block 2: 64 filters
        keras.layers.Conv2D(64, (3, 3), activation='relu', padding='same', name='conv2'),
        keras.layers.MaxPooling2D((2, 2), name='pool2'),

        # Block 3: 128 filters
        keras.layers.Conv2D(128, (3, 3), activation='relu', padding='same', name='conv3'),
        keras.layers.MaxPooling2D((2, 2), name='pool3'),

        # Block 4: 128 filters
        keras.layers.Conv2D(128, (3, 3), activation='relu', padding='same', name='conv4'),
        keras.layers.MaxPooling2D((2, 2), name='pool4'),

        # Dense Head
        keras.layers.Flatten(name='flatten'),
        keras.layers.Dense(128, activation='relu', name='dense_features'),
        keras.layers.Dropout(0.5, name='dropout'),
        keras.layers.Dense(1, activation='sigmoid', name='pothole_prob')
    ], name='pothole_cnn')

    return model

def adapt_model_json(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    topology = raw['modelTopology']['model_config'] if 'model_config' in raw['modelTopology'] else raw['modelTopology']
    topology['keras_version'] = '2.15.0'

    layers = topology['config']['layers'] if 'layers' in topology['config'] else topology['config']
    for layer in layers:
        if 'config' in layer:
            if 'batch_shape' in layer['config'] and 'batch_input_shape' not in layer['config']:
                layer['config']['batch_input_shape'] = layer['config']['batch_shape']

    weights = []
    for w in raw['weightsManifest'][0]['weights']:
        cleaned_name = w['name']
        for prefix in ['pothole_cnn/', 'sequential/']:
            if cleaned_name.startswith(prefix):
                cleaned_name = cleaned_name[len(prefix):]
        w['name'] = cleaned_name
        weights.append(w)

    adapted = {
        'format': raw['format'],
        'generatedBy': 'keras 2.15.0',
        'convertedBy': 'TensorFlow.js Converter (NetLink Auto-Export)',
        'modelTopology': topology,
        'weightsManifest': [{
            'paths': raw['weightsManifest'][0]['paths'],
            'weights': weights
        }]
    }

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(adapted, f, indent=2)

def main():
    print("=" * 70)
    print(" NetLink AI Pothole Detection Model Training & Export")
    print("=" * 70)

    print("\n[Step 1/5] Loading taroii/pothole-detection dataset from HuggingFace...")
    ds_train = load_dataset('taroii/pothole-detection', split='train')
    ds_val   = load_dataset('taroii/pothole-detection', split='validation')
    ds_test  = load_dataset('taroii/pothole-detection', split='test')

    X_tr, y_tr = load_data_split(ds_train)
    X_v,  y_v  = load_data_split(ds_val)
    X_test, y_test = load_data_split(ds_test)

    # Merge train and val to form stratified sets
    X_all = np.concatenate([X_tr, X_v], axis=0)
    y_all = np.concatenate([y_tr, y_v], axis=0)

    np.random.seed(42)
    indices = np.random.permutation(len(X_all))
    split_idx = int(0.85 * len(X_all))
    train_idx, val_idx = indices[:split_idx], indices[split_idx:]

    X_train, y_train = X_all[train_idx], y_all[train_idx]
    X_val,   y_val   = X_all[val_idx],   y_all[val_idx]

    print(f"  Training samples  : {len(X_train)} (Potholes: {int(np.sum(y_train))})")
    print(f"  Validation samples: {len(X_val)}   (Potholes: {int(np.sum(y_val))})")
    print(f"  Test samples      : {len(X_test)}  (Potholes: {int(np.sum(y_test))})")

    print("\n[Step 2/5] Building deep CNN architecture...")
    model = build_pothole_cnn()
    model.summary()

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=3e-4),
        loss='binary_crossentropy',
        metrics=['accuracy']
    )

    print("\n[Step 3/5] Training model with Adam optimizer...")
    start_time = time.time()
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=12,
        batch_size=16,
        verbose=1
    )
    training_duration = time.time() - start_time
    print(f"Training completed in {training_duration:.1f} seconds.")

    print("\n[Step 4/5] Evaluating on unseen test dataset (72 road images)...")
    test_eval = model.evaluate(X_test, y_test, verbose=0)
    preds = (model.predict(X_test, verbose=0) >= 0.5).astype(int).flatten()

    tp = int(np.sum((preds == 1) & (y_test == 1)))
    tn = int(np.sum((preds == 0) & (y_test == 0)))
    fp = int(np.sum((preds == 1) & (y_test == 0)))
    fn = int(np.sum((preds == 0) & (y_test == 1)))

    accuracy  = float((tp + tn) / len(y_test))
    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall    = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1        = float((2 * precision * recall) / (precision + recall)) if (precision + recall) > 0 else 0.0

    print("=" * 55)
    print(" EMPIRICAL TEST EVALUATION RESULTS:")
    print(f"   Test Samples    : {len(y_test)}")
    print(f"   True Positives  : {tp}")
    print(f"   True Negatives  : {tn}")
    print(f"   False Positives : {fp}")
    print(f"   False Negatives : {fn}")
    print(f"   Test Accuracy   : {accuracy * 100:.2f}%")
    print(f"   Test Precision  : {precision * 100:.2f}%")
    print(f"   Test Recall     : {recall * 100:.2f}%")
    print(f"   Test F1-Score   : {f1 * 100:.2f}%")
    print("=" * 55)

    print(f"\n[Step 5/5] Exporting TensorFlow.js model to {MODEL_OUT_DIR}...")
    os.makedirs(MODEL_OUT_DIR, exist_ok=True)
    tfjs.converters.save_keras_model(model, MODEL_OUT_DIR)

    model_json_path = os.path.join(MODEL_OUT_DIR, "model.json")
    adapt_model_json(model_json_path)
    print("  model.json adapted for browser-side tf.loadLayersModel.")

    metadata = {
        "modelName": "NetLink Pothole Classifier",
        "architecture": "Deep Convolutional Neural Network (4 Conv2D Blocks, Dropout, Dense)",
        "dataset": {
            "name": "taroii/pothole-detection",
            "source": "https://huggingface.co/datasets/taroii/pothole-detection",
            "license": "Public / Academic Research",
            "trainCount": len(X_train),
            "valCount": len(X_val),
            "testCount": len(X_test),
            "totalCount": len(X_all) + len(X_test)
        },
        "labels": ["No Pothole", "Pothole"],
        "inputShape": [224, 224, 3],
        "metrics": {
            "testAccuracy": round(accuracy, 4),
            "testPrecision": round(precision, 4),
            "testRecall": round(recall, 4),
            "testF1": round(f1, 4),
            "confusionMatrix": {
                "tp": tp,
                "tn": tn,
                "fp": fp,
                "fn": fn
            },
            "testLoss": round(float(test_eval[0]), 4)
        },
        "trainingDurationSeconds": round(training_duration, 1),
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    metadata_path = os.path.join(MODEL_OUT_DIR, "metadata.json")
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)
    print("  metadata.json saved successfully.")

    files = os.listdir(MODEL_OUT_DIR)
    print(f"\nModel directory contents: {files}")
    print("\n>>> NetLink AI Pothole Detection Model is READY! <<<")

if __name__ == '__main__':
    main()
