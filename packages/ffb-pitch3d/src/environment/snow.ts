/**
 * Chute de neige : flocons, et une couche au sol qui fond.
 * Une case vaut 1. La couche couvre le terrain et l'herbe autour, jusqu'au dôme,
 * puis s'efface avant le bord. Elle fond encore quand les flocons s'arrêtent.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS } from '../coords';

const MAX_FLAKES = 12000;
const SPAWN_HEIGHT = 16;
const IMPACT_Y = 0.02;
/** Marge de la colonne au-dessus du 26 × 15. Le reste des flocons couvre les abords. */
const COLUMN_PAD = 1.5;
const MIN_X = edgeX(0);
const MAX_X = edgeX(PITCH_COLUMNS);
const MIN_Z = edgeZ(0);
const MAX_Z = edgeZ(PITCH_ROWS);
const PITCH_W = MAX_X - MIN_X;
const PITCH_D = MAX_Z - MIN_Z;
/** Part des flocons qui restent au-dessus du terrain. Les autres tombent sur l'herbe. */
const PITCH_FLAKE_SHARE = 0.62;
/** Carré au sol, en cases. L'herbe va à ~74, le sol du dôme à ~90. */
const FIELD_HALF = 78;
const FIELD_MIN = -FIELD_HALF;
const FIELD_SIZE = FIELD_HALF * 2;
/** La neige plein champ jusqu'ici, puis un fondu jusqu'à FADE_END. */
const FADE_START = 58;
const FADE_END = 76;
/** Gain par seconde de la couche de fond, modulé par les congères. */
const OUTSIDE_GAIN = 0.09;
/** 3 texels par case : le carré autour du terrain reste léger à fondre. */
const TEXELS = 3;
const COVER_W = FIELD_SIZE * TEXELS;
const COVER_H = COVER_W;

export interface SnowSettings {
  /** Flocons simulés, de 500 à 12 000. */
  flakes: number;
  /** Vent sur X. Z en reçoit un tiers. De -15 à 25. */
  wind: number;
  /** Taille des flocons et des taches au sol, de 0,5 à 2. */
  size: number;
  /** Secondes pour qu'une couche pleine disparaisse. De 5 à 90. */
  melt: number;
  /** Affiche la neige même si la météo de la partie n'est pas le blizzard. */
  force: boolean;
}

export const SNOW_RANGE = {
  flakes: { min: 500, max: MAX_FLAKES, step: 500 },
  wind: { min: -15, max: 25, step: 1 },
  size: { min: 0.5, max: 2, step: 0.1 },
  melt: { min: 5, max: 90, step: 1 },
} as const;

export const DEFAULT_SNOW_SETTINGS: SnowSettings = {
  flakes: 4500,
  wind: 3,
  size: 1,
  melt: 25,
  force: false,
};

export function clampSnowSettings(value: Partial<SnowSettings>, base: SnowSettings = DEFAULT_SNOW_SETTINGS): SnowSettings {
  return {
    flakes: snap(asNumber(value.flakes, base.flakes), SNOW_RANGE.flakes.min, SNOW_RANGE.flakes.max, SNOW_RANGE.flakes.step),
    wind: snap(asNumber(value.wind, base.wind), SNOW_RANGE.wind.min, SNOW_RANGE.wind.max, SNOW_RANGE.wind.step),
    size: snap(asNumber(value.size, base.size), SNOW_RANGE.size.min, SNOW_RANGE.size.max, SNOW_RANGE.size.step),
    melt: snap(asNumber(value.melt, base.melt), SNOW_RANGE.melt.min, SNOW_RANGE.melt.max, SNOW_RANGE.melt.step),
    force: asFlag(value.force, base.force),
  };
}

