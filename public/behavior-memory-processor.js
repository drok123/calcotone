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
    this.state = [this.makeState(0.9971), this.makeState(1.0023)];
  }

  makeState(mismatch) {
    return {
      mismatch,
      envelope: 0,
      slow: 0,
      position: 0,
      velocity: 0,
      charge: 0,
      remanence: 0,
      previous: 0,
      loss: 0,
    };
  }

  processSample(input, profile, amount, motion, memory, color, s) {
    const absolute = Math.abs(input);
    const attack = 0.012 + motion * 0.032;
    const release = 0.00018 + (1 - memory) * 0.0014;
    s.envelope += (absolute - s.envelope) * (absolute > s.envelope ? attack : release);
    s.slow += (s.envelope - s.slow) * (0.00004 + memory * 0.00018);

    const delta = input - s.previous;
    s.previous = input;
    let residual = 0;

    switch (profile) {
      case 1: {
        const stiffness = 0.0015 + (1 - memory) * 0.006;
        const damping = 0.965 - motion * 0.06;
        s.velocity = s.velocity * damping + (input - s.position) * stiffness;
        s.position += s.velocity;
        residual = (s.position - input) * (0.18 + color * 0.22);
        break;
      }
      case 2: {
        const drag = 0.992 - motion * 0.018;
        s.velocity = s.velocity * drag + delta * (0.012 + motion * 0.03);
        s.position += s.velocity;
        residual = Math.tanh(s.velocity * 3.2) * 0.045 + s.slow * s.velocity * 0.03;
        break;
      }
      case 3: {
        s.slow += (input - s.slow) * (0.0008 + (1 - memory) * 0.0035);
        const shear = input - s.slow;
        residual = Math.tanh(shear * (1.2 + color * 2.8)) * (0.035 + motion * 0.04);
        break;
      }
      case 4: {
        s.velocity = s.velocity * (0.987 - memory * 0.012) + delta * (0.018 + motion * 0.022);
        s.position = s.position * 0.9994 + s.velocity;
        residual = Math.sin(s.position * (0.55 + color * 0.9)) * s.envelope * 0.028;
        break;
      }
      case 5: {
        const leakage = 0.994 - memory * 0.008;
        s.charge = s.charge * leakage + input * (0.006 + (1 - memory) * 0.006);
        const transferError = (input - s.charge) * (0.018 + color * 0.035);
        residual = transferError + Math.tanh(s.charge * 2.2) * 0.012;
        break;
      }
      case 6: {
        const coercion = 0.0018 + (1 - memory) * 0.005;
        const target = Math.tanh((input + s.remanence * 0.22) * (1.1 + color * 1.7));
        s.remanence += (target - s.remanence) * coercion;
        s.loss += (Math.abs(delta) - s.loss) * 0.004;
        residual = (s.remanence - input) * 0.07 - Math.sign(input) * s.loss * (0.003 + motion * 0.006);
        break;
      }
      case 7: {
        s.position += (input - s.position) * (0.002 + (1 - memory) * 0.004);
        s.velocity = s.velocity * 0.985 + (input - s.position) * 0.003;
        residual = (s.position + s.velocity * (0.4 + color * 0.7) - input) * 0.055;
        break;
      }
      case 8: {
        s.charge = s.charge * (0.97 + memory * 0.024) + input * (0.03 - memory * 0.018);
        const edge = input - s.charge;
        residual = Math.tanh(edge * (1.2 + color * 2.2)) * (0.025 + motion * 0.035);
        break;
      }
      case 9: {
        s.velocity = s.velocity * (0.995 - motion * 0.004) + delta * 0.006;
        s.slow += (s.velocity - s.slow) * 0.0007;
        residual = (s.velocity - s.slow) * (0.06 + color * 0.05) + s.envelope * s.slow * 0.018;
        break;
      }
      case 10: {
        s.charge += (s.envelope - s.charge) * (s.envelope > s.charge ? 0.003 : 0.00025);
        const rail = Math.max(0.94, 1 - s.charge * (0.012 + memory * 0.018));
        residual = input * (rail - 1) + Math.tanh(input * (1.02 + color * 0.16)) - input;
        residual *= 0.35;
        break;
      }
      case 11: {
        s.charge += (input - s.charge) * (0.18 + (1 - memory) * 0.48);
        residual = (s.charge - input) * (0.02 + color * 0.028) + delta * motion * 0.002;
        break;
      }
      case 12: {
        s.velocity = s.velocity * 0.93 + delta * (0.025 + motion * 0.04);
        s.position = s.position * 0.998 + s.velocity;
        residual = Math.tanh((s.position + s.remanence) * (1.4 + color * 2.5)) * 0.045;
        s.remanence = s.remanence * 0.999 + Math.sign(input) * s.envelope * 0.00003;
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
