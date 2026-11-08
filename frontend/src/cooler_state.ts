export interface ThermalPasteState {
  present: boolean;
  offset_from_center: number; // 0.0 = dead center, >0.2 = off-center
  size: number;               // 0.0 to 1.0 (pea-sized is ~0.3 - 0.6)
}

export interface CoolerState {
  psu: "on" | "off";
  power_cable_plugged: boolean;
  esd_discharged: boolean;
  cpu_clean: boolean;
  paste: ThermalPasteState;
  film_on: boolean;
  cooler: "off" | "seated";
  screw: [number, number, number, number]; // Levels 0..6 (6 = snug)
  fan_connected: boolean;
  fan_rpm: number;
  cpu_temp: number;
}

export interface StateEvent {
  t: number;
  action: string;
  part: string;
  before: any;
  after: any;
  verdict?: any;
}

export function createInitialCoolerState(): CoolerState {
  return {
    psu: "on", // Initially ON so Step 1 requires switching off
    power_cable_plugged: true,
    esd_discharged: false,
    cpu_clean: false,
    paste: {
      present: false,
      offset_from_center: 0.0,
      size: 0.0,
    },
    film_on: true,
    cooler: "off",
    screw: [0, 0, 0, 0],
    fan_connected: false,
    fan_rpm: 0,
    cpu_temp: 42.0,
  };
}

export class CoolerStateManager {
  private state: CoolerState;
  private eventLog: StateEvent[] = [];
  private listeners: Array<(state: CoolerState, lastEvent: StateEvent) => void> = [];

  constructor(initialState?: CoolerState) {
    this.state = initialState ? JSON.parse(JSON.stringify(initialState)) : createInitialCoolerState();
  }

  public getState(): CoolerState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public getEventLog(): StateEvent[] {
    return [...this.eventLog];
  }

  public getLast10Events(): StateEvent[] {
    return this.eventLog.slice(-10);
  }

  public subscribe(fn: (state: CoolerState, lastEvent: StateEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public setState(updater: (draft: CoolerState) => void, action: string, part: string): StateEvent {
    const beforeVal = JSON.parse(JSON.stringify(this.state));
    updater(this.state);
    const afterVal = JSON.parse(JSON.stringify(this.state));

    const event: StateEvent = {
      t: Date.now(),
      action,
      part,
      before: beforeVal,
      after: afterVal,
    };

    this.eventLog.push(event);
    this.listeners.forEach((fn) => fn(this.state, event));
    return event;
  }

  public reset(newState?: CoolerState) {
    this.state = newState ? JSON.parse(JSON.stringify(newState)) : createInitialCoolerState();
    this.eventLog = [];
    const dummyEvent: StateEvent = {
      t: Date.now(),
      action: "reset",
      part: "all",
      before: null,
      after: this.getState(),
    };
    this.listeners.forEach((fn) => fn(this.state, dummyEvent));
  }
}
