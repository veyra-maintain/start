import { RuleEngine, DAGModel } from '../src/rule_engine';
import { CoolerStateManager } from '../src/cooler_state';
import { SensorSimulator } from '../src/sensors';
import { runAllScenarios, ALL_SCENARIOS } from '../src/scripted_technician';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testBenchmark() {
  console.log('=== Running Scripted Technician Benchmark (All 9 Scenarios) ===\n');

  const groundTruthPath = path.resolve(__dirname, '../../dag/ground_truth.json');
  const groundTruthDAG: DAGModel = JSON.parse(fs.readFileSync(groundTruthPath, 'utf-8'));

  const ruleEngine = new RuleEngine(groundTruthDAG);
  const stateManager = new CoolerStateManager();
  const sensorSim = new SensorSimulator();

  const results = await runAllScenarios(ruleEngine, stateManager, sensorSim, null, (idx, total, res) => {
    const icon = res.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${idx}/${total}] ${icon} ${res.name}`);
    if (!res.passed) {
      res.steps.forEach((s) => {
        if (!s.pass) {
          console.error(`    -> Action '${s.action}': expected '${s.expected_verdict}', got '${s.actual_verdict}'. Reason: ${s.reason}`);
        }
      });
    }
  });

  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`\nBenchmark Summary: ${totalPassed}/${results.length} scenarios passed.`);

  if (totalPassed !== results.length) {
    process.exit(1);
  }
}

testBenchmark();
