import { initScene as initPumpScene, SceneManager as PumpSceneManager } from './scene';
import { initCoolerScene, CoolerSceneManager } from './cooler_scene';
import { CoolerStateManager, StateEvent } from './cooler_state';
import { SensorSimulator } from './sensors';
import { ARWebSocketClient } from './websocket';

document.addEventListener('DOMContentLoaded', () => {
  const viewportContainer = document.getElementById('viewport-container') as HTMLElement;
  const clickOverlay = document.getElementById('click-to-look-overlay') as HTMLElement;
  const cameraCoordsEl = document.getElementById('camera-coords') as HTMLElement;
  const sceneSelect = document.getElementById('scene-select') as HTMLSelectElement;

  const wsIndicator = document.getElementById('ws-indicator') as HTMLElement;
  const wsStatusText = document.getElementById('ws-status-text') as HTMLElement;

  const streamThumbnail = document.getElementById('stream-thumbnail') as HTMLImageElement;
  const frameCounterEl = document.getElementById('frame-counter') as HTMLElement;
  const frameTimestampEl = document.getElementById('frame-timestamp') as HTMLElement;

  // Cooler specific panels
  const hudRulePanel = document.getElementById('hud-rule-engine-panel') as HTMLElement;
  const hudSensorsPanel = document.getElementById('hud-sensors-panel') as HTMLElement;
  const hudCoolerToolbelt = document.getElementById('hud-cooler-toolbelt') as HTMLElement;
  const hudPumpFaultControl = document.getElementById('hud-pump-fault-control') as HTMLElement;
  const toggleFault = document.getElementById('toggle-fault') as HTMLInputElement;

  // Sensor UI
  const toggleSensorDropout = document.getElementById('toggle-sensor-dropout') as HTMLInputElement;
  const toggleSensorNoise = document.getElementById('toggle-sensor-noise') as HTMLInputElement;
  const sensorPsu = document.getElementById('sensor-psu') as HTMLElement;
  const sensorFanConn = document.getElementById('sensor-fan-conn') as HTMLElement;
  const sensorRpm = document.getElementById('sensor-rpm') as HTMLElement;
  const sensorTemp = document.getElementById('sensor-temp') as HTMLElement;

  // Assistant UI
  const activeModelTag = document.getElementById('active-model-tag') as HTMLElement;
  const answerStream = document.getElementById('answer-stream') as HTMLElement;
  const metricTtft = document.getElementById('metric-ttft') as HTMLElement;
  const metricLatency = document.getElementById('metric-latency') as HTMLElement;
  const metricVisualCheck = document.getElementById('metric-visual-check') as HTMLElement;
  const metricStatus = document.getElementById('metric-status') as HTMLElement;

  const queryForm = document.getElementById('query-form') as HTMLFormElement;
  const queryInput = document.getElementById('query-input') as HTMLInputElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const chipButtons = document.querySelectorAll<HTMLButtonElement>('.chip-btn');
  const btnVisualCheck = document.getElementById('btn-visual-check') as HTMLButtonElement;

  // State & Sensors
  const stateManager = new CoolerStateManager();
  const sensorSim = new SensorSimulator();

  // Active scene pointer
  let currentSceneType: 'cooler' | 'pump' = 'cooler';
  let coolerManager: CoolerSceneManager | null = null;
  let pumpManager: PumpSceneManager | null = null;

  function loadScene(sceneType: 'cooler' | 'pump') {
    viewportContainer.innerHTML = '';
    currentSceneType = sceneType;

    if (sceneType === 'cooler') {
      hudRulePanel.style.display = 'flex';
      hudSensorsPanel.style.display = 'block';
      hudCoolerToolbelt.style.display = 'flex';
      hudPumpFaultControl.style.display = 'none';

      coolerManager = initCoolerScene(
        viewportContainer,
        stateManager,
        sensorSim,
        (ev) => onCoolerStateEvent(ev),
        (isLocked) => updatePointerLockState(isLocked)
      );
      pumpManager = null;
    } else {
      hudRulePanel.style.display = 'none';
      hudSensorsPanel.style.display = 'none';
      hudCoolerToolbelt.style.display = 'none';
      hudPumpFaultControl.style.display = 'block';

      pumpManager = initPumpScene(viewportContainer, (isLocked) => updatePointerLockState(isLocked));
      coolerManager = null;
    }
  }

  function updatePointerLockState(isLocked: boolean) {
    if (isLocked) {
      clickOverlay.classList.remove('visible');
    } else {
      clickOverlay.classList.add('visible');
    }
  }

  clickOverlay.addEventListener('click', () => {
    const canvas = viewportContainer.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
  });

  sceneSelect.addEventListener('change', () => {
    loadScene(sceneSelect.value as 'cooler' | 'pump');
  });

  // Sensor Toggles
  toggleSensorDropout.addEventListener('change', () => {
    sensorSim.setDropout(toggleSensorDropout.checked);
  });
  toggleSensorNoise.addEventListener('change', () => {
    sensorSim.setNoise(toggleSensorNoise.checked);
  });

  // Update sensor telemetry readings on UI
  setInterval(() => {
    if (currentSceneType === 'cooler') {
      const readings = sensorSim.sample(stateManager.getState());
      if (readings.dropout_active) {
        sensorPsu.textContent = 'N/A';
        sensorPsu.className = '';
        sensorFanConn.textContent = 'N/A';
        sensorFanConn.className = '';
        sensorRpm.textContent = 'N/A';
        sensorTemp.textContent = 'N/A';
      } else {
        sensorPsu.textContent = (readings.psu_state || 'off').toUpperCase();
        sensorPsu.className = readings.psu_state === 'on' ? 'val-on' : 'val-off';

        sensorFanConn.textContent = readings.fan_header_connected ? 'YES' : 'NO';
        sensorFanConn.className = readings.fan_header_connected ? 'val-on' : 'val-off';

        sensorRpm.textContent = `${readings.fan_rpm} RPM`;
        sensorTemp.textContent = `${readings.cpu_temp} °C`;
      }
    }
  }, 300);

  // Toolbelt Quick Actions
  hudCoolerToolbelt.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!coolerManager || !action) return;

      if (action === 'tighten_diagonal') {
        // Tighten screws diagonally 1 -> 2 -> 3 -> 4 by 2 turns at a time
        const st = stateManager.getState();
        const currentMin = Math.min(...st.screw);
        const target = Math.min(6, currentMin + 2);
        [0, 1, 2, 3].forEach((idx) => {
          coolerManager?.handleAction('turn_screw', { index: idx, delta: target - st.screw[idx] });
        });
      } else if (action === 'apply_paste_pea') {
        coolerManager.handleAction('apply_paste', { size: 0.45, offset: 0.05 });
      } else if (action === 'reset_cooler') {
        stateManager.reset();
        coolerManager.handleAction('reset_all');
      } else {
        coolerManager.handleAction(action);
      }
    });
  });

  // Initial load
  loadScene('cooler');

  // 2. Fetch Backend Health & Model
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

  function onCoolerStateEvent(ev: StateEvent) {
    // Send event message to backend over protocol
    if (wsClient.isConnected()) {
      wsClient.sendRaw({
        type: 'event',
        t: ev.t,
        action: ev.action,
        part: ev.part,
        before: ev.before,
        after: ev.after,
        verdict: ev.verdict || null,
      });
    }
  }

  // 4. Frame Streaming Loop (1 Hz)
  setInterval(() => {
    let frameB64 = '';
    if (currentSceneType === 'cooler' && coolerManager) {
      coolerManager.updateCoordinatesDisplay(cameraCoordsEl);
      frameB64 = coolerManager.captureFrameB64(512);
    } else if (pumpManager) {
      pumpManager.updateCoordinatesDisplay(cameraCoordsEl);
      frameB64 = pumpManager.captureFrameB64(512);
    }

    if (!frameB64) return;
    streamThumbnail.src = frameB64;

    const now = Date.now();
    const d = new Date(now);
    frameTimestampEl.textContent = d.toTimeString().split(' ')[0];

    const sensorsData = currentSceneType === 'cooler' ? sensorSim.sample(stateManager.getState()) : null;
    const stateData = currentSceneType === 'cooler' ? stateManager.getState() : null;

    const sent = wsClient.sendRaw({
      type: 'frame',
      t: now,
      image_b64: frameB64,
      state: stateData,
      sensors: sensorsData,
      step_id: 1, // Will be bound to rule engine current step in M2
    });

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

    const sensorsData = currentSceneType === 'cooler' ? sensorSim.sample(stateManager.getState()) : null;
    const stateData = currentSceneType === 'cooler' ? stateManager.getState() : null;
    const recentEvents = currentSceneType === 'cooler' ? stateManager.getLast10Events() : [];

    wsClient.sendRaw({
      type: 'question',
      text: query,
      state: stateData,
      sensors: sensorsData,
      events: recentEvents,
      step_id: 1,
      last_verdict: null,
    });
  }

  queryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = queryInput.value;
    queryInput.value = '';
    submitQuestion(text);
  });

  chipButtons.forEach((btn) => {
    if (btn.id === 'btn-visual-check') return;
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      if (q) {
        queryInput.value = q;
        submitQuestion(q);
      }
    });
  });

  btnVisualCheck?.addEventListener('click', () => {
    submitQuestion('Visual check: Is the expected state for this step visually present in the camera view?');
  });

  // Pump fault toggle
  toggleFault.addEventListener('change', () => {
    if (pumpManager) {
      pumpManager.setFaultMode(toggleFault.checked);
    }
  });

  function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