export class PitchSnow {
  private readonly group = new Group();
  private readonly flakes: InstancedMesh;
  private readonly blanket: Mesh;
  private readonly texture: DataTexture;
  private readonly pixels: Uint8Array<ArrayBuffer>;
  private readonly layer = new Float32Array(COVER_W * COVER_H);
  /** 0 hors du sol enneigé, sinon l'épaisseur relative des congères. */
  private readonly drift = new Uint8Array(COVER_W * COVER_H);
  private readonly home = new Uint8Array(MAX_FLAKES);
  private readonly positions = new Float32Array(MAX_FLAKES * 3);
  private readonly speeds = new Float32Array(MAX_FLAKES);
  private readonly phase = new Float32Array(MAX_FLAKES);
  private readonly scales = new Float32Array(MAX_FLAKES);
  private readonly matrix = new Matrix4();
  private readonly pos = new Vector3();
  private readonly facing = new Quaternion();
  private readonly flakeScaleVec = new Vector3();
  private active = DEFAULT_SNOW_SETTINGS.flakes;
  private windX = DEFAULT_SNOW_SETTINGS.wind * 0.35;
  private windZ = DEFAULT_SNOW_SETTINGS.wind * 0.12;
  private flakeScale = DEFAULT_SNOW_SETTINGS.size;
  private meltSeconds = DEFAULT_SNOW_SETTINGS.melt;
  private falling = false;
  private time = 0;
  private dirty = false;
  private coverAverage = 0;

