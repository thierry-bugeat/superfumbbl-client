/**
 * Campagne par beau temps : des chants d'oiseaux, et un air très léger.
 * Le vent de la référence reste en retrait. Rien n'est repris d'un enregistrement.
 */

interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

const MASTER = 0.55;
const WIND_GAIN = 0.04;

export class NatureSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private gustGain: GainNode | null = null;
  private readonly sources: AudioBufferSourceNode[] = [];
  private active = false;
  private disposed = false;
  private gust = 0.025;
  private gustTarget = 0.025;
  private untilGust = 5;
  private gustHold = 0;

  setActive(on: boolean): void {
    this.active = on;
    if (!on && !this.ctx) return;
    if (on) this.ensure();
    this.fade(on ? 1 : 0);
    this.resume();
  }

  /** Le fond reste bas. Une rafale monte, tient un instant, puis retombe. */
  tick(dt: number): void {
    if (!this.ctx || !this.gustGain || !this.active || dt <= 0) return;
    this.untilGust -= dt;
    if (this.untilGust <= 0 && this.gustHold <= 0) {
      this.gustTarget = 0.06 + Math.random() * 0.035;
      this.gustHold = 0.7 + Math.random() * 1.1;
      this.untilGust = 8 + Math.random() * 11;
    }
    if (this.gustHold > 0) {
      this.gustHold -= dt;
      if (this.gustHold <= 0) this.gustTarget = 0.02 + Math.random() * 0.02;
    }
    const rising = this.gustTarget > this.gust;
    const follow = 1 - Math.exp(-dt * (rising ? 1.8 : 0.65));
    this.gust += (this.gustTarget - this.gust) * follow;
    this.gustGain.gain.setValueAtTime(this.gust, this.ctx.currentTime);
  }

  unlock(): void {
    if (this.disposed) return;
    if (this.active) this.ensure();
    this.resume();
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* déjà arrêté */
      }
      source.disconnect();
    }
    this.sources.length = 0;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.gustGain = null;
    if (ctx) void ctx.close();
  }

  private ensure(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.build(ctx);
    return ctx;
  }

  private resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    const bus = ctx.createGain();
    const wind = ctx.createGain();
    const gust = ctx.createGain();
    const near = ctx.createGain();
    const far = ctx.createGain();
    master.gain.value = MASTER;
    bus.gain.value = 0;
    wind.gain.value = WIND_GAIN;
    gust.gain.value = this.gust;
    near.gain.value = 0.015;
    far.gain.value = 0.009;

    wind.connect(bus);
    gust.connect(bus);
    near.connect(bus);
    far.connect(bus);
    bus.connect(master);
    master.connect(ctx.destination);

    this.master = master;
    this.bus = bus;
    this.gustGain = gust;

    const rate = ctx.sampleRate;
    this.playLoop(ctx, renderLoop(rate, 11.3, 0.1, fillWind), wind);
    this.playLoop(ctx, renderLoop(rate, 9.7, 0.09, fillGust), gust);
    this.playLoop(ctx, renderLoop(rate, 13.7, 0.08, (left, right, sampleRate) => fillBirds(left, right, sampleRate, 0.85)), near);
    this.playLoop(ctx, renderLoop(rate, 17.9, 0.05, (left, right, sampleRate) => fillBirds(left, right, sampleRate, 0.35, true)), far);
    this.fade(this.active ? 1 : 0);
  }

  private playLoop(ctx: AudioContext, stereo: Stereo, gain: GainNode): void {
    const source = ctx.createBufferSource();
    source.buffer = toBuffer(ctx, stereo);
    source.loop = true;
    source.connect(gain);
    source.start();
    this.sources.push(source);
  }

  private fade(level: number): void {
    if (!this.bus || !this.ctx) return;
    this.bus.gain.setTargetAtTime(level, this.ctx.currentTime, level > 0 ? 0.7 : 0.35);
  }
}

function audioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const legacy = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return window.AudioContext ?? legacy ?? null;
}

function toBuffer(ctx: AudioContext, stereo: Stereo): AudioBuffer {
  const buffer = ctx.createBuffer(2, stereo.left.length, ctx.sampleRate);
  buffer.getChannelData(0).set(stereo.left);
  buffer.getChannelData(1).set(stereo.right);
  return buffer;
}

function renderLoop(
  sampleRate: number,
  seconds: number,
  targetRms: number,
  fill: (left: Float32Array, right: Float32Array, sampleRate: number) => void,
): Stereo {
  const fade = Math.floor(sampleRate * 0.08);
  const n = Math.floor(sampleRate * seconds);
  const left = new Float32Array(n + fade);
  const right = new Float32Array(n + fade);
  fill(left, right, sampleRate);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    left[i] = (left[i] ?? 0) * k + (left[n + i] ?? 0) * (1 - k);
    right[i] = (right[i] ?? 0) * k + (right[n + i] ?? 0) * (1 - k);
  }
  const outL = left.subarray(0, n);
  const outR = right.subarray(0, n);
  rmsNormalize(outL, outR, targetRms);
  return { left: outL, right: outR };
}

