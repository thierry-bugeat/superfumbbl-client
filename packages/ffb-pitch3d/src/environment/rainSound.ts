/**
 * Averse et tonnerre, synthétisés. La référence est une pluie continue avec des
 * impacts irréguliers, puis un tonnerre qui roule après l'éclair : le flash est
 * immédiat, le son arrive ensuite.
 *
 * Quatre boucles de durées premières entre elles évitent qu'on entende le raccord.
 * Le tonnerre est fabriqué à chaque éclair, pour ne pas se répéter.
 */
import type { RainSettings } from './rain';

const DROP_MIN = 500;
const DROP_MAX = 15000;

/** Le curseur baisse toute la tempête. Le tonnerre reste devant la pluie. */
const THUNDER_LIFT = 2.8;

interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

export class RainSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private thunderBus: GainNode | null = null;
  private rainBus: GainNode | null = null;
  private gustGain: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private sheetGain: GainNode | null = null;
  private dropGain: GainNode | null = null;
  private closeGain: GainNode | null = null;
  private readonly sources: AudioBufferSourceNode[] = [];
  private raining = false;
  private disposed = false;
  private volume = 0.05;
  private amount = 0.74;
  private windAmount = 0.24;
  private gust = 1;
  private gustTarget = 1;
  private untilGust = 1.5;
  private voices = 0;

  setParams(settings: RainSettings): void {
    this.volume = settings.volume;
    this.amount = rainAmount(settings.drops);
    this.windAmount = Math.min(1, Math.abs(settings.wind) / 25);
    if (!this.ctx) {
      if (this.raining && this.volume > 0) this.ensure();
      return;
    }
    this.applyMix();
    if (this.volume <= 0) this.fadeRain(0);
    else if (this.raining) this.fadeRain(1);
  }

  setRaining(on: boolean): void {
    this.raining = on;
    if (!on && !this.ctx) return;
    if (on && this.volume > 0) this.ensure();
    this.fadeRain(on && this.volume > 0 ? 1 : 0);
    this.resume();
  }

  /** À appeler dans un geste : le navigateur tient le contexte suspendu jusque-là. */
  unlock(): void {
    if (this.disposed) return;
    if (this.raining && this.volume > 0) this.ensure();
    this.resume();
  }

  thunder(): void {
    if (this.disposed || this.volume <= 0 || this.voices >= 4) return;
    const ctx = this.ensure();
    if (!ctx || !this.thunderBus) return;
    this.resume();
    const close = Math.random() < 0.4;
    const pan = (Math.random() * 2 - 1) * 0.72;
    const delay = close ? 0.05 + Math.random() * 0.18 : 0.16 + Math.random() * 0.42;
    const gain = close ? 0.92 : 0.56;
    this.spawnClap(ctx, close, delay, gain, pan);
    if (Math.random() < 0.8) {
      this.spawnClap(ctx, false, delay + 0.45 + Math.random() * 1.15, 0.34 + Math.random() * 0.16, (Math.random() * 2 - 1) * 0.85);
    }
  }

  tick(dt: number): void {
    if (!this.ctx || !this.gustGain || !this.raining) return;
    this.untilGust -= dt;
    if (this.untilGust <= 0) {
      this.untilGust = 2.2 + Math.random() * 4.4;
      const depth = 0.02 + this.windAmount * 0.1;
      this.gustTarget = 1 - depth + Math.random() * depth * 2;
    }
    const follow = 1 - Math.exp(-dt * 1.3);
    this.gust += (this.gustTarget - this.gust) * follow;
    this.gustGain.gain.setValueAtTime(this.gust, this.ctx.currentTime);
  }

  dispose(): void {
    this.disposed = true;
    this.raining = false;
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
    this.thunderBus = null;
    this.rainBus = null;
    this.gustGain = null;
    this.bedGain = null;
    this.sheetGain = null;
    this.dropGain = null;
    this.closeGain = null;
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
    const thunderBus = ctx.createGain();
    const rainBus = ctx.createGain();
    const gustGain = ctx.createGain();
    const bedGain = ctx.createGain();
    const sheetGain = ctx.createGain();
    const dropGain = ctx.createGain();
    const closeGain = ctx.createGain();
    master.gain.value = this.volume;
    thunderBus.gain.value = THUNDER_LIFT;
    rainBus.gain.value = 0;
    gustGain.gain.value = 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 2.2;
    comp.attack.value = 0.012;
    comp.release.value = 0.32;

    bedGain.connect(rainBus);
    sheetGain.connect(gustGain);
    dropGain.connect(rainBus);
    closeGain.connect(rainBus);
    gustGain.connect(rainBus);
    rainBus.connect(master);
    thunderBus.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);

    this.master = master;
    this.thunderBus = thunderBus;
    this.rainBus = rainBus;
    this.gustGain = gustGain;
    this.bedGain = bedGain;
    this.sheetGain = sheetGain;
    this.dropGain = dropGain;
    this.closeGain = closeGain;
    this.applyMix();

    const rate = ctx.sampleRate;
    this.playLoop(ctx, renderLoop(rate, 9.1, 0.15, fillBed), bedGain);
    this.playLoop(ctx, renderLoop(rate, 7.3, 0.13, fillSheet), sheetGain);
    this.playLoop(ctx, renderLoop(rate, 8.4, 0.11, (left, right, sampleRate) => fillDrops(left, right, sampleRate, false)), dropGain);
    this.playLoop(ctx, renderLoop(rate, 11.2, 0.08, (left, right, sampleRate) => fillDrops(left, right, sampleRate, true)), closeGain);
  }

  private playLoop(ctx: AudioContext, stereo: Stereo, gain: GainNode): void {
    const source = ctx.createBufferSource();
    source.buffer = toBuffer(ctx, stereo);
    source.loop = true;
    source.connect(gain);
    source.start();
    this.sources.push(source);
  }

  private applyMix(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.bedGain || !this.sheetGain || !this.dropGain || !this.closeGain) return;
    const a = this.amount;
    const wind = this.windAmount;
    const now = ctx.currentTime;
    const tau = 0.18;
    this.master.gain.setTargetAtTime(this.volume, now, 0.04);
    this.bedGain.gain.setTargetAtTime(0.2 + a * 0.26, now, tau);
    this.sheetGain.gain.setTargetAtTime((0.12 + a * 0.22) * (1 + wind * 0.12), now, tau);
    this.dropGain.gain.setTargetAtTime(0.46 + a * 0.7, now, tau);
    this.closeGain.gain.setTargetAtTime(0.32 + a * a * 0.55, now, tau);
  }

  private fadeRain(level: number): void {
    if (!this.rainBus || !this.ctx) return;
    this.rainBus.gain.setTargetAtTime(level, this.ctx.currentTime, level > 0 ? 0.55 : 0.32);
  }

  private spawnClap(ctx: AudioContext, close: boolean, delay: number, gain: number, pan: number): void {
    if (this.voices >= 5 || !this.thunderBus) return;
    const source = ctx.createBufferSource();
    source.buffer = toBuffer(ctx, renderThunder(ctx.sampleRate, close));
    const amp = ctx.createGain();
    amp.gain.value = gain;
    source.connect(amp);
    let tail: AudioNode = amp;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      amp.connect(panner);
      tail = panner;
    }
    tail.connect(this.thunderBus);
    source.start(ctx.currentTime + delay);
    this.voices += 1;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      try {
        source.disconnect();
        amp.disconnect();
        if (tail !== amp) tail.disconnect();
      } catch {
        /* contexte déjà fermé */
      }
    };
  }
}

