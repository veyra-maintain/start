import { CoolerState } from './cooler_state';
import { SensorReadings } from './sensors';

export type VerdictType = 'ok' | 'out_of_order' | 'skipped' | 'unsafe' | 'uncertain';

export interface RuleVerdict {
  verdict: VerdictType;
  step_id: number;
  reason: string;
  timestamp: number;
  completed_steps: number[];
  next_allowed_steps: number[];
}

export interface DAGStep {
  id: number;
  text: string;
  depends_on: number[];
  evidence: 'sensor' | 'visual' | 'confirm';
  safety: boolean;
  preconditions?: Record<string, any>;
  effects?: Record<string, any>;
  constraints?: Record<string, any>;
  source?: {
    page: number;
    quote: string;
  };
}

export interface DAGModel {
  task: string;
  version: string;
  steps: DAGStep[];
  edges: Array<{ from: number; to: number }>;
}

export class RuleEngine {
  private dag: DAGModel;
  private completedSteps: Set<number> = new Set();
  private lastVerdict: RuleVerdict | null = null;

  constructor(dag: DAGModel) {
    this.dag = dag;
  }

  public setDAG(dag: DAGModel) {
    this.dag = dag;
    this.reset();
  }

  public getDAG(): DAGModel {
    return this.dag;
  }

  public reset() {
    this.completedSteps.clear();
    this.lastVerdict = null;
  }

  public getCompletedSteps(): number[] {
    return Array.from(this.completedSteps).sort((a, b) => a - b);
  }

  public getLastVerdict(): RuleVerdict | null {
    return this.lastVerdict;
  }

  public getNextAllowedSteps(): number[] {
    const allowed: number[] = [];
    for (const step of this.dag.steps) {
      if (this.completedSteps.has(step.id)) continue;
      const depsMet = step.depends_on.every((d) => this.completedSteps.has(d));
      if (depsMet) {
        allowed.push(step.id);
      }
    }
    return allowed;
  }

  public getCurrentStep(): number {
    const next = this.getNextAllowedSteps();
    if (next.length > 0) return next[0];
    if (this.completedSteps.size === this.dag.steps.length) return 10;
    return 1;
  }

