import * as THREE from 'three';

export interface SceneManager {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  setFaultMode: (active: boolean) => void;
  captureFrameB64: (targetSize?: number) => string;
  updateCoordinatesDisplay: (el: HTMLElement) => void;
}

export function initScene(container: HTMLElement, onLockChange?: (locked: boolean) => void): SceneManager {
  // 1. Scene & Renderer setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f18);
  scene.fog = new THREE.FogExp2(0x0a0f18, 0.035);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // Crucial for reliable canvas.toDataURL / capture
    powerPreference: 'high-performance',
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 2. Camera & FPS Rig setup
  const camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.65, 0); // Eye height

  const yawObject = new THREE.Object3D();
  yawObject.position.set(0, 0, 3.4); // Technician starting position
  yawObject.add(camera);
  scene.add(yawObject);

  // 3. Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
  dirLight.position.set(6, 12, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 30;
  dirLight.shadow.camera.left = -6;
  dirLight.shadow.camera.right = 6;
  dirLight.shadow.camera.top = 6;
  dirLight.shadow.camera.bottom = -6;
  scene.add(dirLight);

  const blueFillLight = new THREE.DirectionalLight(0x00c6ff, 0.5);
  blueFillLight.position.set(-8, 6, -6);
  scene.add(blueFillLight);

  // 4. Industrial Floor with procedural grid & hazard borders
  createIndustrialFloor(scene);

  // 5. Build Industrial Pump Unit from primitives
  const pumpState = createPumpAssembly(scene);

  // 6. Fluid Leak Particle System (for fault simulation)
  const leakSystem = createLeakParticleSystem(scene, pumpState.leakOrigin);

  // 7. FPS Pointer Lock & WASD Controls
  let isPointerLocked = false;
  let pitch = -0.15; // Initial slight downward pitch looking at pump
  let yaw = 0;

  camera.rotation.x = pitch;

  const moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };

  function onKeyDown(e: KeyboardEvent) {
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

    // Clamp vertical look between -85 and +85 degrees
    pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch));

    yawObject.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);

  // Click canvas to lock pointer
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
    if (onLockChange) {
      onLockChange(isPointerLocked);
    }
  });

  // Handle window resizing
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // Fault State Manager
  let faultActive = false;
  function setFaultMode(active: boolean) {
    faultActive = active;
    pumpState.setGaugeFault(active);
    leakSystem.setActive(active);
  }

  // 8. Offscreen canvas for downscaling frames to 512x512 JPEG
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d');

  function captureFrameB64(targetSize = 512): string {
    // Render current frame before capturing
    renderer.render(scene, camera);

    offscreen.width = targetSize;
    offscreen.height = targetSize;
    if (!offCtx) return '';

    // Center crop / aspect fit into targetSize
    const src = renderer.domElement;
    const srcW = src.width;
    const srcH = src.height;
    const minDim = Math.min(srcW, srcH);
    const sx = (srcW - minDim) / 2;
    const sy = (srcH - minDim) / 2;

    offCtx.drawImage(src, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
    return offscreen.toDataURL('image/jpeg', 0.82);
  }

  function updateCoordinatesDisplay(el: HTMLElement) {
    const x = yawObject.position.x.toFixed(1);
    const y = (yawObject.position.y + camera.position.y).toFixed(1);
    const z = yawObject.position.z.toFixed(1);
    el.textContent = `CAM: [X: ${x}, Y: ${y}, Z: ${z}]`;
  }

  // 9. Animation & Physics Loop
  const clock = new THREE.Clock();
  const moveSpeed = 3.6; // meters per second

  function animate() {
    requestAnimationFrame(animate);

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
        yawObject.position.addScaledVector(moveVec, moveSpeed * delta);

        // Keep inside room bounds [-6, 6]
        yawObject.position.x = Math.max(-6, Math.min(6, yawObject.position.x));
        yawObject.position.z = Math.max(-6, Math.min(6, yawObject.position.z));
      }
    }

    // Animate leak particles
    leakSystem.update(delta);

    // Subtle gauge needle jitter for realism
    pumpState.update(delta, faultActive);

    renderer.render(scene, camera);
  }

  animate();

  return {
    renderer,
    camera,
    setFaultMode,
    captureFrameB64,
    updateCoordinatesDisplay,
  };
}

