import * as THREE from 'three';
import { CoolerStateManager, CoolerState, StateEvent } from './cooler_state';
import { SensorSimulator, SensorReadings } from './sensors';

export interface CoolerSceneManager {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  stateManager: CoolerStateManager;
  sensorSim: SensorSimulator;
  captureFrameB64: (targetSize?: number) => string;
  updateCoordinatesDisplay: (el: HTMLElement) => void;
  destroy: () => void;
  handleAction: (actionName: string, payload?: any) => StateEvent | null;
}

export function initCoolerScene(
  container: HTMLElement,
  stateManager: CoolerStateManager,
  sensorSim: SensorSimulator,
  onEvent?: (event: StateEvent) => void,
  onLockChange?: (locked: boolean) => void
): CoolerSceneManager {
  // 1. Scene & Renderer setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e131d);
  scene.fog = new THREE.FogExp2(0x0e131d, 0.04);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 2. Camera Rig
  const camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.45, 0); // Eye height above workbench

  const yawObject = new THREE.Object3D();
  yawObject.position.set(0, 0, 1.35); // Standing in front of tech bench
  yawObject.add(camera);
  scene.add(yawObject);

  // 3. Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xfffaed, 1.5);
  mainLight.position.set(4, 8, 4);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 1024;
  mainLight.shadow.mapSize.height = 1024;
  scene.add(mainLight);

  const workbenchLight = new THREE.PointLight(0x00f0ff, 0.6, 6);
  workbenchLight.position.set(0, 1.8, 0);
  scene.add(workbenchLight);

  // 4. Workbench & Room
  const benchGeo = new THREE.BoxGeometry(3.0, 0.8, 1.6);
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x1a222f, roughness: 0.6, metalness: 0.2 });
  const workbench = new THREE.Mesh(benchGeo, benchMat);
  workbench.position.set(0, 0.4, 0);
  workbench.receiveShadow = true;
  scene.add(workbench);

  // ESD Grounding Touch Bar on bench front
  const esdGeo = new THREE.BoxGeometry(0.8, 0.03, 0.08);
  const esdMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
  const esdBar = new THREE.Mesh(esdGeo, esdMat);
  esdBar.position.set(0, 0.815, 0.75);
  esdBar.name = 'part_esd_bar';
  scene.add(esdBar);

  const esdLabel = createLabelSprite('ESD GROUND (Press E or Click)', '#e5a50a');
  esdLabel.position.set(0, 0.92, 0.75);
  scene.add(esdLabel);

  // 5. PSU Unit (Right-rear of bench)
  const psuGroup = new THREE.Group();
  psuGroup.position.set(0.9, 0.95, -0.3);

  const psuBodyGeo = new THREE.BoxGeometry(0.4, 0.3, 0.5);
  const psuMat = new THREE.MeshStandardMaterial({ color: 0x22262d, metalness: 0.7, roughness: 0.4 });
  const psuBody = new THREE.Mesh(psuBodyGeo, psuMat);
  psuBody.castShadow = true;
  psuBody.name = 'part_psu';
  psuGroup.add(psuBody);

  // Rocker switch on PSU front (prominent, responsive to clicks)
  const switchBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.05), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  switchBase.position.set(0, 0.05, 0.26);
  switchBase.name = 'part_psu_switch';
  psuGroup.add(switchBase);

  const rockerGeo = new THREE.BoxGeometry(0.09, 0.12, 0.03);
  const rockerMat = new THREE.MeshStandardMaterial({ color: 0x22cc44 });
  const rockerSwitch = new THREE.Mesh(rockerGeo, rockerMat);
  rockerSwitch.position.set(0, 0.05, 0.28);
  rockerSwitch.name = 'part_psu_switch';
  psuGroup.add(rockerSwitch);

  // Power LED on PSU
  const psuLedGeo = new THREE.SphereGeometry(0.018, 12, 12);
  const psuLedMat = new THREE.MeshStandardMaterial({ color: 0x22cc44, emissive: 0x22cc44, emissiveIntensity: 0.9 });
  const psuLed = new THREE.Mesh(psuLedGeo, psuLedMat);
  psuLed.position.set(0, 0.16, 0.26);
  psuLed.name = 'part_psu';
  psuGroup.add(psuLed);

  const psuSwitchLabel = createLabelSprite('PSU SWITCH: ON', '#ff4444');
  psuSwitchLabel.position.set(0, 0.22, 0.28);
  psuGroup.add(psuSwitchLabel);

  // Power Cable
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
  const powerPlug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.14), cableMat);
  powerPlug.position.set(0, -0.06, 0.32);
  powerPlug.name = 'part_power_cable';
  psuGroup.add(powerPlug);

  const cableCord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 12), cableMat);
  cableCord.rotation.x = Math.PI / 2;
  cableCord.position.set(0, -0.06, 0.62);
  psuGroup.add(cableCord);

  const psuCableLabel = createLabelSprite('POWER CABLE: PLUGGED', '#33bbff');
  psuCableLabel.position.set(0, -0.16, 0.35);
  psuGroup.add(psuCableLabel);

  scene.add(psuGroup);

  // 6. Motherboard & CPU Assembly (Center of bench)
  const moboGroup = new THREE.Group();
  moboGroup.position.set(-0.15, 0.82, 0);

  // Motherboard PCB
  const moboGeo = new THREE.BoxGeometry(1.0, 0.02, 1.0);
  const moboMat = new THREE.MeshStandardMaterial({ color: 0x0f2b1d, roughness: 0.5, metalness: 0.1 });
  const mobo = new THREE.Mesh(moboGeo, moboMat);
  mobo.receiveShadow = true;
  moboGroup.add(mobo);

  // RAM Slots & PCIe Slots
  for (let i = 0; i < 4; i++) {
    const ram = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    ram.position.set(0.24 + i * 0.05, 0.03, 0);
    moboGroup.add(ram);
  }

  // CPU Socket & CPU
  const socketGeo = new THREE.BoxGeometry(0.26, 0.025, 0.26);
  const socketMat = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, metalness: 0.8, roughness: 0.3 });
  const cpuSocket = new THREE.Mesh(socketGeo, socketMat);
  cpuSocket.position.set(0, 0.02, 0);
  moboGroup.add(cpuSocket);

  // CPU IHS (Heat Spreader)
  const cpuGeo = new THREE.BoxGeometry(0.2, 0.015, 0.2);
  const cpuMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.2 });
  const cpuMesh = new THREE.Mesh(cpuGeo, cpuMat);
  cpuMesh.position.set(0, 0.038, 0);
  cpuMesh.name = 'part_cpu';
  moboGroup.add(cpuMesh);

  // CPU Dirt overlay (cleaned during step 3)
  const dirtGeo = new THREE.PlaneGeometry(0.18, 0.18);
  const dirtMat = new THREE.MeshBasicMaterial({ color: 0x4a3b2c, transparent: true, opacity: 0.65 });
  const dirtMesh = new THREE.Mesh(dirtGeo, dirtMat);
  dirtMesh.rotation.x = -Math.PI / 2;
  dirtMesh.position.set(0, 0.046, 0);
  moboGroup.add(dirtMesh);

  const cpuLabel = createLabelSprite('CPU (DIRTY)', '#ffbb00');
  cpuLabel.position.set(0, 0.16, 0);
  moboGroup.add(cpuLabel);

  // CPU_FAN 4-Pin Header
  const headerGeo = new THREE.BoxGeometry(0.04, 0.03, 0.04);
  const headerMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const fanHeader = new THREE.Mesh(headerGeo, headerMat);
  fanHeader.position.set(0.12, 0.03, -0.22);
  fanHeader.name = 'part_cpu_fan_header';
  moboGroup.add(fanHeader);

  const fanHeaderLabel = createLabelSprite('CPU_FAN HEADER', '#00f0ff');
  fanHeaderLabel.position.set(0.12, 0.12, -0.22);
  moboGroup.add(fanHeaderLabel);

  // Thermal Paste Blob (grown on CPU)
  const pasteMat = new THREE.MeshStandardMaterial({ color: 0x8a9299, metalness: 0.5, roughness: 0.4 });
  const pasteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.001, 16, 16), pasteMat);
  pasteMesh.position.set(0, 0.047, 0);
  pasteMesh.visible = false;
  moboGroup.add(pasteMesh);

  // Flattened paste pancake (visible when cooler is seated)
  const pastePancake = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.002, 24), pasteMat);
  pastePancake.position.set(0, 0.046, 0);
  pastePancake.visible = false;
  moboGroup.add(pastePancake);

  scene.add(moboGroup);

  // 7. Tools on Workbench (Wipe cloth & Paste syringe)
  const wipeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.14), new THREE.MeshStandardMaterial({ color: 0x2288ff }));
  wipeMesh.position.set(-0.85, 0.81, 0.25);
  wipeMesh.name = 'part_wipe';
  scene.add(wipeMesh);

  const wipeLabel = createLabelSprite('ALCOHOL WIPE', '#33aaff');
  wipeLabel.position.set(-0.85, 0.92, 0.25);
  scene.add(wipeLabel);

  // Thermal Paste Syringe
  const pasteTubeGroup = new THREE.Group();
  pasteTubeGroup.position.set(-0.85, 0.83, -0.15);
  const syringeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0xbbbbbb }));
  syringeBody.rotation.z = Math.PI / 2;
  pasteTubeGroup.add(syringeBody);

  const syringeTip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  syringeTip.rotation.z = -Math.PI / 2;
  syringeTip.position.set(0.12, 0, 0);
  pasteTubeGroup.add(syringeTip);

  pasteTubeGroup.name = 'part_paste_tube';
  syringeBody.name = 'part_paste_tube';
  syringeTip.name = 'part_paste_tube';
  scene.add(pasteTubeGroup);

  const tubeLabel = createLabelSprite('THERMAL PASTE TUBE (Hold click on CPU)', '#00ffaa');
  tubeLabel.position.set(-0.85, 0.95, -0.15);
  scene.add(tubeLabel);

  // 8. CPU Cooler Unit
  const coolerGroup = new THREE.Group();
  coolerGroup.name = 'part_cooler';
  // Starts on the left side of workbench; when seated, moves to (0, 0.14, 0) relative to moboGroup
  const COOLER_UNSEATED_POS = new THREE.Vector3(-0.55, 0.94, -0.2);
  const COOLER_SEATED_POS = new THREE.Vector3(-0.15, 0.94, 0);
  coolerGroup.position.copy(COOLER_UNSEATED_POS);

  // Heatsink fins stack
  const heatsinkGeo = new THREE.BoxGeometry(0.28, 0.2, 0.28);
  const heatsinkMat = new THREE.MeshStandardMaterial({ color: 0x8894a0, metalness: 0.8, roughness: 0.3 });
  const heatsink = new THREE.Mesh(heatsinkGeo, heatsinkMat);
  heatsink.position.y = 0.06;
  heatsink.castShadow = true;
  heatsink.name = 'part_cooler';
  coolerGroup.add(heatsink);

  // Top cooler fan
  const fanCasing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), new THREE.MeshStandardMaterial({ color: 0x11161f }));
  fanCasing.position.y = 0.18;
  fanCasing.name = 'part_cooler';
  coolerGroup.add(fanCasing);

  const fanBlades = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0x2288dd }));
  fanBlades.position.y = 0.19;
  fanBlades.name = 'part_cooler';
  coolerGroup.add(fanBlades);

  // Copper Contact Baseplate
  const baseplate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.22), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.2 }));
  baseplate.position.y = -0.045;
  baseplate.name = 'part_cooler_base';
  coolerGroup.add(baseplate);

  // Removable Plastic Protective Film on Cooler Base
  const filmMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x0088cc,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const filmMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), filmMat);
  filmMesh.rotation.x = Math.PI / 2;
  filmMesh.position.y = -0.054;
  filmMesh.name = 'part_film';
  coolerGroup.add(filmMesh);

  // Protruding Peel Tab on the front of cooler baseplate (directly visible from above workbench)
  const filmTabMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.7,
    roughness: 0.2,
  });
  const filmTab = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), filmTabMat);
  filmTab.position.set(0, -0.045, 0.16);
  filmTab.name = 'part_film';
  coolerGroup.add(filmTab);

  const filmLabel = createLabelSprite('PEEL FILM (Click)', '#00ffff');
  filmLabel.position.set(0, -0.12, 0);
  coolerGroup.add(filmLabel);

  // 4 Corner Screws (1: Top-Left, 2: Bottom-Right, 3: Top-Right, 4: Bottom-Left)
  // Diagonal pattern per manual: 1 -> 2 -> 3 -> 4
  const screwMeshes: THREE.Mesh[] = [];
  const screwLabels: THREE.Sprite[] = [];
  const screwOffsets = [
    { id: 1, name: 'part_screw_1', pos: [-0.13, 0.02, -0.13], label: '1 (TL)' },
    { id: 2, name: 'part_screw_2', pos: [0.13, 0.02, 0.13], label: '2 (BR)' },
    { id: 3, name: 'part_screw_3', pos: [0.13, 0.02, -0.13], label: '3 (TR)' },
    { id: 4, name: 'part_screw_4', pos: [-0.13, 0.02, 0.13], label: '4 (BL)' },
  ];

  screwOffsets.forEach((s) => {
    const sGroup = new THREE.Group();
    sGroup.position.set(s.pos[0], s.pos[1], s.pos[2]);

    const sMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.9, roughness: 0.2 })
    );
    sMesh.name = s.name;
    sGroup.add(sMesh);

    const sLabel = createLabelSprite(`Screw ${s.label}: 0/6`, '#ffffff');
    sLabel.position.set(0, 0.1, 0);
    sLabel.scale.set(0.35, 0.18, 1);
    sGroup.add(sLabel);

    coolerGroup.add(sGroup);
    screwMeshes.push(sMesh);
    screwLabels.push(sLabel);
  });

  // Fan Cable from cooler
  const fanCableGroup = new THREE.Group();
  const fanPlugMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.03, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111111 })
  );
  fanPlugMesh.position.set(0.18, 0.05, 0.2);
  fanPlugMesh.name = 'part_fan_cable';
  fanCableGroup.add(fanPlugMesh);

  const fanCableWire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.35, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  fanCableWire.position.set(0.09, 0.1, 0.1);
  fanCableWire.rotation.z = Math.PI / 4;
  fanCableGroup.add(fanCableWire);

  coolerGroup.add(fanCableGroup);

  const coolerMainLabel = createLabelSprite('COOLER (Click to seat on CPU)', '#00e5ff');
  coolerMainLabel.position.set(0, 0.32, 0);
  coolerGroup.add(coolerMainLabel);

  scene.add(coolerGroup);

  // 9. Camera Controls & Movement
  let isPointerLocked = false;
  let pitch = -0.32; // Looking slightly down at the workbench
  let yaw = 0;
  camera.rotation.x = pitch;

  const moveState = { forward: false, backward: false, left: false, right: false };

  function onKeyDown(e: KeyboardEvent) {
    if (e.code === 'KeyE') {
      // ESD discharge shortcut
      handleAction('discharge_esd');
      return;
    }
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        moveState.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        moveState.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        moveState.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        moveState.right = true;
        break;
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        moveState.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        moveState.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        moveState.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        moveState.right = false;
        break;
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (!isPointerLocked) return;
    const sensitivity = 0.0022;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch));
    yawObject.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);

  // 10. Raycasting Interaction System
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let isHoldingPaste = false;
  let pasteHoldInterval: number | null = null;
  let activeTool: 'none' | 'wipe' | 'paste' | 'cooler' = 'none';

  function getRaycastIntersect(e?: MouseEvent): THREE.Intersection | null {
    const rayVec = new THREE.Vector2();
    if (isPointerLocked) {
      // In pointer lock, the technician aims through the center reticle crosshair (0, 0)
      rayVec.set(0, 0);
    } else if (e) {
      const rect = renderer.domElement.getBoundingClientRect();
      rayVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      rayVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    } else {
      rayVec.copy(mouse);
    }
    raycaster.setFromCamera(rayVec, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object;
      if (!obj.visible) continue;
      while (obj && obj !== scene) {
        if (obj.name && obj.name.startsWith('part_')) {
          return hit;
        }
        obj = obj.parent;
      }
    }
    return intersects.length > 0 ? intersects[0] : null;
  }

  function updateToolVisuals(tool: 'none' | 'wipe' | 'paste' | 'cooler') {
    // 1. Wipe tool visual feedback in 3D
    if (tool === 'wipe') {
      wipeMesh.position.y = 0.88;
      (wipeMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x0088ff);
      (wipeMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    } else {
      wipeMesh.position.y = 0.81;
      (wipeMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      (wipeMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    }

    // 2. Paste tube visual feedback in 3D
    if (tool === 'paste') {
      pasteTubeGroup.position.y = 0.90;
      (syringeBody.material as THREE.MeshStandardMaterial).emissive.setHex(0x00ffaa);
      (syringeBody.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
    } else {
      pasteTubeGroup.position.y = 0.83;
      (syringeBody.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      (syringeBody.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    }

    // 3. Cooler visual feedback in 3D
    const st = stateManager.getState();
    if (st.cooler !== 'seated') {
      if (tool === 'cooler') {
        coolerGroup.position.y = 1.05;
        (heatsink.material as THREE.MeshStandardMaterial).emissive.setHex(0x00e5ff);
        (heatsink.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
      } else {
        coolerGroup.position.y = 0.94;
        (heatsink.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
        (heatsink.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }
    }
  }

  function updateActiveToolHUD(tool: 'none' | 'wipe' | 'paste' | 'cooler') {
    updateToolVisuals(tool);
    const banner = document.getElementById('hud-active-tool-banner');
    if (!banner) return;
    if (tool === 'wipe') {
      banner.innerHTML = `<span>🧽 <strong>EQUIPPED: Alcohol Wipe</strong> &bull; Click CPU to clean surface</span><button class="unequip-btn" id="btn-banner-unequip">✕ Unequip</button>`;
      banner.style.display = 'flex';
    } else if (tool === 'paste') {
      banner.innerHTML = `<span>🧪 <strong>EQUIPPED: Thermal Paste Syringe</strong> &bull; Click CPU to apply pea-sized drop (0.45)</span><button class="unequip-btn" id="btn-banner-unequip">✕ Unequip</button>`;
      banner.style.display = 'flex';
    } else if (tool === 'cooler') {
      banner.innerHTML = `<span>❄️ <strong>EQUIPPED: CPU Cooler</strong> &bull; Click CPU socket to lower & seat straight down</span><button class="unequip-btn" id="btn-banner-unequip">✕ Unequip</button>`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }

    const unequipBtn = document.getElementById('btn-banner-unequip');
    if (unequipBtn) {
      unequipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeTool = 'none';
        updateActiveToolHUD('none');
      });
    }
  }

  function onPointerDown(e: MouseEvent) {
    const hit = getRaycastIntersect(e);
    if (!hit) return;

    let targetObj: THREE.Object3D | null = hit.object;
    let partName = '';
    while (targetObj && targetObj !== scene) {
      if (targetObj.name && targetObj.name.startsWith('part_')) {
        partName = targetObj.name;
        break;
      }
      targetObj = targetObj.parent;
    }

    if (!partName) return;

    const st = stateManager.getState();

    // Handle Raycast Actions
    // 1. PSU Unit or rocker switch toggles PSU
    if (partName === 'part_psu_switch' || partName === 'part_psu') {
      handleAction('toggle_psu');
    } else if (partName === 'part_power_cable') {
      handleAction('toggle_power_cable');
    } else if (partName === 'part_esd_bar') {
      handleAction('discharge_esd');
    } else if (partName === 'part_wipe') {
      activeTool = activeTool === 'wipe' ? 'none' : 'wipe';
      updateActiveToolHUD(activeTool);
    } else if (partName === 'part_paste_tube') {
      activeTool = activeTool === 'paste' ? 'none' : 'paste';
      updateActiveToolHUD(activeTool);
    } else if (partName === 'part_film' || partName === 'part_cooler_base') {
      // Direct peel of protective plastic film
      handleAction('peel_film');
      activeTool = 'none';
      updateActiveToolHUD('none');
    } else if (partName === 'part_cooler') {
      if (st.film_on) {
        // If clicked cooler while film is still on, peel the film!
        handleAction('peel_film');
      } else if (st.cooler !== 'seated') {
        activeTool = activeTool === 'cooler' ? 'none' : 'cooler';
        updateActiveToolHUD(activeTool);
      }
    } else if (partName === 'part_cpu') {
      if (activeTool === 'wipe' || !st.cpu_clean) {
        handleAction('wipe_cpu');
        activeTool = 'none';
        updateActiveToolHUD('none');
      } else if (activeTool === 'paste' || !st.paste.present) {
        const localHit = cpuMesh.worldToLocal(hit.point.clone());
        const offset = Math.sqrt(localHit.x * localHit.x + localHit.z * localHit.z) / 0.1;
        handleAction('apply_paste', { size: 0.45, offset: parseFloat(offset.toFixed(2)) });
        activeTool = 'none';
        updateActiveToolHUD('none');
      } else if (activeTool === 'cooler' || st.cooler !== 'seated') {
        handleAction('seat_cooler');
        activeTool = 'none';
        updateActiveToolHUD('none');
      }
    } else if (partName.startsWith('part_screw_')) {
      const screwIndex = parseInt(partName.replace('part_screw_', ''), 10) - 1;
      const delta = e.shiftKey ? -1 : 1;
      handleAction('turn_screw', { index: screwIndex, delta });
    } else if (partName === 'part_fan_cable' || partName === 'part_cpu_fan_header') {
      handleAction('connect_fan');
    }
  }

  function onPointerUp() {
    if (isHoldingPaste) {
      isHoldingPaste = false;
      if (pasteHoldInterval) {
        clearInterval(pasteHoldInterval);
        pasteHoldInterval = null;
      }
    }
  }

  function dispensePasteContinuous(offset: number) {
    if (pasteHoldInterval) clearInterval(pasteHoldInterval);
    pasteHoldInterval = window.setInterval(() => {
      if (!isHoldingPaste) {
        if (pasteHoldInterval) clearInterval(pasteHoldInterval);
        return;
      }
      const st = stateManager.getState();
      const newSize = Math.min(1.0, (st.paste.size || 0.0) + 0.08);
      handleAction('apply_paste', { size: parseFloat(newSize.toFixed(2)), offset: parseFloat(offset.toFixed(2)) });
    }, 120);
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);

  renderer.domElement.addEventListener('click', () => {
    if (!isPointerLocked) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
    if (onLockChange) onLockChange(isPointerLocked);
  });

  // Window resize
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // 11. Central Action Dispatcher & Visual State Updater
  function handleAction(actionName: string, payload?: any): StateEvent | null {
    let ev: StateEvent | null = null;

    switch (actionName) {
      case 'toggle_psu': {
        ev = stateManager.setState((draft) => {
          draft.psu = draft.psu === 'on' ? 'off' : 'on';
        }, 'toggle_psu', 'psu');
        break;
      }

      case 'toggle_power_cable': {
        ev = stateManager.setState((draft) => {
          draft.power_cable_plugged = !draft.power_cable_plugged;
        }, 'toggle_power_cable', 'power_cable');
        break;
      }

      case 'discharge_esd': {
        ev = stateManager.setState((draft) => {
          draft.esd_discharged = true;
        }, 'discharge_esd', 'esd_bar');
        break;
      }

      case 'wipe_cpu': {
        ev = stateManager.setState((draft) => {
          draft.cpu_clean = true;
        }, 'wipe_cpu', 'cpu');
        break;
      }

      case 'apply_paste': {
        const size = payload?.size ?? 0.45;
        const offset = payload?.offset ?? 0.05;
        ev = stateManager.setState((draft) => {
          draft.paste.present = true;
          draft.paste.size = size;
          draft.paste.offset_from_center = offset;
        }, 'apply_paste', 'cpu');
        break;
      }

      case 'peel_film': {
        ev = stateManager.setState((draft) => {
          draft.film_on = false;
        }, 'peel_film', 'film');
        break;
      }

      case 'seat_cooler': {
        ev = stateManager.setState((draft) => {
          draft.cooler = 'seated';
        }, 'seat_cooler', 'cooler');
        break;
      }

      case 'turn_screw': {
        const idx = payload?.index ?? 0;
        const delta = payload?.delta ?? 1;
        ev = stateManager.setState((draft) => {
          const current = draft.screw[idx];
          const next = Math.max(0, Math.min(6, current + delta));
          draft.screw[idx] = next;
        }, `turn_screw_${idx + 1}`, `screw_${idx + 1}`);
        break;
      }

      case 'connect_fan': {
        ev = stateManager.setState((draft) => {
          draft.fan_connected = true;
        }, 'connect_fan', 'fan_cable');
        break;
      }

      case 'reset_all': {
        activeTool = 'none';
        updateActiveToolHUD('none');
        break;
      }

      default:
        console.warn('Unknown cooler action:', actionName);
    }

    if (ev && onEvent) {
      onEvent(ev);
    }

    updateVisualsFromState(stateManager.getState());
    return ev;
  }

  // Visual Synchronizer
  function updateVisualsFromState(st: CoolerState) {
    // 1. PSU Switch & LED
    const isPsuOn = st.psu === 'on';
    rockerSwitch.rotation.x = isPsuOn ? -0.25 : 0.25;
    (rockerSwitch.material as THREE.MeshStandardMaterial).color.setHex(isPsuOn ? 0x22cc44 : 0xdd2222);
    (psuLed.material as THREE.MeshStandardMaterial).color.setHex(isPsuOn ? 0x22cc44 : 0x222222);
    (psuLed.material as THREE.MeshStandardMaterial).emissive.setHex(isPsuOn ? 0x22cc44 : 0x000000);
    psuSwitchLabel.material.map = createTextTexture(`PSU SWITCH: ${st.psu.toUpperCase()}`, isPsuOn ? '#22cc44' : '#ff4444');

    // 2. Power Cable
    powerPlug.position.z = st.power_cable_plugged ? 0.32 : 0.48;
    psuCableLabel.material.map = createTextTexture(
      `POWER CABLE: ${st.power_cable_plugged ? 'PLUGGED' : 'UNPLUGGED'}`,
      st.power_cable_plugged ? '#33bbff' : '#aaaaaa'
    );

    // 3. ESD Discharge
    if (st.esd_discharged) {
      esdLabel.material.map = createTextTexture('ESD DISCHARGED (OK)', '#00ff88');
      (esdBar.material as THREE.MeshStandardMaterial).color.setHex(0x00ff88);
    }

    // 4. CPU Clean
    if (st.cpu_clean) {
      dirtMesh.visible = false;
      cpuLabel.material.map = createTextTexture('CPU (CLEANED WITH IPA)', '#00ff88');
    } else {
      dirtMesh.visible = true;
    }

    // 5. Thermal Paste Blob
    if (st.paste.present && st.paste.size > 0) {
      if (st.cooler === 'seated') {
        pasteMesh.visible = false;
        pastePancake.visible = true;
        const spreadRadius = 0.04 + st.paste.size * 0.08;
        pastePancake.scale.set(spreadRadius / 0.001, 1, spreadRadius / 0.001);
      } else {
        pasteMesh.visible = true;
        pastePancake.visible = false;
        const blobRadius = 0.01 + st.paste.size * 0.035;
        pasteMesh.scale.set(blobRadius / 0.001, (blobRadius * 0.7) / 0.001, blobRadius / 0.001);
        pasteMesh.position.x = st.paste.offset_from_center * 0.06;
      }
    } else {
      pasteMesh.visible = false;
      pastePancake.visible = false;
    }

    // 6. Protective Film & Protruding Tab
    filmMesh.visible = st.film_on;
    filmTab.visible = st.film_on;
    filmLabel.visible = false;

    // 7. Cooler Seated Position
    if (st.cooler === 'seated') {
      coolerGroup.position.copy(COOLER_SEATED_POS);
      coolerMainLabel.material.map = createTextTexture('COOLER: SEATED ON CPU', '#00ff88');
    } else {
      coolerGroup.position.copy(COOLER_UNSEATED_POS);
      coolerMainLabel.material.map = createTextTexture('COOLER (Click to seat on CPU)', '#00e5ff');
    }

    // 8. Screws
    st.screw.forEach((lvl, i) => {
      // Rotate and lower screw as level increases (0..6)
      screwMeshes[i].position.y = 0.02 - lvl * 0.004;
      screwMeshes[i].rotation.y = lvl * (Math.PI / 2);
      const isSnug = lvl === 6;
      screwLabels[i].material.map = createTextTexture(
        `Screw ${screwOffsets[i].label}: ${lvl}/6${isSnug ? ' (SNUG)' : ''}`,
        isSnug ? '#00ff88' : '#ffffff'
      );
    });

    // 9. Fan Cable Connected
    if (st.fan_connected) {
      fanPlugMesh.position.set(0.12, 0.05, -0.22); // Reaches mobo header
      fanHeaderLabel.material.map = createTextTexture('CPU_FAN: CONNECTED', '#00ff88');
    }
  }

  // Sync initial state visual
  updateVisualsFromState(stateManager.getState());

  // 12. Frame Capture helper
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d');

  function captureFrameB64(targetSize = 512): string {
    renderer.render(scene, camera);
    offscreen.width = targetSize;
    offscreen.height = targetSize;
    if (!offCtx) return '';

    const src = renderer.domElement;
    const minDim = Math.min(src.width, src.height);
    const sx = (src.width - minDim) / 2;
    const sy = (src.height - minDim) / 2;

    offCtx.drawImage(src, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
    return offscreen.toDataURL('image/jpeg', 0.82);
  }

  function updateCoordinatesDisplay(el: HTMLElement) {
    const x = yawObject.position.x.toFixed(1);
    const y = (yawObject.position.y + camera.position.y).toFixed(1);
    const z = yawObject.position.z.toFixed(1);
    el.textContent = `CAM: [X: ${x}, Y: ${y}, Z: ${z}]`;
  }

  // 13. Animation Loop
  const clock = new THREE.Clock();
  let reqId = 0;

  function animate() {
    reqId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (isPointerLocked) {
      const moveVec = new THREE.Vector3();
      if (moveState.forward) moveVec.z -= 1;
      if (moveState.backward) moveVec.z += 1;
      if (moveState.left) moveVec.x -= 1;
      if (moveState.right) moveVec.x += 1;

      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        moveVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        yawObject.position.addScaledVector(moveVec, 3.2 * delta);
        yawObject.position.x = Math.max(-3.5, Math.min(3.5, yawObject.position.x));
        yawObject.position.z = Math.max(-0.5, Math.min(4.0, yawObject.position.z));
      }
    }

    // Animate fan spinning if powered & connected
    const st = stateManager.getState();
    const isPowered = st.psu === 'on' && st.power_cable_plugged;
    if (isPowered && st.fan_connected) {
      fanBlades.rotation.y += delta * 25.0;
    }

    // Dynamic Reticle Target Readout (clean HUD tooltip instead of giant 3D billboards)
    const reticleTagEl = document.getElementById('reticle-hover-target');
    if (reticleTagEl) {
      const hit = getRaycastIntersect();
      let hoveredPart = '';
      if (hit) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && obj !== scene) {
          if (obj.name && obj.name.startsWith('part_')) {
            hoveredPart = obj.name;
            break;
          }
          obj = obj.parent;
        }
      }

      if (hoveredPart) {
        let text = '';
        switch (hoveredPart) {
          case 'part_psu':
          case 'part_psu_switch':
            text = `PSU Rocker Switch [${st.psu.toUpperCase()}] - Click to toggle`;
            break;
          case 'part_power_cable':
            text = `Power Cable [${st.power_cable_plugged ? 'PLUGGED' : 'UNPLUGGED'}] - Click to ${st.power_cable_plugged ? 'unplug' : 'plug in'}`;
            break;
          case 'part_esd_bar':
            text = `ESD Ground Metal [${st.esd_discharged ? 'DISCHARGED' : 'PENDING'}] - Press 'E' or click`;
            break;
          case 'part_wipe':
            text = activeTool === 'wipe' ? '🧽 Alcohol Wipe [EQUIPPED] - Click to unequip' : '🧽 Alcohol Wipe - Click to equip';
            break;
          case 'part_paste_tube':
            text = activeTool === 'paste' ? '🧪 Thermal Paste Tube [EQUIPPED] - Click to unequip' : '🧪 Thermal Paste Tube - Click to equip';
            break;
          case 'part_film':
            text = '⚠️ Protective Plastic Film - CLICK TO PEEL OFF';
            break;
          case 'part_cooler_base':
            text = st.film_on ? '⚠️ Cooler Baseplate [Film Attached] - CLICK TO PEEL FILM' : 'Cooler Baseplate [Clean Copper]';
            break;
          case 'part_cooler':
            if (st.cooler === 'seated') {
              text = 'Cooler [SEATED ON SOCKET]';
            } else if (st.film_on) {
              text = '❄️ Cooler Unit [Film Attached] - CLICK TO PEEL FILM';
            } else if (activeTool === 'cooler') {
              text = '❄️ Cooler Unit [EQUIPPED] - Click CPU to lower and seat';
            } else {
              text = '❄️ Cooler Unit - Click to pick up / seat';
            }
            break;
          case 'part_cpu':
            if (activeTool === 'wipe') {
              text = '🧽 CPU - Click to clean with Alcohol Wipe';
            } else if (activeTool === 'paste') {
              text = '🧪 CPU - Click to apply pea-sized Thermal Paste (0.45)';
            } else if (activeTool === 'cooler') {
              text = '❄️ CPU - Click to lower and seat Cooler straight down';
            } else if (!st.cpu_clean) {
              text = 'CPU [DIRTY] - Click with Alcohol Wipe to clean';
            } else if (!st.paste.present) {
              text = 'CPU [CLEANED] - Click with Thermal Paste to apply';
            } else if (st.cooler !== 'seated') {
              text = `CPU [Paste Applied: ${(st.paste.size * 100).toFixed(0)}%] - Click to seat cooler`;
            } else {
              text = 'CPU Socket [Cooler Installed]';
            }
            break;
          case 'part_screw_1':
            text = `Screw 1 (Top-Left): ${st.screw[0]}/6 - Click (+1), Shift+Click (-1)`;
            break;
          case 'part_screw_2':
            text = `Screw 2 (Bottom-Right): ${st.screw[1]}/6 - Click (+1), Shift+Click (-1)`;
            break;
          case 'part_screw_3':
            text = `Screw 3 (Top-Right): ${st.screw[2]}/6 - Click (+1), Shift+Click (-1)`;
            break;
          case 'part_screw_4':
            text = `Screw 4 (Bottom-Left): ${st.screw[3]}/6 - Click (+1), Shift+Click (-1)`;
            break;
          case 'part_fan_cable':
          case 'part_cpu_fan_header':
            text = st.fan_connected ? 'CPU_FAN Header [CONNECTED]' : 'CPU_FAN Header & Cable - Click to connect';
            break;
        }

        if (text) {
          reticleTagEl.textContent = text;
          reticleTagEl.style.display = 'block';
        } else {
          reticleTagEl.style.display = 'none';
        }
      } else {
        reticleTagEl.style.display = 'none';
      }
    }

    renderer.render(scene, camera);
  }
  animate();

  function destroy() {
    activeTool = 'none';
    updateActiveToolHUD('none');
    cancelAnimationFrame(reqId);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.remove();
  }

  return {
    renderer,
    camera,
    stateManager,
    sensorSim,
    captureFrameB64,
    updateCoordinatesDisplay,
    destroy,
    handleAction,
  };
}

// -------------------------------------------------------------
// Helper: 3D Billboards / Text Labels
// -------------------------------------------------------------
function createTextTexture(text: string, color = '#00f0ff'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 70;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.roundRect(4, 4, 312, 62, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 22px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 35);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createLabelSprite(text: string, color = '#00f0ff'): THREE.Sprite {
  const tex = createTextTexture(text, color);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.12, 0.035, 1);
  sprite.visible = false; // Hidden by default to keep the 3D scene completely unobstructed
  return sprite;
}
