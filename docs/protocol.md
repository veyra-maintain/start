# AR Glasses WebSocket Protocol

This protocol defines the real-time communication between the client (Virtual AR Glasses / Three.js or Unity) and the AI backend server. The protocol is platform-agnostic and relies on JSON messages sent over a standard WebSocket connection.

---

## Connection Endpoint

```
ws://<HOST>:<PORT>/ws/session
```

Default local URL: `ws://localhost:8000/ws/session`

---

## 1. Client to Server Messages

### 1.1 Video Frame (`frame`)
Sent periodically (e.g. 1 frame per second) from the AR headset/camera capture.

```json
{
  "type": "frame",
  "t": 1730350000000,
  "image_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
}
```

- `type` (string, required): Always `"frame"`.
- `t` (integer/float, required): Client-side timestamp in milliseconds (epoch).
- `image_b64` (string, required): JPEG image downscaled to ~512px width/height, encoded as base64 (with or without data URI prefix `data:image/jpeg;base64,`).

**Server Behavior**:
- Server keeps a rolling buffer of the last 5 frames for the connection.
- Older frames are automatically dropped (FIFO).

---

### 1.2 User Question (`question`)
Sent when the user submits a text question via the AR HUD or speech-to-text.

```json
{
  "type": "question",
  "text": "What is the status of the pressure gauge?"
}
```

- `type` (string, required): Always `"question"`.
- `text` (string, required): User query prompt.

---

## 2. Server to Client Messages

### 2.1 Token Stream (`token`)
Streamed token-by-token (or chunk-by-chunk) as Gemini produces output.

```json
{
  "type": "token",
  "text": "The "
}
```

- `type` (string, required): Always `"token"`.
- `text` (string, required): Partial text fragment to append to the UI display.

---

### 2.2 Completion / Metadata (`done`)
Sent when the response generation is complete.

```json
{
  "type": "done",
  "ttft_ms": 482,
  "latency_ms": 1150
}
```

- `type` (string, required): Always `"done"`.
- `ttft_ms` (integer/float, optional): Time to first token in milliseconds from question receipt.
- `latency_ms` (integer/float, required): Total turnaround latency in milliseconds from question receipt to completion.

---

### 2.3 Error (`error`)
Sent if an error occurs during frame processing or LLM invocation.

```json
{
  "type": "error",
  "message": "GEMINI_API_KEY is not configured and MOCK_MODE is false."
}
```

- `type` (string, required): Always `"error"`.
- `message` (string, required): Human-readable error description.

---

## Compatibility Note

This protocol contains **no Three.js or browser-specific dependencies**. Any client (Web, Unity, Unreal Engine, OpenXR headset, native iOS/Android ARKit/ARCore app) capable of sending downscaled JPEG base64 frames and receiving JSON tokens can interface with this backend.