// -------------------------------------------------------------
// Helper: Procedural Industrial Floor & Walls
// -------------------------------------------------------------
function createIndustrialFloor(scene: THREE.Scene) {
  // Floor plate
  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const ctx = floorCanvas.getContext('2d')!;

  // Dark factory tile pattern
  ctx.fillStyle = '#141820';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#232b38';
  ctx.lineWidth = 2;
  const gridSize = 64;
  for (let x = 0; x <= 512; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y <= 512; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.wrapS = THREE.RepeatWrapping;
  floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(10, 10);

  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.85,
    metalness: 0.2,
  });

  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // Yellow & Black safety boundary lines around pump zone
  const boundaryGeo = new THREE.RingGeometry(2.6, 2.75, 32);
  const boundaryMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const boundary = new THREE.Mesh(boundaryGeo, boundaryMat);
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.005;
  scene.add(boundary);
}

// -------------------------------------------------------------
// Helper: 3D Pump Unit built from primitives
// -------------------------------------------------------------
function createPumpAssembly(scene: THREE.Scene) {
  const pumpGroup = new THREE.Group();
  pumpGroup.position.set(0, 0, 0);

  // Materials
  const skidMat = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    roughness: 0.5,
    metalness: 0.8,
  });

  const motorBodyMat = new THREE.MeshStandardMaterial({
    color: 0x1f4e79, // Industrial Electric Blue
    roughness: 0.35,
    metalness: 0.5,
  });

  const pumpHousingMat = new THREE.MeshStandardMaterial({
    color: 0x18604d, // Teal/Green Industrial Coating
    roughness: 0.4,
    metalness: 0.4,
  });

  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x5a6370,
    roughness: 0.45,
    metalness: 0.7,
  });

  const flangeMat = new THREE.MeshStandardMaterial({
    color: 0x3d434d,
    roughness: 0.3,
    metalness: 0.85,
  });

  const valveWheelMat = new THREE.MeshStandardMaterial({
    color: 0xd92626, // Safety Red
    roughness: 0.3,
    metalness: 0.4,
  });

  // 1. Skid / Baseplate
  const baseGeo = new THREE.BoxGeometry(2.4, 0.16, 1.2);
  const baseMesh = new THREE.Mesh(baseGeo, skidMat);
  baseMesh.position.set(0, 0.08, 0);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  pumpGroup.add(baseMesh);

  // 4 corner mounting feet
  const footPositions = [
    [-1.05, 0.04, -0.48],
    [1.05, 0.04, -0.48],
    [-1.05, 0.04, 0.48],
    [1.05, 0.04, 0.48],
  ];
  footPositions.forEach(([x, y, z]) => {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), flangeMat);
    foot.position.set(x, y, z);
    pumpGroup.add(foot);
  });

  // 2. Electric Motor (Left side)
  const motorGroup = new THREE.Group();
  motorGroup.position.set(-0.6, 0.45, 0);

  // Motor cylindrical body (horizontal, axis along X)
  const motorCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 32), motorBodyMat);
  motorCyl.rotation.z = Math.PI / 2;
  motorCyl.castShadow = true;
  motorGroup.add(motorCyl);

  // Motor cooling ribs
  for (let i = -0.35; i <= 0.35; i += 0.09) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.015, 8, 32), motorBodyMat);
    rib.rotation.y = Math.PI / 2;
    rib.position.x = i;
    motorGroup.add(rib);
  }

  // Motor rear fan cowl
  const cowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.3, 0.15, 24),
    new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.8 })
  );
  cowl.rotation.z = Math.PI / 2;
  cowl.position.x = -0.52;
  cowl.castShadow = true;
  motorGroup.add(cowl);

  // Motor electrical junction box (top)
  const jbox = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), motorBodyMat);
  jbox.position.set(0, 0.35, 0);
  jbox.castShadow = true;
  motorGroup.add(jbox);

  // Motor mounting pedestal
  const motorFoot = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.5), skidMat);
  motorFoot.position.set(0, -0.25, 0);
  motorGroup.add(motorFoot);

  pumpGroup.add(motorGroup);

  // 3. Central Drive Shaft & Coupling Guard
  const shaftGuard = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.35, 24), flangeMat);
  shaftGuard.rotation.z = Math.PI / 2;
  shaftGuard.position.set(0.05, 0.45, 0);
  shaftGuard.castShadow = true;
  pumpGroup.add(shaftGuard);

  // 4. Pump Volute & Casing (Right side)
  const pumpVoluteGroup = new THREE.Group();
  pumpVoluteGroup.position.set(0.55, 0.45, 0);

  // Main circular casing
  const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.38, 32), pumpHousingMat);
  casing.rotation.z = Math.PI / 2;
  casing.castShadow = true;
  pumpVoluteGroup.add(casing);

  // Pump mounting foot
  const pumpFoot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.42), skidMat);
  pumpFoot.position.set(0, -0.25, 0);
  pumpVoluteGroup.add(pumpFoot);

  // Inlet Pipe (Front suction)
  const inletPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 24), pipeMat);
  inletPipe.rotation.x = Math.PI / 2;
  inletPipe.position.set(0, 0, 0.35);
  inletPipe.castShadow = true;
  pumpVoluteGroup.add(inletPipe);

  const inletFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24), flangeMat);
  inletFlange.rotation.x = Math.PI / 2;
  inletFlange.position.set(0, 0, 0.58);
  pumpVoluteGroup.add(inletFlange);

  // Discharge Pipe (Vertical rising)
  const dischargePipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.25, 24), pipeMat);
  dischargePipe.position.set(0, 0.7, 0);
  dischargePipe.castShadow = true;
  pumpVoluteGroup.add(dischargePipe);

  // Discharge connecting flange
  const dFlange1 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), flangeMat);
  dFlange1.position.set(0, 0.28, 0);
  pumpVoluteGroup.add(dFlange1);

  // 5. Valve Assembly (on discharge pipe)
  const valveGroup = new THREE.Group();
  valveGroup.position.set(0, 0.85, 0);

  // Valve body bulge
  const valveBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), flangeMat);
  valveBody.castShadow = true;
  valveGroup.add(valveBody);

  // Valve Stem
  const valveStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 16), flangeMat);
  valveStem.rotation.x = Math.PI / 2;
  valveStem.position.set(0, 0, 0.22);
  valveGroup.add(valveStem);

  // Valve Handwheel (Red)
  const handwheel = new THREE.Group();
  handwheel.position.set(0, 0, 0.36);
  handwheel.rotation.x = Math.PI / 2;

  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 12, 32), valveWheelMat);
  wheelRim.castShadow = true;
  handwheel.add(wheelRim);

  const spoke1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.38, 8), valveWheelMat);
  spoke1.rotation.z = Math.PI / 2;
  handwheel.add(spoke1);

  const spoke2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.38, 8), valveWheelMat);
  handwheel.add(spoke2);

  valveGroup.add(handwheel);
  pumpVoluteGroup.add(valveGroup);

  // 6. Pressure Gauge Assembly (on top of discharge pipe)
  const gaugeGroup = new THREE.Group();
  gaugeGroup.position.set(0, 1.35, 0);

  // Gauge connector stem
  const gaugeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 16), flangeMat);
  gaugeStem.position.set(0, 0.08, 0);
  gaugeGroup.add(gaugeStem);

  // Gauge circular case (faces towards +Z so viewer sees it directly from front)
  const gaugeCase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.07, 32),
    new THREE.MeshStandardMaterial({ color: 0x333a44, metalness: 0.8, roughness: 0.3 })
  );
  gaugeCase.rotation.x = Math.PI / 2;
  gaugeCase.position.set(0, 0.22, 0.05);
  gaugeGroup.add(gaugeCase);

  // Procedural Gauge Face Canvas Texture
  const gaugeCanvas = document.createElement('canvas');
  gaugeCanvas.width = 256;
  gaugeCanvas.height = 256;
  const gCtx = gaugeCanvas.getContext('2d')!;

  function drawGaugeTexture(faultState: boolean) {
    gCtx.clearRect(0, 0, 256, 256);

    // Background dial
    gCtx.fillStyle = faultState ? '#ffeded' : '#f8fafc';
    gCtx.beginPath();
    gCtx.arc(128, 128, 120, 0, Math.PI * 2);
    gCtx.fill();

    // Outer rim
    gCtx.strokeStyle = faultState ? '#d92626' : '#2d3748';
    gCtx.lineWidth = 8;
    gCtx.stroke();

    // Normal zone arc (Green: 2 to 6 bar)
    gCtx.strokeStyle = '#10b981';
    gCtx.lineWidth = 12;
    gCtx.beginPath();
    gCtx.arc(128, 128, 95, Math.PI * 0.75, Math.PI * 1.55);
    gCtx.stroke();

    // Warning / Danger zone arc (Red: 7 to 10 bar)
    gCtx.strokeStyle = '#ef4444';
    gCtx.lineWidth = 14;
    gCtx.beginPath();
    gCtx.arc(128, 128, 95, Math.PI * 1.6, Math.PI * 2.25);
    gCtx.stroke();

    // Numbers & markings
    gCtx.fillStyle = '#1e293b';
    gCtx.font = 'bold 22px monospace';
    gCtx.textAlign = 'center';
    gCtx.textBaseline = 'middle';
    gCtx.fillText('BAR', 128, 165);

    gCtx.font = 'bold 15px monospace';
    gCtx.fillText('0', 65, 175);
    gCtx.fillText('4', 75, 80);
    gCtx.fillText('7', 160, 68);
    gCtx.fillText('10', 195, 165);

    if (faultState) {
      gCtx.fillStyle = '#dc2626';
      gCtx.font = 'bold 14px monospace';
      gCtx.fillText('OVERPRESSURE', 128, 190);
    }
  }

  drawGaugeTexture(false);

  const gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
  const gaugeFaceMat = new THREE.MeshBasicMaterial({ map: gaugeTex });
  const gaugeFace = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), gaugeFaceMat);
  gaugeFace.position.set(0, 0.22, 0.086);
  gaugeGroup.add(gaugeFace);

  // Gauge needle
  const needleGroup = new THREE.Group();
  needleGroup.position.set(0, 0.22, 0.09);

  const needleMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.015, 0.15, 8),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  needleMesh.position.y = 0.075;
  needleGroup.add(needleMesh);

  // Center needle cap
  const needleCap = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: 0xd92626 }));
  needleCap.position.z = 0.005;
  needleGroup.add(needleCap);

  // Normal angle: ~3.8 bar (rotates around Z)
  const NORMAL_ANGLE = 0.45;
  const FAULT_ANGLE = -1.65; // Pegged into red zone
  needleGroup.rotation.z = NORMAL_ANGLE;

  gaugeGroup.add(needleGroup);

  // Warning light on top of gauge
  const warningLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0x000000,
      roughness: 0.2,
    })
  );
  warningLed.position.set(0, 0.44, 0.05);
  gaugeGroup.add(warningLed);

  const warningLight = new THREE.PointLight(0xff0022, 0, 3);
  warningLight.position.set(0, 0.44, 0.15);
  gaugeGroup.add(warningLight);

  pumpVoluteGroup.add(gaugeGroup);
  pumpGroup.add(pumpVoluteGroup);
  scene.add(pumpGroup);

  // World coordinate for valve leak droplets
  const leakOrigin = new THREE.Vector3(0.55, 1.28, 0.1);

  return {
    leakOrigin,
    setGaugeFault: (active: boolean) => {
      drawGaugeTexture(active);
      gaugeTex.needsUpdate = true;
      if (active) {
        warningLed.material.emissive.setHex(0xff1122);
        warningLed.material.color.setHex(0xff3344);
        warningLight.intensity = 1.8;
      } else {
        warningLed.material.emissive.setHex(0x000000);
        warningLed.material.color.setHex(0x330000);
        warningLight.intensity = 0;
      }
    },
    update: (delta: number, isFault: boolean) => {
      // Smooth needle interpolation
      const targetAngle = isFault ? FAULT_ANGLE : NORMAL_ANGLE;
      const jitter = (Math.random() - 0.5) * (isFault ? 0.08 : 0.015);
      needleGroup.rotation.z = THREE.MathUtils.lerp(needleGroup.rotation.z, targetAngle + jitter, 0.1);

      if (isFault) {
        // Warning light pulse
        const pulse = 1.0 + 0.6 * Math.sin(Date.now() * 0.008);
        warningLight.intensity = 1.5 * pulse;
      }
    },
  };
}

