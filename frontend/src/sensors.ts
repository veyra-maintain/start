import { CoolerState } from './cooler_state';

export interface SensorReadings {
  psu_state: 'on' | 'off' | null;
  fan_header_connected: boolean | null;
  fan_rpm: number | null;
  cpu_temp: number | null;
  timestamp: number;
  dropout_active: boolean;
  noise_active: boolean;
}

export class SensorSimulator {
  private dropout = false;
  private noise = false;

  public setDropout(active: boolean) {
    this.dropout = active;
  }

  public isDropout(): boolean {
    return this.dropout;
  }

  public setNoise(active: boolean) {
    this.noise = active;
  }

  public isNoise(): boolean {
    return this.noise;
  }

  public sample(state: CoolerState): SensorReadings {
    const now = Date.now();

    if (this.dropout) {
      return {
        psu_state: null,
        fan_header_connected: null,
        fan_rpm: null,
        cpu_temp: null,
        timestamp: now,
        dropout_active: true,
        noise_active: this.noise,
      };
    }

    // Dynamic sensor simulation based on physical state:
    // Fan spins only if PSU is ON and fan is plugged into CPU_FAN
    const isPowered = state.psu === 'on' && state.power_cable_plugged;
    let rpm = isPowered && state.fan_connected ? 1420 : 0;

    // CPU Temp simulation:
    // Idle baseline ~32C
    // If powered:
    //   - If cooler seated + paste + fan spinning: ~38C (healthy)
    //   - If cooler seated without paste or film left on: ~78C (overheating)
    //   - If cooler unseated: ~92C (thermal throttle)
    //   - If fan not spinning: +25C
    let temp = 24.0; // Ambient room temp
    if (isPowered) {
      temp = 35.0;
      if (state.cooler === 'seated') {
        if (state.film_on) {
          temp += 38.0; // Thermal barrier
        }
        if (!state.paste.present || state.paste.size < 0.2) {
          temp += 25.0; // No paste
        }
        if (!state.fan_connected) {
          temp += 20.0; // No active airflow
        }
      } else {
        temp = 89.0; // Bare CPU running
      }
    }

    if (this.noise) {
      rpm += rpm > 0 ? (Math.random() - 0.5) * 60 : 0;
      temp += (Math.random() - 0.5) * 1.5;
    }

    return {
      psu_state: isPowered ? 'on' : 'off',
      fan_header_connected: state.fan_connected,
      fan_rpm: Math.round(rpm),
      cpu_temp: parseFloat(temp.toFixed(1)),
      timestamp: now,
      dropout_active: false,
      noise_active: this.noise,
    };
  }
}