/** 6000 gouttes, le réglage d'origine, doit déjà sonner comme une averse. */
function rainAmount(drops: number): number {
  const lin = (drops - DROP_MIN) / (DROP_MAX - DROP_MIN);
  const clamped = Math.min(1, Math.max(0, lin));
  return Math.min(1, 0.2 + Math.pow(clamped, 0.62) * 0.95);
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
  const fade = Math.floor(sampleRate * 0.07);
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

/** Corps sourd de l'averse, sous la nappe. Le sous-grave est laissé au tonnerre. */
function fillBed(left: Float32Array, right: Float32Array, sampleRate: number): void {
  let bL = 0;
  let bR = 0;
  for (let i = 0; i < left.length; i++) {
    bL = (bL + (Math.random() * 2 - 1)) * 0.992;
    bR = (bR + (Math.random() * 2 - 1)) * 0.992;
    const t = i / sampleRate;
    left[i] = bL * (0.88 + 0.12 * Math.sin(t * 0.31));
    right[i] = bR * (0.88 + 0.12 * Math.sin(t * 0.31 + 1.7));
  }
  lowpassInPlace(left, sampleRate, 1100);
  lowpassInPlace(right, sampleRate, 1160);
  highpassInPlace(left, sampleRate, 180);
  highpassInPlace(right, sampleRate, 190);
  highpassInPlace(left, sampleRate, 180);
  highpassInPlace(right, sampleRate, 190);
}

/** Nappe de pluie : le médium continu, plus un peu d'air au-dessus. */
function fillSheet(left: Float32Array, right: Float32Array, sampleRate: number): void {
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.random() * 2 - 1;
    right[i] = Math.random() * 2 - 1;
  }
  highpassInPlace(left, sampleRate, 420);
  highpassInPlace(right, sampleRate, 460);
  lowpassInPlace(left, sampleRate, 2200);
  lowpassInPlace(right, sampleRate, 2350);
  lowpassInPlace(left, sampleRate, 2200);
  lowpassInPlace(right, sampleRate, 2350);

  let lowL = 0;
  let lowR = 0;
  let bandL = 0;
  let bandR = 0;
  const upper = 1 - Math.exp((-2 * Math.PI * 7800) / sampleRate);
  const lower = 1 - Math.exp((-2 * Math.PI * 4200) / sampleRate);
  let flutterL = 1;
  let flutterR = 1;
  for (let i = 0; i < left.length; i++) {
    const xL = Math.random() * 2 - 1;
    const xR = Math.random() * 2 - 1;
    lowL += (xL - lowL) * upper;
    lowR += (xR - lowR) * upper;
    bandL += (lowL - bandL) * lower;
    bandR += (lowR - bandR) * lower;
    flutterL += (0.96 + Math.random() * 0.08 - flutterL) * 0.0005;
    flutterR += (0.96 + Math.random() * 0.08 - flutterR) * 0.0005;
    left[i] = ((left[i] ?? 0) + (lowL - bandL) * 0.03) * flutterL;
    right[i] = ((right[i] ?? 0) + (lowR - bandR) * 0.03) * flutterR;
  }
}