  /**
   * Evaluates an incoming action against the DAG and current state.
   */
  public evaluate(
    action: string,
    state: CoolerState,
    sensors?: SensorReadings | null,
    payload?: any
  ): RuleVerdict {
    const now = Date.now();
    const isPsuPowered = state.psu === 'on' && state.power_cable_plugged;

    // Rule 1: Touching any component while PSU is on is strictly UNSAFE (except switching off in Step 1 or reading sensors in Step 10)
    if (isPsuPowered && action !== 'toggle_psu' && action !== 'toggle_power_cable' && action !== 'verify_sensors') {
      const v: RuleVerdict = {
        verdict: 'unsafe',
        step_id: 1,
        reason: 'CRITICAL SAFETY VIOLATION: Touched component while power supply is active. Power must be switched off and unplugged first (Manual Step 1).',
        timestamp: now,
        completed_steps: this.getCompletedSteps(),
        next_allowed_steps: [1],
      };
      this.lastVerdict = v;
      return v;
    }

    // Map action to intended DAG step
    const targetStepId = this.mapActionToStep(action, state, payload);

    if (targetStepId === null) {
      // Unmapped or benign action
      const v: RuleVerdict = {
        verdict: 'ok',
        step_id: this.getCurrentStep(),
        reason: `Action '${action}' recorded.`,
        timestamp: now,
        completed_steps: this.getCompletedSteps(),
        next_allowed_steps: this.getNextAllowedSteps(),
      };
      this.lastVerdict = v;
      return v;
    }

    const stepDef = this.dag.steps.find((s) => s.id === targetStepId);
    if (!stepDef) {
      const v: RuleVerdict = {
        verdict: 'ok',
        step_id: targetStepId,
        reason: 'Action recorded.',
        timestamp: now,
        completed_steps: this.getCompletedSteps(),
        next_allowed_steps: this.getNextAllowedSteps(),
      };
      this.lastVerdict = v;
      return v;
    }

    // Rule 2: Sensor dropout / missing / stale evidence -> UNCERTAIN, never error
    if (stepDef.evidence === 'sensor') {
      if (!sensors || sensors.dropout_active || sensors.psu_state === null) {
        const v: RuleVerdict = {
          verdict: 'uncertain',
          step_id: targetStepId,
          reason: `Telemetry signal missing or sensor dropout at Step ${targetStepId}. Verification uncertain.`,
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }
    }

    // Rule 3: Check Step-specific Preconditions and Constraints First
    // Step 5: Thermal Paste Constraints
    if (targetStepId === 5) {
      const pasteSize = payload?.size ?? state.paste.size;
      const pasteOffset = payload?.offset ?? state.paste.offset_from_center;

      if (pasteSize > 0.6) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 5,
          reason: `Constraint violated on Step 5: Thermal paste blob too large (size ${pasteSize.toFixed(2)} > 0.6). Risk of overflow under cooler pressure.`,
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }

      if (pasteSize < 0.3) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 5,
          reason: `Constraint violated on Step 5: Thermal paste drop too small (size ${pasteSize.toFixed(2)} < 0.3). Inadequate thermal coverage.`,
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }

      if (pasteOffset > 0.2) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 5,
          reason: `Constraint violated on Step 5: Thermal paste off-center (offset ${pasteOffset.toFixed(2)} > 0.2). Must be placed in the center.`,
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }
    }

    // Step 6: Lower Cooler Preconditions (film_on must be false, paste must be present)
    if (targetStepId === 6) {
      if (state.film_on) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 6,
          reason: 'Precondition failed for Step 6: Protective plastic film is still on the cooler base (Manual Step 4). Peel film before seating.',
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }

      if (!state.paste.present || state.paste.size < 0.2) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 6,
          reason: 'Precondition failed for Step 6: No thermal paste applied to CPU (Manual Step 5). Apply pea-sized drop before seating.',
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }
    }

    // Rule 4: Check DAG dependency graph
    const missingDeps = stepDef.depends_on.filter((dep) => !this.completedSteps.has(dep));
    if (missingDeps.length > 0) {
      const verdictType: VerdictType = targetStepId >= 8 && missingDeps.includes(8) ? 'skipped' : 'out_of_order';

      const v: RuleVerdict = {
        verdict: verdictType,
        step_id: targetStepId,
        reason: `Violated DAG edge(s) [${missingDeps.join(', ')} -> ${targetStepId}]: Step ${targetStepId} requires prerequisite Step(s) [${missingDeps.join(', ')}] first.`,
        timestamp: now,
        completed_steps: this.getCompletedSteps(),
        next_allowed_steps: this.getNextAllowedSteps(),
      };
      this.lastVerdict = v;
      return v;
    }

    // Step 7: Screw Tightening Constraints
    if (targetStepId === 7) {
      const screws = [...state.screw];
      if (payload && typeof payload.index === 'number') {
        const idx = payload.index;
        const delta = payload.delta ?? 1;
        screws[idx] = Math.max(0, Math.min(6, screws[idx] + delta));
      }

      const minLvl = Math.min(...screws);
      const maxLvl = Math.max(...screws);

      // Constraint: no screw level differs by more than 1
      if (maxLvl - minLvl > 1) {
        const v: RuleVerdict = {
          verdict: 'out_of_order',
          step_id: 7,
          reason: `Constraint violated on Step 7: Screw balance uneven (levels [${screws.join(', ')}], diff ${maxLvl - minLvl} > 1). Must tighten diagonally in balanced turns.`,
          timestamp: now,
          completed_steps: this.getCompletedSteps(),
          next_allowed_steps: this.getNextAllowedSteps(),
        };
        this.lastVerdict = v;
        return v;
      }

      // Check if all are snug (level 6)
      if (screws.every((l) => l === 6)) {
        this.completedSteps.add(7);
      }

      const v: RuleVerdict = {
        verdict: 'ok',
        step_id: 7,
        reason: `Screw turn valid. Screw levels: [${screws.join(', ')}]. ${screws.every((l) => l === 6) ? 'All screws snug.' : 'Continue balanced diagonal tightening.'}`,
        timestamp: now,
        completed_steps: this.getCompletedSteps(),
        next_allowed_steps: this.getNextAllowedSteps(),
      };
      this.lastVerdict = v;
      return v;
    }

    // Step 1: Requires PSU off and power cable unplugged
    if (targetStepId === 1) {
      if (state.psu === 'off' && !state.power_cable_plugged) {
        this.completedSteps.add(1);
      }
    } else {
      // Standard completion
      this.completedSteps.add(targetStepId);
    }

    const v: RuleVerdict = {
      verdict: 'ok',
      step_id: targetStepId,
      reason: `Step ${targetStepId} completed successfully: "${stepDef.text}"`,
      timestamp: now,
      completed_steps: this.getCompletedSteps(),
      next_allowed_steps: this.getNextAllowedSteps(),
    };
    this.lastVerdict = v;
    return v;
  }

  private mapActionToStep(action: string, state: CoolerState, payload?: any): number | null {
    switch (action) {
      case 'toggle_psu':
      case 'toggle_power_cable':
        // If system is currently being set to powered on after cooler is installed, it maps to Step 9
        if (state.cooler === 'seated' && state.screw.every((s) => s === 6)) {
          return 9;
        }
        return 1;

      case 'discharge_esd':
        return 2;

      case 'wipe_cpu':
        return 3;

      case 'peel_film':
        return 4;

      case 'apply_paste':
        return 5;

      case 'seat_cooler':
        return 6;

      case 'turn_screw':
      case 'turn_screw_1':
      case 'turn_screw_2':
      case 'turn_screw_3':
      case 'turn_screw_4':
        return 7;

      case 'connect_fan':
        return 8;

      case 'verify_sensors':
        return 10;

      default:
        return null;
    }
  }
}
