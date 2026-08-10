const BEHAVIOR_TANH_MIN = -8;
const BEHAVIOR_TANH_MAX = 8;
const BEHAVIOR_TANH_LUT = new Float32Array(2048);
const BEHAVIOR_TANH_SCALE = (BEHAVIOR_TANH_LUT.length - 1) / (BEHAVIOR_TANH_MAX - BEHAVIOR_TANH_MIN);
for (let index = 0; index < BEHAVIOR_TANH_LUT.length; index += 1) {
  const x = BEHAVIOR_TANH_MIN + index / BEHAVIOR_TANH_SCALE;
  BEHAVIOR_TANH_LUT[index] = Math.tanh(x);
}

function behaviorHermite(y0, y1, y2, y3, mu) {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1;
}

function behaviorTanh(value) {
  if (value <= BEHAVIOR_TANH_MIN) return -1;
  if (value >= BEHAVIOR_TANH_MAX) return 1;
  const position = (value - BEHAVIOR_TANH_MIN) * BEHAVIOR_TANH_SCALE;
  const index = Math.floor(position);
  const mu = position - index;
  const last = BEHAVIOR_TANH_LUT.length - 1;
  const i0 = index > 0 ? index - 1 : 0;
  const i2 = index < last ? index + 1 : last;
  const i3 = index + 2 < last ? index + 2 : last;
  return behaviorHermite(BEHAVIOR_TANH_LUT[i0], BEHAVIOR_TANH_LUT[index], BEHAVIOR_TANH_LUT[i2], BEHAVIOR_TANH_LUT[i3], mu);
}

class CalcotoneBehaviorMemoryProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'profile', defaultValue: 0, minValue: 0, maxValue: 12, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 0.12, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'motion', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'memory', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'color', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.resetState();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'reset') this.resetState();
    };
  }

  resetState() {
    this.state = [this.makeState(0.9971, 0.31), this.makeState(1.0023, 0.67)];
  }

  makeState(mismatch, phaseSeed) {
    return {
      mismatch,
      envelope: 0,
      slow: 0,
      position: 0,
      velocity: 0,
      charge: 0,
      absorption: 0,
      remanence: 0,
      previous: 0,
      slew: 0,
      loss: 0,
      thermal: 0,
      rail: 1,
      phase: phaseSeed * Math.PI * 2,
      fatigue: 0,
    };
  }

  updateCommon(input, motion, memory, s) {
    const absolute = Math.abs(input);
    const attack = 0.012 + motion * 0.032;
    const release = 0.00018 + (1 - memory) * 0.0014;
    s.envelope += (absolute - s.envelope) * (absolute > s.envelope ? attack : release);
    s.slow += (s.envelope - s.slow) * (0.00004 + memory * 0.00018);

    const delta = input - s.previous;
    s.previous = input;
    s.slew += (delta - s.slew) * (0.13 + (1 - memory) * 0.24);

    const heatTarget = Math.min(1.5, s.envelope * s.envelope + Math.abs(s.slew) * 0.22);
    s.thermal += (heatTarget - s.thermal) * (heatTarget > s.thermal ? 0.00072 + motion * 0.00045 : 0.000035 + (1 - memory) * 0.00008);

    const sagTarget = Math.max(0.91, 1 - s.envelope * (0.012 + memory * 0.022) - s.thermal * 0.006);
    s.rail += (sagTarget - s.rail) * (sagTarget < s.rail ? 0.0024 : 0.00018 + (1 - memory) * 0.00022);

    s.phase += 0.00019 + motion * 0.00115 + s.envelope * 0.00011;
    if (s.phase > Math.PI * 2) s.phase -= Math.PI * 2;

    s.fatigue += (s.envelope - s.fatigue) * (0.000025 + memory * 0.000075);
    return delta;
  }

  processSample(input, profile, amount, motion, memory, color, s) {
    const delta = this.updateCommon(input, motion, memory, s);
    let residual = 0;

    switch (profile) {
      case 1: { // elastic: compliance + damping + amplitude-dependent stiffness
        const stiffness = (0.0014 + (1 - memory) * 0.0062) * (1 + s.envelope * (0.18 + color * 0.24));
        const damping = 0.966 - motion * 0.058 - s.thermal * 0.004;
        s.velocity = s.velocity * damping + (input - s.position) * stiffness;
        s.position += s.velocity;
        const hystereticDrag = s.velocity * Math.abs(s.position) * (0.018 + memory * 0.022);
        residual = (s.position - input) * (0.17 + color * 0.22) - hystereticDrag;
        break;
      }
      case 2: { // rotor: inertia, drag, bearing load and tiny deterministic eccentricity
        const drag = 0.992 - motion * 0.018 - s.fatigue * 0.0025;
        s.velocity = s.velocity * drag + delta * (0.012 + motion * 0.03);
        s.position += s.velocity;
        const eccentricity = Math.sin(s.phase) * s.envelope * (0.0015 + color * 0.0025);
        residual = behaviorTanh(s.velocity * 3.2) * 0.043 + s.slow * s.velocity * 0.03 + eccentricity;
        break;
      }
      case 3: { // fluid: slow bulk motion + viscosity/shear + thermal thinning
        s.position += (input - s.position) * (0.0007 + (1 - memory) * 0.0032);
        const shear = input - s.position;
        const viscosity = (1.15 + color * 2.75) * (1 - Math.min(0.18, s.thermal * 0.06));
        residual = behaviorTanh(shear * viscosity) * (0.034 + motion * 0.04) - s.slew * s.fatigue * 0.006;
        break;
      }
      case 4: { // orbital: inertial phase memory with envelope-weighted trajectory error
        s.velocity = s.velocity * (0.987 - memory * 0.012) + delta * (0.018 + motion * 0.022);
        s.position = s.position * 0.99935 + s.velocity;
        const orbit = Math.sin(s.position * (0.55 + color * 0.9) + s.phase * 0.18);
        residual = orbit * s.envelope * 0.027 + Math.cos(s.phase) * s.slow * 0.0025;
        break;
      }
      case 5: { // charge: capacitor settling + dielectric absorption/leakage
        const leakage = 0.994 - memory * 0.008;
        s.charge = s.charge * leakage + input * (0.006 + (1 - memory) * 0.006);
        s.absorption += (s.charge - s.absorption) * (0.00045 + memory * 0.0014);
        const dielectricReturn = (s.absorption - s.charge) * (0.018 + memory * 0.018);
        const transferError = (input - s.charge) * (0.017 + color * 0.034);
        residual = transferError + dielectricReturn + behaviorTanh(s.charge * 2.2) * 0.011;
        break;
      }
      case 6: { // magnetic: dynamic coercion, remanence, core loss and thermal permeability drift
        const coercion = (0.0017 + (1 - memory) * 0.0052) * (1 - Math.min(0.16, s.thermal * 0.055));
        const field = input + s.remanence * (0.20 + memory * 0.055);
        const target = behaviorTanh(field * (1.08 + color * 1.72));
        s.remanence += (target - s.remanence) * coercion;
        s.loss += (Math.abs(delta) - s.loss) * (0.0035 + motion * 0.0012);
        const dynamicLoss = Math.sign(input || 1) * s.loss * (0.003 + motion * 0.006);
        residual = (s.remanence - input) * (0.066 + memory * 0.008) - dynamicLoss - input * s.thermal * 0.0025;
        break;
      }
      case 7: { // acoustic: stored pressure/energy with lossy boundary recovery
        s.position += (input - s.position) * (0.0018 + (1 - memory) * 0.0042);
        s.velocity = s.velocity * (0.984 - motion * 0.003) + (input - s.position) * 0.0032;
        s.absorption += (s.position - s.absorption) * (0.0006 + color * 0.0009);
        residual = (s.position + s.velocity * (0.38 + color * 0.72) - input) * 0.052 + (s.absorption - s.position) * 0.012;
        break;
      }
      case 8: { // granular: finite reconstruction memory + edge-density stress
        s.charge = s.charge * (0.97 + memory * 0.024) + input * (0.03 - memory * 0.018);
        const edge = input - s.charge;
        s.fatigue += (Math.abs(edge) - s.fatigue) * 0.0011;
        residual = behaviorTanh(edge * (1.18 + color * 2.22)) * (0.024 + motion * 0.034) + s.slew * s.fatigue * 0.004;
        break;
      }
      case 9: { // transport: capstan inertia, belt elasticity, head-contact drag and periodic eccentricity
        s.velocity = s.velocity * (0.995 - motion * 0.0042) + delta * 0.006;
        s.position += (s.velocity - s.position) * (0.00055 + (1 - memory) * 0.00045);
        const eccentricity = Math.sin(s.phase) * (0.004 + motion * 0.006);
        const contact = (s.velocity - s.position) * (0.058 + color * 0.05);
        residual = contact + s.envelope * s.position * 0.017 + eccentricity * s.slow;
        break;
      }
      case 10: { // console: supply sag, recovery, thermal drift and finite slew
        const railError = input * (s.rail - 1);
        const slewError = (s.slew - delta) * (0.012 + color * 0.018);
        const thermalBias = Math.sign(input || 1) * s.thermal * (color - 0.5) * 0.0018;
        const soft = behaviorTanh((input + thermalBias) * (1.015 + color * 0.18)) - input;
        residual = railError + slewError + soft * 0.34;
        break;
      }
      case 11: { // converter: finite settling, aperture memory and level-dependent edge error
        const settle = 0.16 + (1 - memory) * 0.5;
        s.charge += (input - s.charge) * settle;
        s.absorption += (s.charge - s.absorption) * (0.025 + color * 0.045);
        const aperture = (s.absorption - input) * (0.018 + color * 0.027);
        residual = aperture + delta * motion * 0.0018 + s.slew * s.envelope * 0.0025;
        break;
      }
      case 12: { // fracture: stressed structure, residual offset and deterministic intermittent instability
        s.velocity = s.velocity * (0.93 - s.fatigue * 0.01) + delta * (0.025 + motion * 0.04);
        s.position = s.position * 0.998 + s.velocity;
        s.remanence = s.remanence * 0.9991 + Math.sign(input || 1) * s.envelope * 0.00003;
        const stress = Math.max(0, s.envelope - (0.28 + (1 - memory) * 0.32));
        const chatter = Math.sin(s.phase * (5 + color * 7)) * stress * (0.012 + motion * 0.018);
        residual = behaviorTanh((s.position + s.remanence) * (1.4 + color * 2.5)) * 0.043 + chatter;
        break;
      }
      default:
        residual = 0;
    }

    const scaled = residual * amount * s.mismatch;
    const output = input + scaled;
    return Number.isFinite(output) ? Math.max(-1.35, Math.min(1.35, output)) : 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    const profile = Math.max(0, Math.min(12, Math.round(parameters.profile[0])));
    const amount = Math.max(0, Math.min(1, parameters.amount[0]));
    const motion = Math.max(0, Math.min(1, parameters.motion[0]));
    const memory = Math.max(0, Math.min(1, parameters.memory[0]));
    const color = Math.max(0, Math.min(1, parameters.color[0]));

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL ? inL[i] : 0;
      const right = inR ? inR[i] : left;
      outL[i] = this.processSample(Number.isFinite(left) ? left : 0, profile, amount, motion, memory, color, this.state[0]);
      outR[i] = this.processSample(Number.isFinite(right) ? right : 0, profile, amount, motion, memory, color, this.state[1]);
    }
    return true;
  }
}

registerProcessor('calcotone-behavior-memory-processor', CalcotoneBehaviorMemoryProcessor);