/** Souffle continu, bas et sourd. Les rafales vivent sur une autre couche. */
function fillWind(left: Float32Array, right: Float32Array, sampleRate: number): void {
  let bL = 0;
  let bR = 0;
  for (let i = 0; i < left.length; i++) {
    bL = (bL + (Math.random() * 2 - 1)) * 0.99;
    bR = (bR + (Math.random() * 2 - 1)) * 0.99;
    const t = i / sampleRate;
    const slow = 0.82 + 0.18 * Math.sin(t * 0.23);
    left[i] = bL * slow;
    right[i] = bR * (0.82 + 0.18 * Math.sin(t * 0.19 + 1.2));
  }
  lowpass(left, sampleRate, 520);
  lowpass(right, sampleRate, 560);
  highpass(left, sampleRate, 90);
  highpass(right, sampleRate, 100);
}

/** Air plus ouvert, qui ne s'entend que quand une rafale monte le gain. */
function fillGust(left: Float32Array, right: Float32Array, sampleRate: number): void {
  let bL = 0;
  let bR = 0;
  for (let i = 0; i < left.length; i++) {
    bL = (bL + (Math.random() * 2 - 1)) * 0.965;
    bR = (bR + (Math.random() * 2 - 1)) * 0.965;
    left[i] = bL;
    right[i] = bR;
  }
  lowpass(left, sampleRate, 1500);
  lowpass(right, sampleRate, 1650);
  highpass(left, sampleRate, 180);
  highpass(right, sampleRate, 210);
}

function fillBirds(left: Float32Array, right: Float32Array, sampleRate: number, perSecond: number, distant = false): void {
  const seconds = left.length / sampleRate;
  const count = Math.max(1, Math.floor(seconds * perSecond));
  for (let call = 0; call < count; call++) {
    const at = Math.random() * seconds;
    const pan = Math.random() * 1.6 - 0.8;
    const kind = Math.floor(Math.random() * 4);
    const amp = (distant ? 0.28 : 0.62) + Math.random() * 0.28;
    if (kind === 0) {
      const f0 = 2600 + Math.random() * 900;
      addSweep(left, right, sampleRate, at, 0.11 + Math.random() * 0.08, f0, f0 * (0.62 + Math.random() * 0.12), amp, pan);
    } else if (kind === 1) {
      const f = 1700 + Math.random() * 700;
      addSweep(left, right, sampleRate, at, 0.06, f, f * 1.08, amp * 0.8, pan);
      addSweep(left, right, sampleRate, at + 0.09, 0.07, f * 1.12, f * 0.94, amp, pan);
    } else if (kind === 2) {
      const notes = 4 + Math.floor(Math.random() * 3);
      const f = 3000 + Math.random() * 1200;
      for (let n = 0; n < notes; n++) {
        addSweep(left, right, sampleRate, at + n * 0.038, 0.03, f + n * 80, f + n * 40, amp * 0.55, pan);
      }
    } else {
      const f0 = 900 + Math.random() * 500;
      addSweep(left, right, sampleRate, at, 0.18 + Math.random() * 0.08, f0, f0 * 0.72, amp * 0.55, pan * 0.4);
    }
  }
}

function addSweep(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  start: number,
  dur: number,
  f0: number,
  f1: number,
  amp: number,
  pan: number,
): void {
  const i0 = Math.floor(start * sampleRate);
  const n = Math.max(1, Math.floor(dur * sampleRate));
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  const gL = Math.cos(angle);
  const gR = Math.sin(angle);
  let phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= left.length) continue;
    const u = i / n;
    const freq = f0 * Math.pow(f1 / Math.max(1, f0), u);
    phase += (2 * Math.PI * freq) / sampleRate;
    const env = Math.sin(Math.PI * u) ** 0.65;
    const y = (Math.sin(phase) + 0.16 * Math.sin(phase * 2)) * env * amp;
    left[idx] = (left[idx] ?? 0) + y * gL;
    right[idx] = (right[idx] ?? 0) + y * gR;
  }
}

function rmsNormalize(left: Float32Array, right: Float32Array, target: number): void {
  let energy = 0;
  for (let i = 0; i < left.length; i++) energy += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
  const rms = Math.sqrt(energy / Math.max(1, left.length * 2));
  const gain = target / (rms || 1);
  for (let i = 0; i < left.length; i++) {
    left[i] = (left[i] ?? 0) * gain;
    right[i] = (right[i] ?? 0) * gain;
  }
}

function lowpass(data: Float32Array, sampleRate: number, freq: number): void {
  const coeff = 1 - Math.exp((-2 * Math.PI * freq) / sampleRate);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += ((data[i] ?? 0) - y) * coeff;
    data[i] = y;
  }
}

function highpass(data: Float32Array, sampleRate: number, freq: number): void {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * freq);
  const a = rc / (rc + dt);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i] ?? 0;
    const y = a * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    data[i] = y;
  }
}
