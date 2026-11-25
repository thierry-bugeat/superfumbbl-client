/**
 * Pluie de la simulation `foulball/rain-simulation` : gouttes, ondes, micro-gouttes, éclairs.
 * Le volume suit le point visé, pour que le terrain reste sous la pluie quand la caméra se déplace.
 * Une case vaut 1 et une figurine environ 1,2. Les tailles de la démo (traînées d'une case,
 * ondes presque aussi larges) sont ramenées à cette échelle.
 */
import {
  AdditiveBlending,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';

const MAX_DROPS = 15000;
const MAX_RIPPLES = 1800;
const MAX_SPLASH = 3500;
/** Côté de la colonne de pluie, comme dans la simulation. */
const AREA = 55;
const SPAWN_HEIGHT = 32;
/** Au-dessus du plateau (y 0) et du marquage (sommet vers 0,036). */
const IMPACT_Y = 0.02;
const RIPPLE_Y = 0.05;
/** Longueur des traînées, en fraction de la démo. Vise environ un quart de figurine. */
const STREAK_LENGTH = 0.28;
/** Ondes et éclaboussures, même fraction : une flaque tient dans une case. */
const IMPACT_SCALE = 0.32;
const UP = new Vector3(0, 1, 0);

export interface RainSettings {
  /** Gouttes simulées, de 500 à 15 000. */
  drops: number;
  /** Vent sur X. Z en reçoit 30 %, comme dans la simulation. De -15 à 25. */
  wind: number;
  /** Échelle des ondes et des micro-gouttes, de 0,4 à 2,2. */
  splash: number;
  autoLightning: boolean;
  /** Affiche la pluie même si la météo de la partie n'est pas la pluie. */
  force: boolean;
  /** Volume de l'averse et du tonnerre, de 0 à 1. */
  volume: number;
}

export const RAIN_RANGE = {
  drops: { min: 500, max: MAX_DROPS, step: 500 },
  wind: { min: -15, max: 25, step: 1 },
  splash: { min: 0.4, max: 2.2, step: 0.1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

export const DEFAULT_RAIN_SETTINGS: RainSettings = {
  drops: 6000,
  wind: 6,
  splash: 1,
  autoLightning: true,
  force: false,
  volume: 0.1,
};

export function clampRainSettings(value: Partial<RainSettings>, base: RainSettings = DEFAULT_RAIN_SETTINGS): RainSettings {
  return {
    drops: snap(asNumber(value.drops, base.drops), RAIN_RANGE.drops.min, RAIN_RANGE.drops.max, RAIN_RANGE.drops.step),
    wind: snap(asNumber(value.wind, base.wind), RAIN_RANGE.wind.min, RAIN_RANGE.wind.max, RAIN_RANGE.wind.step),
    splash: snap(asNumber(value.splash, base.splash), RAIN_RANGE.splash.min, RAIN_RANGE.splash.max, RAIN_RANGE.splash.step),
    autoLightning: asFlag(value.autoLightning, base.autoLightning),
    force: asFlag(value.force, base.force),
    volume: snap(asNumber(value.volume, base.volume), RAIN_RANGE.volume.min, RAIN_RANGE.volume.max, RAIN_RANGE.volume.step),
  };
}

export class PitchRain {
  private readonly group = new Group();
  private readonly drops: InstancedMesh;
  private readonly ripples: InstancedMesh;
  private readonly splashes: InstancedMesh;
  private readonly light: DirectionalLight;
  private readonly positions = new Float32Array(MAX_DROPS * 3);
  private readonly speeds = new Float32Array(MAX_DROPS);
  private readonly lengths = new Float32Array(MAX_DROPS);
  private readonly rippleActive = new Uint8Array(MAX_RIPPLES);
  private readonly ripplePos = new Float32Array(MAX_RIPPLES * 2);
  private readonly rippleAge = new Float32Array(MAX_RIPPLES);
  private readonly rippleMaxAge = new Float32Array(MAX_RIPPLES);
  private readonly rippleMaxRadius = new Float32Array(MAX_RIPPLES);
  private readonly splashActive = new Uint8Array(MAX_SPLASH);
  private readonly splashPos = new Float32Array(MAX_SPLASH * 3);
  private readonly splashVel = new Float32Array(MAX_SPLASH * 3);
  private readonly splashAge = new Float32Array(MAX_SPLASH);
  private readonly matrix = new Matrix4();
  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();
  private readonly scale = new Vector3();
  private readonly velDir = new Vector3();
  private active = DEFAULT_RAIN_SETTINGS.drops;
  private windX = DEFAULT_RAIN_SETTINGS.wind;
  private windZ = DEFAULT_RAIN_SETTINGS.wind * 0.3;
  private splashScale = DEFAULT_RAIN_SETTINGS.splash;
  private autoLightning = DEFAULT_RAIN_SETTINGS.autoLightning;
  private visible = false;
  private rippleCursor = 0;
  private splashCursor = 0;
  private lightningTimer = 0;
  private nextLightning = 4 + Math.random() * 8;
  private flash = 0;
  private aimX = 0;
  private aimZ = 0;
  private impactTimer = 0;
  private impactCount = 0;
  private impactRate = 0;
  private bolts = 0;

  constructor(scene: Scene) {
    this.group.name = 'rain';
    this.group.frustumCulled = false;
    this.group.visible = false;

    const rainGeo = new CylinderGeometry(0.007, 0.012, 1, 5, 1, true);
    const rainMat = new MeshBasicMaterial({
      color: 0xb7dcff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.drops = this.dress(new InstancedMesh(rainGeo, rainMat, MAX_DROPS), 4);

    const rippleGeo = new RingGeometry(0.65, 1, 24);
    rippleGeo.rotateX(-Math.PI / 2);
    const rippleMat = new MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.ripples = this.dress(new InstancedMesh(rippleGeo, rippleMat, MAX_RIPPLES), 4);

    const splashGeo = new SphereGeometry(0.012, 5, 4);
    const splashMat = new MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.splashes = this.dress(new InstancedMesh(splashGeo, splashMat, MAX_SPLASH), 4);

    this.light = new DirectionalLight(0xdbeafe, 0);
    this.light.position.set(0, 45, 0);
    this.light.target.position.set(0, 0, 0);
    this.light.castShadow = false;
    this.light.visible = false;

    for (let i = 0; i < MAX_DROPS; i++) {
      this.resetDrop(i, true, 0, 0);
      this.writeDrop(i);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.drops.count = 0;
    this.ripples.count = 0;
    this.splashes.count = 0;

    scene.add(this.group, this.light, this.light.target);
  }

  apply(settings: RainSettings): void {
    this.active = settings.drops;
    this.windX = settings.wind;
    this.windZ = settings.wind * 0.3;
    this.splashScale = settings.splash;
    this.autoLightning = settings.autoLightning;
    if (this.visible) this.drops.count = this.active;
  }

  setVisible(on: boolean): void {
    if (this.visible === on) return;
    this.visible = on;
    this.group.visible = on;
    this.drops.count = on ? this.active : 0;
    if (on) return;
    this.impactRate = 0;
    this.impactCount = 0;
    this.impactTimer = 0;
    this.clearEffects();
  }

  /** Éclair tout de suite. L'éclair éclaire le terrain même si les gouttes sont masquées. */
  triggerLightning(): void {
    this.bolts += 1;
    this.flash = 1;
    this.light.position.set(
      this.aimX + (Math.random() - 0.5) * 40,
      45,
      this.aimZ + (Math.random() - 0.5) * 40,
    );
  }

  /** Éclairs partis depuis le dernier appel. Le son s'en sert, le dessin non. */
  takeBolts(): number {
    const count = this.bolts;
    this.bolts = 0;
    return count;
  }

  /** Puissance de l'éclair en cours, de 0 à 1, déjà scintillante. */
  tick(dt: number, centerX: number, centerZ: number): number {
    this.aimX = centerX;
    this.aimZ = centerZ;
    this.light.target.position.set(centerX, 0, centerZ);
    this.light.target.updateMatrixWorld();
    const power = this.advanceLightning(dt);
    if (!this.visible) return power;
    this.advanceDrops(dt, centerX, centerZ);
    this.advanceRipples(dt);
    this.advanceSplashes(dt);
    return power;
  }

  impactsPerSecond(): number {
    return this.visible ? this.impactRate : 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.light.target.removeFromParent();
    this.light.removeFromParent();
    this.light.dispose();
    for (const mesh of [this.drops, this.ripples, this.splashes]) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material.dispose();
    }
    this.group.clear();
  }

  private dress(mesh: InstancedMesh, order: number): InstancedMesh {
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.raycast = () => {};
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  private advanceLightning(dt: number): number {
    if (this.visible && this.autoLightning) {
      this.lightningTimer += dt;
      if (this.lightningTimer >= this.nextLightning) {
        this.triggerLightning();
        this.lightningTimer = 0;
        this.nextLightning = 5 + Math.random() * 11;
      }
    }
    if (this.flash <= 0.01) {
      this.light.intensity = 0;
      this.light.visible = false;
      this.flash = 0;
      return 0;
    }
    const flicker = Math.random() > 0.35 ? 1 : 0.7;
    const power = this.flash * flicker;
    this.light.visible = true;
    this.light.intensity = power * 8;
    this.flash *= Math.pow(0.03, dt);
    return power;
  }

  private advanceDrops(dt: number, centerX: number, centerZ: number): void {
    let impacts = 0;
    for (let i = 0; i < this.active; i++) {
      const i3 = i * 3;
      const speed = this.speeds[i] ?? 28;
      const vx = this.windX;
      const vy = -speed;
      const vz = this.windZ;
      let x = (this.positions[i3] ?? 0) + vx * dt;
      let y = (this.positions[i3 + 1] ?? 0) + vy * dt;
      let z = (this.positions[i3 + 2] ?? 0) + vz * dt;
      if (y <= IMPACT_Y) {
        this.spawnRipple(x, z);
        if (Math.random() < 0.65) this.spawnCrown(x, z);
        impacts += 1;
        this.resetDrop(i, false, centerX, centerZ);
        x = this.positions[i3] ?? centerX;
        y = this.positions[i3 + 1] ?? SPAWN_HEIGHT;
        z = this.positions[i3 + 2] ?? centerZ;
      } else {
        x = wrapTo(x, centerX, AREA);
        z = wrapTo(z, centerZ, AREA);
        this.positions[i3] = x;
        this.positions[i3 + 1] = y;
        this.positions[i3 + 2] = z;
      }
      this.writeDrop(i, x, y, z, speed);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.noteImpacts(impacts, dt);
  }

  private advanceRipples(dt: number): void {
    let drawn = 0;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if ((this.rippleActive[i] ?? 0) === 0) continue;
      const age = (this.rippleAge[i] ?? 0) + dt;
      this.rippleAge[i] = age;
      const maxAge = this.rippleMaxAge[i] ?? 0.4;
      const progress = maxAge <= 0 ? 1 : age / maxAge;
      if (progress >= 1) {
        this.rippleActive[i] = 0;
        continue;
      }
      const ease = 1 - (1 - progress) ** 2.2;
      const radius = (this.rippleMaxRadius[i] ?? 0.2) * ease;
      const fade = Math.sin(progress * Math.PI);
      const size = Math.max(0.001, radius * fade);
      this.pos.set(this.ripplePos[i * 2] ?? 0, RIPPLE_Y, this.ripplePos[i * 2 + 1] ?? 0);
      this.quat.identity();
      this.scale.set(size, 1, size);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.ripples.setMatrixAt(drawn, this.matrix);
      drawn += 1;
    }
    this.ripples.count = drawn;
    this.ripples.instanceMatrix.needsUpdate = true;
  }

  private advanceSplashes(dt: number): void {
    const gravity = -16.5;
    let drawn = 0;
    for (let i = 0; i < MAX_SPLASH; i++) {
      if ((this.splashActive[i] ?? 0) === 0) continue;
      const i3 = i * 3;
      const age = (this.splashAge[i] ?? 0) + dt;
      this.splashAge[i] = age;
      const vx = this.splashVel[i3] ?? 0;
      let vy = this.splashVel[i3 + 1] ?? 0;
      const vz = this.splashVel[i3 + 2] ?? 0;
      vy += gravity * dt;
      this.splashVel[i3 + 1] = vy;
      const x = (this.splashPos[i3] ?? 0) + vx * dt;
      const y = (this.splashPos[i3 + 1] ?? 0) + vy * dt;
      const z = (this.splashPos[i3 + 2] ?? 0) + vz * dt;
      this.splashPos[i3] = x;
      this.splashPos[i3 + 1] = y;
      this.splashPos[i3 + 2] = z;
      if (y <= IMPACT_Y || age > 0.45) {
        this.splashActive[i] = 0;
        continue;
      }
      const shrink = Math.max(0.001, (1 - age / 0.45) * this.splashScale);
      this.pos.set(x, y, z);
      this.quat.identity();
      this.scale.set(shrink, shrink * 1.3, shrink);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.splashes.setMatrixAt(drawn, this.matrix);
      drawn += 1;
    }
    this.splashes.count = drawn;
    this.splashes.instanceMatrix.needsUpdate = true;
  }

  private writeDrop(index: number, x?: number, y?: number, z?: number, speed?: number): void {
    const i3 = index * 3;
    const px = x ?? this.positions[i3] ?? 0;
    const py = y ?? this.positions[i3 + 1] ?? 0;
    const pz = z ?? this.positions[i3 + 2] ?? 0;
    const fall = speed ?? this.speeds[index] ?? 28;
    this.velDir.set(this.windX, -fall, this.windZ).normalize();
    this.quat.setFromUnitVectors(UP, this.velDir);
    this.pos.set(px, py, pz);
    this.scale.set(1, (this.lengths[index] ?? 1) * (fall / 25) * STREAK_LENGTH, 1);
    this.matrix.compose(this.pos, this.quat, this.scale);
    this.drops.setMatrixAt(index, this.matrix);
  }

  private resetDrop(index: number, fillColumn: boolean, centerX: number, centerZ: number): void {
    const i3 = index * 3;
    this.positions[i3] = centerX + (Math.random() - 0.5) * AREA;
    this.positions[i3 + 1] = fillColumn ? Math.random() * SPAWN_HEIGHT : SPAWN_HEIGHT + Math.random() * 6;
    this.positions[i3 + 2] = centerZ + (Math.random() - 0.5) * AREA;
    this.speeds[index] = 22 + Math.random() * 14;
    this.lengths[index] = 0.55 + Math.random() * 0.65;
  }

  private spawnRipple(x: number, z: number): void {
    const idx = this.rippleCursor;
    this.rippleCursor = (idx + 1) % MAX_RIPPLES;
    this.rippleActive[idx] = 1;
    this.ripplePos[idx * 2] = x;
    this.ripplePos[idx * 2 + 1] = z;
    this.rippleAge[idx] = 0;
    this.rippleMaxAge[idx] = 0.28 + Math.random() * 0.22;
    this.rippleMaxRadius[idx] = (0.18 + Math.random() * 0.24) * this.splashScale * IMPACT_SCALE;
  }

  private spawnCrown(x: number, z: number): void {
    const count = 3 + Math.floor(Math.random() * 3);
    const scale = this.splashScale;
    for (let k = 0; k < count; k++) {
      const idx = this.splashCursor;
      this.splashCursor = (idx + 1) % MAX_SPLASH;
      const i3 = idx * 3;
      const angle = (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const radial = (0.8 + Math.random() * 1.4) * scale * IMPACT_SCALE;
      this.splashActive[idx] = 1;
      this.splashPos[i3] = x;
      this.splashPos[i3 + 1] = IMPACT_Y + 0.02;
      this.splashPos[i3 + 2] = z;
      this.splashVel[i3] = Math.cos(angle) * radial + this.windX * 0.03;
      this.splashVel[i3 + 1] = (2.2 + Math.random() * 2.1) * Math.sqrt(scale) * IMPACT_SCALE;
      this.splashVel[i3 + 2] = Math.sin(angle) * radial + this.windZ * 0.03;
      this.splashAge[idx] = 0;
    }
  }

  private noteImpacts(count: number, dt: number): void {
    this.impactCount += count;
    this.impactTimer += dt;
    if (this.impactTimer < 1) return;
    this.impactRate = this.impactCount;
    this.impactCount = 0;
    this.impactTimer -= 1;
  }

  private clearEffects(): void {
    this.rippleActive.fill(0);
    this.splashActive.fill(0);
    this.ripples.count = 0;
    this.splashes.count = 0;
    this.rippleCursor = 0;
    this.splashCursor = 0;
  }
}

function wrapTo(value: number, center: number, size: number): number {
  const half = size / 2;
  let delta = value - center + half;
  delta = ((delta % size) + size) % size;
  return center + delta - half;
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