// -------------------------------------------------------------
// Helper: Fluid Leak Particle System
// -------------------------------------------------------------
function createLeakParticleSystem(scene: THREE.Scene, origin: THREE.Vector3) {
  const particleCount = 45;
  const dummyGeo = new THREE.SphereGeometry(0.022, 8, 8);
  const fluidMat = new THREE.MeshStandardMaterial({
    color: 0x0088ff,
    emissive: 0x0044aa,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });

  const particles: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    active: boolean;
    respawnTimer: number;
  }> = [];

  const leakGroup = new THREE.Group();
  scene.add(leakGroup);

  for (let i = 0; i < particleCount; i++) {
    const mesh = new THREE.Mesh(dummyGeo, fluidMat);
    mesh.visible = false;
    leakGroup.add(mesh);
    particles.push({
      mesh,
      velocity: new THREE.Vector3(0, 0, 0),
      active: false,
      respawnTimer: Math.random() * 1.5,
    });
  }

  // Puddle ring on the pump skid
  const puddleGeo = new THREE.CircleGeometry(0.2, 24);
  const puddleMat = new THREE.MeshBasicMaterial({
    color: 0x0077ee,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
  puddleMesh.rotation.x = -Math.PI / 2;
  puddleMesh.position.set(origin.x, 0.17, origin.z);
  leakGroup.add(puddleMesh);

  let isEnabled = false;

  return {
    setActive: (active: boolean) => {
      isEnabled = active;
      if (!active) {
        particles.forEach((p) => {
          p.active = false;
          p.mesh.visible = false;
        });
        puddleMat.opacity = 0;
      } else {
        puddleMat.opacity = 0.65;
      }
    },
    update: (delta: number) => {
      if (!isEnabled) return;

      particles.forEach((p) => {
        if (!p.active) {
          p.respawnTimer -= delta;
          if (p.respawnTimer <= 0) {
            p.active = true;
            p.mesh.visible = true;
            p.mesh.position.copy(origin);
            // Slight drip nozzle spread
            p.mesh.position.x += (Math.random() - 0.5) * 0.04;
            p.mesh.position.z += (Math.random() - 0.5) * 0.04;
            p.velocity.set((Math.random() - 0.5) * 0.08, -0.4, (Math.random() - 0.5) * 0.08);
          }
        } else {
          // Gravity
          p.velocity.y -= 9.8 * delta;
          p.mesh.position.addScaledVector(p.velocity, delta);

          // Hit skid / floor
          if (p.mesh.position.y <= 0.17) {
            p.active = false;
            p.mesh.visible = false;
            p.respawnTimer = Math.random() * 0.15;
          }
        }
      });
    },
  };
}