/**
 * Impacts. `close` : les gouttes proches, assez lourdes pour se détacher.
 * Les autres sont plus nombreuses, mais chacune reste un choc, pas un sifflement.
 */
function fillDrops(left: Float32Array, right: Float32Array, sampleRate: number, close: boolean): void {
  const seconds = left.length / sampleRate;
  const count = Math.floor(seconds * (close ? 8 : 42));
  for (let d = 0; d < count; d++) {
    const durSec = close ? 0.02 + Math.random() * 0.034 : 0.01 + Math.random() * 0.016;
    const dur = Math.max(8, Math.floor(durSec * sampleRate));
    const start = Math.floor(Math.random() * left.length);
    const freq = close ? 380 + Math.random() * 900 : 700 + Math.random() * 1600;
    const amp = Math.pow(Math.random(), close ? 0.55 : 1.45) * (close ? 1.15 : 0.55);
    const pan = Math.random();
    const lGain = Math.cos(pan * Math.PI * 0.5);
    const rGain = Math.sin(pan * Math.PI * 0.5);
    const upper = 1 - Math.exp((-2 * Math.PI * freq) / sampleRate);
    const lower = 1 - Math.exp((-2 * Math.PI * freq * 0.42) / sampleRate);
    const decay = dur * (close ? 0.34 : 0.28);
    let low = 0;
    let band = 0;
    for (let i = 0; i < dur; i++) {
      const idx = start + i;
      if (idx >= left.length) break;
      const x = Math.random() * 2 - 1;
      low += (x - low) * upper;
      band += (low - band) * lower;
      const env = Math.exp(-i / decay);
      const y = (low - band) * env * amp;
      left[idx] = (left[idx] ?? 0) + y * lGain;
      right[idx] = (right[idx] ?? 0) + y * rGain;
    }
  }
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.tanh(left[i] ?? 0);
    right[i] = Math.tanh(right[i] ?? 0);
  }
}

