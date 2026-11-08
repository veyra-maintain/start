import { RuleEngine, DAGModel } from '../src/rule_engine';
import { createInitialCoolerState, CoolerState } from '../src/cooler_state';
import { SensorReadings } from '../src/sensors';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load ground truth DAG
const groundTruthPath = path.resolve(__dirname, '../../dag/ground_truth.json');
const groundTruthDAG: DAGModel = JSON.parse(fs.readFileSync(groundTruthPath, 'utf-8'));

function runUnitTests() {
  console.log('=== Running Rule Engine Unit Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  const engine = new RuleEngine(groundTruthDAG);

  // Test 1: UNSAFE verdict
  // Touching CPU while PSU is ON
  const stateWithPowerOn = createInitialCoolerState();
  stateWithPowerOn.psu = 'on';
  stateWithPowerOn.power_cable_plugged = true;
  const v1 = engine.evaluate('wipe_cpu', stateWithPowerOn, null);
  assert(v1.verdict === 'unsafe', 'Verdict UNSAFE: Touching component while PSU is on', `Got: ${v1.verdict}`);

  // Test 2: OK verdict for Step 1
  engine.reset();
  const statePsuOff = createInitialCoolerState();
  statePsuOff.psu = 'off';
  statePsuOff.power_cable_plugged = false;
  const dummySensors: SensorReadings = {
    psu_state: 'off',
    fan_header_connected: false,
    fan_rpm: 0,
    cpu_temp: 24,
    timestamp: Date.now(),
    dropout_active: false,
    noise_active: false,
  };
  const v2 = engine.evaluate('toggle_psu', statePsuOff, dummySensors);
  assert(v2.verdict === 'ok' && v2.step_id === 1, 'Verdict OK: Step 1 power supply switched off', `Got: ${v2.verdict}`);

  // Test 3: UNCERTAIN verdict
  // Sensor dropout at Step 1
  engine.reset();
  const dropoutSensors: SensorReadings = {
    psu_state: null,
    fan_header_connected: null,
    fan_rpm: null,
    cpu_temp: null,
    timestamp: Date.now(),
    dropout_active: true,
    noise_active: false,
  };
  const v3 = engine.evaluate('toggle_psu', statePsuOff, dropoutSensors);
  assert(v3.verdict === 'uncertain', 'Verdict UNCERTAIN: Sensor dropout yields uncertain, not error', `Got: ${v3.verdict}`);

  // Test 4: OUT_OF_ORDER verdict
  // Step 5 (Paste) attempted before Step 3 (Clean)
  engine.reset();
  // Complete Step 1 & 2
  engine.evaluate('toggle_psu', statePsuOff, dummySensors);
  statePsuOff.esd_discharged = true;
  engine.evaluate('discharge_esd', statePsuOff, dummySensors);
  // Now try Step 5 before Step 3
  const v4 = engine.evaluate('apply_paste', statePsuOff, dummySensors, { size: 0.45, offset: 0.05 });
  assert(v4.verdict === 'out_of_order', 'Verdict OUT_OF_ORDER: Step 5 before prerequisite Step 3', `Got: ${v4.verdict}`);

  // Test 5: Precondition Failure (Film left on)
  engine.reset();
  engine.evaluate('toggle_psu', statePsuOff, dummySensors);
  statePsuOff.esd_discharged = true;
  engine.evaluate('discharge_esd', statePsuOff, dummySensors);
  statePsuOff.cpu_clean = true;
  engine.evaluate('wipe_cpu', statePsuOff, dummySensors);
  statePsuOff.paste.present = true;
  statePsuOff.paste.size = 0.45;
  engine.evaluate('apply_paste', statePsuOff, dummySensors, { size: 0.45, offset: 0.05 });
  // Film is still on! Try seating cooler (Step 6)
  statePsuOff.film_on = true;
  const v5 = engine.evaluate('seat_cooler', statePsuOff, dummySensors);
  assert(v5.verdict === 'out_of_order' && v5.reason.includes('film'), 'Precondition Failure: Seating cooler with film left on', `Got: ${v5.reason}`);

  // Test 6: Constraint Failure (Too much paste)
  engine.reset();
  engine.evaluate('toggle_psu', statePsuOff, dummySensors);
  engine.evaluate('discharge_esd', statePsuOff, dummySensors);
  engine.evaluate('wipe_cpu', statePsuOff, dummySensors);
  const v6 = engine.evaluate('apply_paste', statePsuOff, dummySensors, { size: 0.9, offset: 0.05 });
  assert(v6.verdict === 'out_of_order' && v6.reason.includes('too large'), 'Constraint Failure: Thermal paste size 0.9 > 0.6', `Got: ${v6.reason}`);

  // Test 7: SKIPPED verdict
  // Cooler seated, screws snug, but fan was skipped; now trying power on
  engine.reset();
  // Simulate up to cooler seated & screws snug
  [1, 2, 3, 4, 5, 6].forEach((s) => (engine as any).completedSteps.add(s));
  statePsuOff.screw = [6, 6, 6, 6];
  statePsuOff.cooler = 'seated';
  (engine as any).completedSteps.add(7);
  // Fan is NOT connected (Step 8 skipped). Try Step 9 (power on)
  const v7 = engine.evaluate('toggle_psu', statePsuOff, dummySensors);
  assert(v7.verdict === 'skipped', 'Verdict SKIPPED: Step 9 attempted while Step 8 was skipped', `Got: ${v7.verdict}`);

  console.log(`\nUnit Tests Result: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runUnitTests();