  constructor(scene: Scene) {
    this.group.name = 'snow';
    this.group.frustumCulled = false;

    const flakeGeo = new PlaneGeometry(0.1, 0.1);
    const flakeMat = new MeshBasicMaterial({
      map: flakeSprite(),
      color: 0xf7fbff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.flakes = new InstancedMesh(flakeGeo, flakeMat, MAX_FLAKES);
    this.flakes.name = 'snow-flakes';
    this.flakes.frustumCulled = false;
    this.flakes.renderOrder = 4;
    this.flakes.raycast = () => {};
    this.flakes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flakes.count = 0;
    this.flakes.visible = false;

    this.paintDrift();

    this.pixels = new Uint8Array(new ArrayBuffer(COVER_W * COVER_H * 4));
    for (let i = 0; i < COVER_W * COVER_H; i++) {
      this.pixels[i * 4] = 255;
      this.pixels[i * 4 + 1] = 255;
      this.pixels[i * 4 + 2] = 255;
    }
    this.texture = new DataTexture(this.pixels, COVER_W, COVER_H);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    const blanketGeo = new PlaneGeometry(FIELD_SIZE, FIELD_SIZE);
    blanketGeo.rotateX(-Math.PI / 2);
    const blanketMat = new MeshBasicMaterial({
      map: this.texture,
      color: 0xf4f8ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.blanket = new Mesh(blanketGeo, blanketMat);
    this.blanket.name = 'snow-cover';
    this.blanket.position.y = 0.042;
    this.blanket.frustumCulled = false;
    this.blanket.renderOrder = 2;
    this.blanket.raycast = () => {};
    this.blanket.visible = false;

    for (let i = 0; i < MAX_FLAKES; i++) {
      this.resetFlake(i, true);
      const i3 = i * 3;
      this.writeFlake(i, this.positions[i3] ?? 0, this.positions[i3 + 1] ?? 0, this.positions[i3 + 2] ?? 0);
    }
    this.flakes.instanceMatrix.needsUpdate = true;

    this.group.add(this.flakes, this.blanket);
    scene.add(this.group);
  }

  apply(settings: SnowSettings): void {
    this.active = settings.flakes;
    this.windX = settings.wind * 0.35;
    this.windZ = settings.wind * 0.12;
    this.flakeScale = settings.size;
    this.meltSeconds = settings.melt;
    if (this.falling) this.flakes.count = this.active;
  }

  /** Les flocons suivent la météo. La couche au sol, elle, reste jusqu'à fondre. */
  setVisible(on: boolean): void {
    if (this.falling === on) return;
    this.falling = on;
    this.flakes.visible = on;
    this.flakes.count = on ? this.active : 0;
  }

  /** Part moyenne de la couche, de 0 (herbe nue) à 1 (couche pleine). */
  cover(): number {
    return this.coverAverage;
  }

  /** Neige à poser sur les arbres, buissons et rochers. Elle suit la couche au sol. */
  cap(): number {
    return Math.min(1, this.coverAverage * 1.45);
  }

  tick(dt: number, facing: Quaternion): void {
    this.facing.copy(facing);
    this.time += dt;
    if (this.falling) this.advanceFlakes(dt);
    if (this.falling || this.dirty || this.coverAverage > 0) this.melt(dt);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.flakes.geometry.dispose();
    this.blanket.geometry.dispose();
    disposeMaterial(this.flakes.material);
    disposeMaterial(this.blanket.material);
    this.group.clear();
  }

  private advanceFlakes(dt: number): void {
    const time = this.time;
    for (let i = 0; i < this.active; i++) {
      const i3 = i * 3;
      const speed = this.speeds[i] ?? 4;
      const swayPhase = this.phase[i] ?? 0;
      const swayX = Math.sin(time * 1.35 + swayPhase) * 0.7;
      const swayZ = Math.cos(time * 0.95 + swayPhase * 1.7) * 0.55;
      let x = (this.positions[i3] ?? 0) + (this.windX + swayX) * dt;
      let y = (this.positions[i3 + 1] ?? 0) - speed * dt;
      let z = (this.positions[i3 + 2] ?? 0) + (this.windZ + swayZ) * dt;
      if (y <= IMPACT_Y) {
        this.deposit(x, z, (this.scales[i] ?? 1) * this.flakeScale);
        this.resetFlake(i, false);
        x = this.positions[i3] ?? 0;
        y = this.positions[i3 + 1] ?? SPAWN_HEIGHT;
        z = this.positions[i3 + 2] ?? 0;
      } else if ((this.home[i] ?? 0) === 1) {
        x = wrapRange(x, MIN_X - COLUMN_PAD, MAX_X + COLUMN_PAD);
        z = wrapRange(z, MIN_Z - COLUMN_PAD, MAX_Z + COLUMN_PAD);
        this.positions[i3] = x;
        this.positions[i3 + 1] = y;
        this.positions[i3 + 2] = z;
      } else {
        x = wrapRange(x, -FADE_END, FADE_END);
        z = wrapRange(z, -FADE_END, FADE_END);
        this.positions[i3] = x;
        this.positions[i3 + 1] = y;
        this.positions[i3 + 2] = z;
      }
      this.writeFlake(i, x, y, z);
    }
    this.flakes.instanceMatrix.needsUpdate = true;
  }

  private writeFlake(index: number, x: number, y: number, z: number): void {
    const size = (this.scales[index] ?? 1) * this.flakeScale;
    this.pos.set(x, y, z);
    this.flakeScaleVec.set(size, size, 1);
    this.matrix.compose(this.pos, this.facing, this.flakeScaleVec);
    this.flakes.setMatrixAt(index, this.matrix);
  }

  private resetFlake(index: number, fillColumn: boolean): void {
    const i3 = index * 3;
    const onPitch = Math.random() < PITCH_FLAKE_SHARE;
    this.home[index] = onPitch ? 1 : 0;
    if (onPitch) {
      this.positions[i3] = MIN_X - COLUMN_PAD + Math.random() * (PITCH_W + COLUMN_PAD * 2);
      this.positions[i3 + 2] = MIN_Z - COLUMN_PAD + Math.random() * (PITCH_D + COLUMN_PAD * 2);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = FADE_END * Math.sqrt(Math.random()) * 0.96;
      this.positions[i3] = Math.cos(angle) * radius;
      this.positions[i3 + 2] = Math.sin(angle) * radius;
    }
    this.positions[i3 + 1] = fillColumn ? Math.random() * SPAWN_HEIGHT : SPAWN_HEIGHT + Math.random() * 4;
    this.speeds[index] = 2.4 + Math.random() * 3.2;
    this.phase[index] = Math.random() * Math.PI * 2;
    this.scales[index] = 0.75 + Math.random() * 0.5;
  }

  /**
   * Tache douce au sol.
   * DataTexture a flipY à false : la ligne 0 est le v 0 du plan.
   * Après rotateX(-90°), v 0 est du côté +Z.
   */
  private deposit(x: number, z: number, scale: number): void {
    if (x < FIELD_MIN || x > FIELD_HALF || z < FIELD_MIN || z > FIELD_HALF) return;
    const cx = ((x - FIELD_MIN) / FIELD_SIZE) * COVER_W;
    const cy = ((FIELD_HALF - z) / FIELD_SIZE) * COVER_H;
    const radius = (0.55 + Math.random() * 0.45) * scale * TEXELS;
    const ix = Math.min(COVER_W - 1, Math.max(0, Math.floor(cx)));
    const iy = Math.min(COVER_H - 1, Math.max(0, Math.floor(cy)));
    const drift = this.drift[iy * COVER_W + ix] ?? 0;
    if (drift === 0) return;
    const peak = (0.036 + Math.random() * 0.026) * Math.min(scale, 1.6) * (drift / 255);
    const reach = Math.ceil(radius);
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(COVER_W - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(COVER_H - 1, Math.ceil(cy + reach));
    const spread = Math.max(1, (radius * 0.55) ** 2 * 2);
    const limit = radius * radius;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > limit) continue;
        const idx = py * COVER_W + px;
        const prev = this.layer[idx] ?? 0;
        this.layer[idx] = Math.min(1, prev + peak * Math.exp(-dist2 / spread));
      }
    }
    this.dirty = true;
  }

  /** La couche de fond se pose partout. Les flocons rajoutent les taches. */
  private melt(dt: number): void {
    const loss = dt / this.meltSeconds;
    const gain = this.falling ? dt * OUTSIDE_GAIN : 0;
    let sum = 0;
    let counted = 0;
    const layer = this.layer;
    const pixels = this.pixels;
    const drift = this.drift;
    for (let py = 0; py < COVER_H; py++) {
      const row = py * COVER_W;
      for (let px = 0; px < COVER_W; px++) {
        const i = row + px;
        const weight = drift[i] ?? 0;
        let value = layer[i] ?? 0;
        if (weight > 0 && gain > 0) value = Math.min(1, value + gain * (weight / 255));
        if (value > 0) {
          value = Math.max(0, value - loss);
          sum += value;
        }
        layer[i] = value;
        if (weight > 0) counted += 1;
        pixels[i * 4 + 3] = (value * 255) | 0;
      }
    }
    this.coverAverage = counted > 0 ? sum / counted : 0;
    this.texture.needsUpdate = true;
    this.blanket.visible = sum > 0;
    this.dirty = false;
  }

  /** Congères stables, et un fondu rond pour que le carré de texture ne se voie pas. */
  private paintDrift(): void {
    const fadeSpan = FADE_END - FADE_START;
    for (let py = 0; py < COVER_H; py++) {
      const z = FIELD_HALF - ((py + 0.5) / COVER_H) * FIELD_SIZE;
      const row = py * COVER_W;
      for (let px = 0; px < COVER_W; px++) {
        const x = FIELD_MIN + ((px + 0.5) / COVER_W) * FIELD_SIZE;
        const dist = Math.hypot(x, z);
        let edge = 0;
        if (dist < FADE_START) edge = 1;
        else if (dist < FADE_END) edge = 1 - (dist - FADE_START) / fadeSpan;
        const varied = 0.55 + 0.45 * hashByte(row + px);
        this.drift[row + px] = Math.round(edge * varied * 255);
      }
    }
  }
}

function flakeSprite(): DataTexture {
  const size = 32;
  const data = new Uint8Array(new ArrayBuffer(size * size * 4));
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const edge = 1 - dist;
      const alpha = edge * edge * (3 - 2 * edge);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function disposeMaterial(material: InstancedMesh['material']): void {
  const list = Array.isArray(material) ? material : [material];
  for (const entry of list) {
    if (entry instanceof MeshBasicMaterial) entry.map?.dispose();
    entry.dispose();
  }
}

function hashByte(index: number): number {
  let x = Math.imul(index | 0, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function wrapRange(value: number, min: number, max: number): number {
  const size = max - min;
  let delta = value - min;
  delta = ((delta % size) + size) % size;
  return min + delta;
}

function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  const snapped = min + steps * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