function renderThunder(sampleRate: number, close: boolean): Stereo {
  const duration = close ? 2.3 + Math.random() * 1.5 : 4.4 + Math.random() * 3.2;
  const n = Math.floor(sampleRate * duration);
  const mono = new Float32Array(n);
  const attack = close ? 0.004 + Math.random() * 0.01 : 0.06 + Math.random() * 0.16;
  const decay = close ? 0.75 + Math.random() * 0.55 : 1.45 + Math.random() * 1.15;
  const crack = close ? 0.75 + Math.random() * 0.4 : 0.1 + Math.random() * 0.16;
  const sineHz = (close ? 62 : 38) + Math.random() * 16;
  const cutoff0 = close ? 1200 + Math.random() * 700 : 240 + Math.random() * 140;
  const cutoff1 = close ? 70 + Math.random() * 30 : 42 + Math.random() * 18;
  const bumpCount = close ? 2 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
  const bumps: { at: number; amp: number; decay: number }[] = [];
  let cursor = attack + 0.06;
  for (let b = 0; b < bumpCount; b++) {
    cursor += 0.09 + Math.random() * (close ? 0.24 : 0.62);
    if (cursor > duration * 0.72) break;
    bumps.push({
      at: cursor,
      amp: (0.28 + Math.random() * 0.4) * (close ? 1 : 0.65),
      decay: decay * (0.38 + Math.random() * 0.35),
    });
  }

  let low = 0;
  let prevWhite = 0;
  let prevHp = 0;
  let phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const u = duration <= 0 ? 1 : t / duration;
    const white = Math.random() * 2 - 1;
    const cutoff = cutoff0 * Math.pow(cutoff1 / cutoff0, Math.min(1, u));
    const coeff = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    low += (white - low) * coeff;

    let env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    for (const bump of bumps) {
      if (t >= bump.at) env += Math.exp(-(t - bump.at) / bump.decay) * bump.amp;
    }
    const tail = Math.min(1, (duration - t) / 0.07);
    env *= tail;

    const hz = sineHz * Math.pow(0.52, u);
    phase += (2 * Math.PI * hz) / sampleRate;
    const hp = white - prevWhite + 0.965 * prevHp;
    prevWhite = white;
    prevHp = hp;
    const crackEnv = Math.exp(-t / (close ? 0.04 : 0.09)) * crack;
    let clicks = 0;
    if (close) {
      for (const bump of bumps) {
        const dt = t - bump.at;
        if (dt >= 0 && dt < 0.028) clicks += Math.exp(-dt / 0.007) * bump.amp;
      }
    }
    const sample = low * env * 1.45 + Math.sin(phase) * env * (close ? 0.32 : 0.48) + hp * crackEnv * 0.42 + hp * clicks * 0.22;
    mono[i] = Math.tanh(sample);
  }

  addSlaps(mono, sampleRate);
  const right = new Float32Array(n);
  const shift = Math.floor(sampleRate * (0.004 + Math.random() * 0.009));
  let delayed = 0;
  const dull = 1 - Math.exp((-2 * Math.PI * 3200) / sampleRate);
  for (let i = 0; i < n; i++) {
    const src = mono[i - shift] ?? 0;
    delayed += (src - delayed) * dull;
    right[i] = delayed;
  }
  peakNormalize(mono, right, 0.9);
  return { left: mono, right };
}

/** Échos de plus en plus sourds : le roulement dans le lointain, pas un délai sec. */
function addSlaps(data: Float32Array, sampleRate: number): void {
  const taps = [0.034, 0.078, 0.15, 0.27, 0.46].map((time) => time * (0.86 + Math.random() * 0.36));
  const gains = [0.4, 0.28, 0.18, 0.11, 0.06];
  const copy = data.slice();
  for (let t = 0; t < taps.length; t++) {
    const delay = Math.floor((taps[t] ?? 0) * sampleRate);
    const g = gains[t] ?? 0;
    const cutoff = 1100 - t * 160;
    const coeff = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    let low = 0;
    for (let i = delay; i < data.length; i++) {
      low += ((copy[i - delay] ?? 0) - low) * coeff;
      data[i] = (data[i] ?? 0) + low * g;
    }
  }
}

function lowpassInPlace(data: Float32Array, sampleRate: number, freq: number): void {
  const coeff = 1 - Math.exp((-2 * Math.PI * freq) / sampleRate);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += ((data[i] ?? 0) - y) * coeff;
    data[i] = y;
  }
}

function highpassInPlace(data: Float32Array, sampleRate: number, freq: number): void {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * freq);
  const a = rc / (rc + dt);
  let prevX = data[0] ?? 0;
  let prevY = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i] ?? 0;
    const y = a * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    data[i] = y;
  }
}

function rmsNormalize(left: Float32Array, right: Float32Array, target: number): void {
  const level = Math.max(signalRms(left), signalRms(right));
  if (level < 1e-6) return;
  const g = target / level;
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const l = (left[i] ?? 0) * g;
    const r = (right[i] ?? 0) * g;
    left[i] = l;
    right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  if (peak <= 0.98) return;
  const trim = 0.98 / peak;
  for (let i = 0; i < left.length; i++) {
    left[i] = (left[i] ?? 0) * trim;
    right[i] = (right[i] ?? 0) * trim;
  }
}

function peakNormalize(left: Float32Array, right: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
  if (max < 1e-5) return;
  const g = peak / max;
  for (let i = 0; i < left.length; i++) {
    left[i] = (left[i] ?? 0) * g;
    right[i] = (right[i] ?? 0) * g;
  }
}

function signalRms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, data.length));
}
