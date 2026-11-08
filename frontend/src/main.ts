import { initScene } from './scene';
import { ARWebSocketClient } from './websocket';

document.addEventListener('DOMContentLoaded', () => {
  const viewportContainer = document.getElementById('viewport-container') as HTMLElement;
  const clickOverlay = document.getElementById('click-to-look-overlay') as HTMLElement;
  const cameraCoordsEl = document.getElementById('camera-coords') as HTMLElement;

  const wsIndicator = document.getElementById('ws-indicator') as HTMLElement;
  const wsStatusText = document.getElementById('ws-status-text') as HTMLElement;

  const streamThumbnail = document.getElementById('stream-thumbnail') as HTMLImageElement;
  const frameCounterEl = document.getElementById('frame-counter') as HTMLElement;
  const frameTimestampEl = document.getElementById('frame-timestamp') as HTMLElement;

  const toggleFault = document.getElementById('toggle-fault') as HTMLInputElement;

  const activeModelTag = document.getElementById('active-model-tag') as HTMLElement;
  const answerStream = document.getElementById('answer-stream') as HTMLElement;
  const metricTtft = document.getElementById('metric-ttft') as HTMLElement;
  const metricLatency = document.getElementById('metric-latency') as HTMLElement;
  const metricStatus = document.getElementById('metric-status') as HTMLElement;

  const queryForm = document.getElementById('query-form') as HTMLFormElement;
  const queryInput = document.getElementById('query-input') as HTMLInputElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const chipButtons = document.querySelectorAll<HTMLButtonElement>('.chip-btn');

  // 1. Initialize 3D Scene
  const sceneManager = initScene(viewportContainer, (isLocked) => {
    if (isLocked) {
      clickOverlay.classList.remove('visible');
    } else {
      clickOverlay.classList.add('visible');
    }
  });

  clickOverlay.addEventListener('click', () => {
    sceneManager.renderer.domElement.requestPointerLock();
  });

  // 2. Fetch Backend Health & Mode
  const host = window.location.hostname || 'localhost';
  const httpBackendUrl = `http://${host}:8000`;
  const wsBackendUrl = `ws://${host}:8000/ws/session`;

  async function checkBackendMode() {
    try {
      const res = await fetch(`${httpBackendUrl}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.mock_mode) {
          activeModelTag.textContent = 'MOCK MODE (No Key)';
          activeModelTag.style.borderColor = 'rgba(255, 170, 0, 0.4)';
          activeModelTag.style.color = '#ffaa00';
        } else {
          activeModelTag.textContent = data.model || 'Gemini Flash';
          activeModelTag.style.borderColor = 'rgba(0, 240, 255, 0.4)';
          activeModelTag.style.color = '#00f0ff';
        }
      }
    } catch {
      activeModelTag.textContent = 'Connecting...';
    }
  }
  checkBackendMode();

  // 3. Setup WebSocket Connection
  let isGenerating = false;
  let bufferedFrameCount = 0;

  const wsClient = new ARWebSocketClient(wsBackendUrl, {
    onStatusChange: (status) => {
      wsIndicator.className = `hud-status ${status}`;
      if (status === 'connected') {
        wsStatusText.textContent = 'BACKEND CONNECTED';
        checkBackendMode();
      } else if (status === 'connecting') {
        wsStatusText.textContent = 'CONNECTING TO BACKEND...';
      } else {
        wsStatusText.textContent = 'DISCONNECTED (RETRYING)';
      }
    },
    onToken: (token) => {
      if (isGenerating) {
        // Clear placeholder on first token if still present
        if (answerStream.querySelector('.placeholder-text') || answerStream.querySelector('.loading-hint')) {
          answerStream.textContent = '';
        }
        answerStream.textContent += token;
        answerStream.scrollTop = answerStream.scrollHeight;
        metricStatus.textContent = 'Streaming...';
      }
    },
    onDone: (latencyMs, ttftMs) => {
      isGenerating = false;
      sendBtn.disabled = false;
      metricStatus.textContent = 'Completed';
      metricLatency.textContent = `${latencyMs} ms`;
      if (ttftMs !== undefined) {
        metricTtft.textContent = `${ttftMs} ms`;
      }
    },
    onError: (errorMessage) => {
      isGenerating = false;
      sendBtn.disabled = false;
      metricStatus.textContent = 'Error';
      answerStream.innerHTML = `<span style="color: #ff3344;">⚠️ [Error] ${escapeHtml(errorMessage)}</span>`;
    },
  });

  wsClient.connect();

  // 4. Frame Streaming Loop: 1 Hz (every 1000ms)
  setInterval(() => {
    sceneManager.updateCoordinatesDisplay(cameraCoordsEl);

    // Capture downscaled frame
    const frameB64 = sceneManager.captureFrameB64(512);
    if (!frameB64) return;

    // Update thumbnail preview
    streamThumbnail.src = frameB64;

    const now = Date.now();
    const d = new Date(now);
    frameTimestampEl.textContent = d.toTimeString().split(' ')[0];

    // Transmit over WebSocket
    const sent = wsClient.sendFrame(now, frameB64);
    if (sent) {
      bufferedFrameCount = Math.min(bufferedFrameCount + 1, 5);
      frameCounterEl.textContent = `Buffered: ${bufferedFrameCount} frames`;
    }
  }, 1000);

  // 5. Submit Question
  function submitQuestion(text: string) {
    const query = text.trim();
    if (!query) return;

    if (!wsClient.isConnected()) {
      answerStream.innerHTML = `<span style="color: #ffaa00;">⚠️ Backend not connected. Waiting for server on ${wsBackendUrl}...</span>`;
      return;
    }

    isGenerating = true;
    sendBtn.disabled = true;
    metricStatus.textContent = 'Waiting for first token...';
    metricTtft.textContent = '-- ms';
    metricLatency.textContent = '-- ms';

    answerStream.innerHTML = `<span class="loading-hint" style="color: #00f0ff; font-style: italic;">✨ Gemini is analyzing the ${bufferedFrameCount} recent frames...</span>`;

    wsClient.sendQuestion(query);
  }

  queryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = queryInput.value;
    queryInput.value = '';
    submitQuestion(text);
  });

  // Quick Chips
  chipButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      if (q) {
        queryInput.value = q;
        submitQuestion(q);
      }
    });
  });

  // 6. Stretch Feature: Fault Toggle
  toggleFault.addEventListener('change', () => {
    const active = toggleFault.checked;
    sceneManager.setFaultMode(active);
  });

  function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
