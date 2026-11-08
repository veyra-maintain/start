import { RuleEngine } from './rule_engine';
import { CoolerStateManager, createInitialCoolerState } from './cooler_state';
import { SensorSimulator } from './sensors';
import { CoolerSceneManager } from './cooler_scene';

import sc1 from '../../scenarios/valid_flexible_order.json';
import sc2 from '../../scenarios/power_on_install.json';
import sc3 from '../../scenarios/film_left_on.json';
import sc4 from '../../scenarios/too_much_paste.json';
import sc5 from '../../scenarios/no_paste.json';
import sc6 from '../../scenarios/screw_one_full.json';
import sc7 from '../../scenarios/skipped_fan.json';
import sc8 from '../../scenarios/paste_before_clean.json';
import sc9 from '../../scenarios/sensor_dropout_at_step_1.json';

export interface ScenarioStepResult {
  step_id: number;
  action: string;
  expected_verdict: string;
  actual_verdict: string;
  pass: boolean;
  reason: string;
}

export interface ScenarioResult {
  scenario_id: string;
  name: string;
  passed: boolean;
  steps: ScenarioStepResult[];
}

export const ALL_SCENARIOS = [sc1, sc2, sc3, sc4, sc5, sc6, sc7, sc8, sc9];

export async function runScenario(
  scenarioData: any,
  ruleEngine: RuleEngine,
  stateManager: CoolerStateManager,
  sensorSim: SensorSimulator,
  coolerScene?: CoolerSceneManager | null,
  stepDelayMs = 280
): Promise<ScenarioResult> {
  ruleEngine.reset();
  stateManager.reset();
  sensorSim.setDropout(false);
  sensorSim.setNoise(false);

  const stepResults: ScenarioStepResult[] = [];
  let scenarioPassed = true;

  for (const step of scenarioData.steps) {
    if (stepDelayMs > 0) {
      await new Promise((res) => setTimeout(res, stepDelayMs));
    }

    if (step.dropout) {
      sensorSim.setDropout(true);
    } else {
      sensorSim.setDropout(false);
    }

    // Apply state setup if provided
    if (step.state_setup) {
      stateManager.setState((draft) => {
        Object.assign(draft, step.state_setup);
      }, 'setup', 'system');
    }

    // If scene is active, visually trigger the action
    if (coolerScene) {
      coolerScene.handleAction(step.action, step.payload);
    }

    const currentState = stateManager.getState();
    const currentSensors = sensorSim.sample(currentState);

    const verdict = ruleEngine.evaluate(step.action, currentState, currentSensors, step.payload);
    const isPass = verdict.verdict === step.expected_verdict;
    if (!isPass) scenarioPassed = false;

    stepResults.push({
      step_id: step.step_id,
      action: step.action,
      expected_verdict: step.expected_verdict,
      actual_verdict: verdict.verdict,
      pass: isPass,
      reason: verdict.reason,
    });

    if (verdict.verdict === 'unsafe' || verdict.verdict === 'out_of_order' || verdict.verdict === 'skipped') {
      // Benchmark step recorded the expected violation
    }
  }

  sensorSim.setDropout(false);

  return {
    scenario_id: scenarioData.id,
    name: scenarioData.name,
    passed: scenarioPassed,
    steps: stepResults,
  };
}

export async function runAllScenarios(
  ruleEngine: RuleEngine,
  stateManager: CoolerStateManager,
  sensorSim: SensorSimulator,
  coolerScene?: CoolerSceneManager | null,
  onProgress?: (index: number, total: number, result: ScenarioResult) => void
): Promise<ScenarioResult[]> {
  const allResults: ScenarioResult[] = [];

  for (let i = 0; i < ALL_SCENARIOS.length; i++) {
    const sc = ALL_SCENARIOS[i];
    const res = await runScenario(sc, ruleEngine, stateManager, sensorSim, coolerScene, 120);
    allResults.push(res);
    if (onProgress) {
      onProgress(i + 1, ALL_SCENARIOS.length, res);
    }
  }

  return allResults;
}

export function downloadResultsJSON(results: ScenarioResult[]) {
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `benchmark_results_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
