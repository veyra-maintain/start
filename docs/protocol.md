# AR Glasses WebSocket Protocol & REST API

This protocol defines real-time communication between the client (Virtual AR Glasses / Three.js, Unity, or OpenXR device) and the AI backend server. The protocol is platform-agnostic, JSON-based, and decoupled from any Three.js specifics.

---

## Connection Endpoints

- **WebSocket Session**: `ws://<HOST>:<PORT>/ws/session` (Default: `ws://localhost:8000/ws/session`)
- **DAG Extraction API**: `POST http://<HOST>:<PORT>/extract_dag`
- **Health Check API**: `GET http://<HOST>:<PORT>/health`

---

## 1. Client to Server Messages

### 1.1 Video Frame (`frame`)
Sent periodically (e.g. 1 frame per second) from the headset/camera capture.

```json
{
  "type": "frame",
  "t": 1730350000000,
  "image_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
  "state": {
    "psu": "off",
    "power_cable_plugged": false,
    "esd_discharged": true,
    "cpu_clean": true,
    "paste": { "present": true, "offset_from_center": 0.05, "size": 0.45 },
    "film_on": false,
    "cooler": "seated",
    "screw": [6, 6, 6, 6],
    "fan_connected": true,
    "fan_rpm": 1420,
    "cpu_temp": 38.5
  },
  "sensors": {
    "psu_state": "off",
    "fan_header_connected": true,
    "fan_rpm": 0,
    "cpu_temp": 24.5,
    "timestamp": 1730350000000,
    "dropout_active": false,
    "noise_active": false
  },
  "step_id": 7,
  "last_verdict": {
    "verdict": "ok",
    "step_id": 7,
    "reason": "Screw turn valid. All screws snug."
  }
}
```

- Server maintains a rolling FIFO buffer of the last 5 frames per connection.
- `state`, `sensors`, and `step_id` carry the physical ground truth snapshot.

---

### 1.2 State Event Log (`event`)
Sent whenever an interaction or state modification occurs.

```json
{
  "type": "event",
  "t": 1730350001200,
  "action": "seat_cooler",
  "part": "cooler",
  "before": { "cooler": "off" },
  "after": { "cooler": "seated" },
  "verdict": {
    "verdict": "ok",
    "step_id": 6,
    "reason": "Step 6 completed successfully: Lower the cooler straight down..."
  }
}
```

---

### 1.3 User Question (`question`)
Sent when querying Gemini via the AR HUD or speech-to-text.

```json
{
  "type": "question",
  "text": "What do I do next?",
  "state": { ... },
  "sensors": { ... },
  "events": [ ... ],
  "step_id": 7,
  "last_verdict": { ... }
}
```

---

### 1.4 DAG Extraction Request (`extract_dag`)
Sent over WebSocket (or via `POST /extract_dag`) to request LLM extraction and scoring.

```json
{
  "type": "extract_dag"
}
```

---

## 2. Server to Client Messages

### 2.1 Token Stream (`token`)
Streamed token-by-token (or chunk-by-chunk) as Gemini produces output.

```json
{
  "type": "token",
  "text": "Next "
}
```

---

### 2.2 Completion / Metadata (`done`)
Sent when generation is finished.

```json
{
  "type": "done",
  "ttft_ms": 192,
  "latency_ms": 1150
}
```

---

### 2.3 DAG Model & Score (`dag`)
Sent in response to DAG extraction requests.

```json
{
  "type": "dag",
  "dag": {
    "task": "CPU Cooler Installation with Thermal Paste",
    "version": "1.0",
    "steps": [ ... ],
    "edges": [ ... ]
  },
  "score": {
    "step_precision": 1.0,
    "step_recall": 1.0,
    "edge_precision": 1.0,
    "edge_recall": 0.9091,
    "evidence_accuracy": 0.90,
    "safety_accuracy": 1.0,
    "unsupported_edges": 0
  }
}
```

---

### 2.4 Error (`error`)
Sent if an error occurs.

```json
{
  "type": "error",
  "message": "Human-readable error description"
}
```
