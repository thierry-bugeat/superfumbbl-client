import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { squareToWorld, TILE_SIZE } from '../coords';

/** 3×3 cases + un peu de débord : diamètre monde ≈ 3.4. */
const BLAST_DIAMETER = TILE_SIZE * 3.4;
/** Assez long pour les flammes qui partent en retard. */
const LIFE_MS = 1200;

interface FireCue {
  delay: number;
  span: number;
  power: number;
}
const GRID_FIRES = 9;
const EXTRA_FIRES = 6;
const FIRE_COUNT = GRID_FIRES + EXTRA_FIRES;
/** Demi-côté de la zone 3×3, en monde. */
const BLAST_HALF = TILE_SIZE * 1.5;
const EMBER_COUNT = 48;
const SMOKE_COUNT = 18;

interface Ember {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
}

interface Smoke {
  x: number;
  y: number;
  z: number;
  vy: number;
  grow: number;
  life: number;
  max: number;
}

/**
 * Explosion Blood Bowl : feu sur la case d'arrivée et les 8 adjacentes (≈ 3×3).
 * Flash, colonnes de flammes, braises, onde au sol, fumée.
 */
export class PitchExplosion {
  private readonly group = new Group();
  private readonly fires: Sprite[] = [];
  private readonly fireMats: SpriteMaterial[] = [];
  private readonly fireCues: FireCue[] = Array.from({ length: FIRE_COUNT }, () => ({ delay: 0, span: 0.6, power: 1 }));
  private flash: Mesh | null = null;
  private flashMat: MeshBasicMaterial | null = null;
  private ring: Mesh | null = null;
  private ringMat: MeshBasicMaterial | null = null;
  private embers: Points | null = null;
  private emberPos: BufferAttribute | null = null;
  private emberCol: BufferAttribute | null = null;
  private smokeSprites: Sprite[] = [];
  private smokeMats: SpriteMaterial[] = [];
  private readonly emberState: Ember[] = [];
  private readonly smokeState: Smoke[] = [];
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: { dispose(): void }[] = [];
  private readonly textures: { dispose(): void }[] = [];
  private born = 0;
  private active = false;
  private lastTick = 0;
  private readonly white = new Color(0xfff4c8);
  private readonly orange = new Color(0xff6a14);
  private readonly red = new Color(0xc01800);
  private readonly emberTint = new Color();

  constructor(scene: Scene) {
    scene.add(this.group);
    this.group.visible = false;
    this.build();
  }

  /** Détonation centrée sur la case. Relance si une explosion est déjà en cours. */
  burst(squareX: number, squareY: number, now = performance.now()): void {
    const world = squareToWorld(squareX, squareY);
    this.group.position.set(world.x, 0, world.z);
    this.born = now;
    this.active = true;
    this.lastTick = now;
    this.group.visible = true;
    this.seedEmbers();
    this.seedSmoke();
    this.layoutFires();
    if (this.flash) this.flash.scale.setScalar(0.35);
    if (this.ring) this.ring.scale.setScalar(0.2);
  }

  tick(now: number): void {
    if (!this.active) return;
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const age = now - this.born;
    const t = Math.min(1, age / LIFE_MS);
    if (t >= 1) {
      this.active = false;
      this.group.visible = false;
      return;
    }

    const flashPeak = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.35);
    const blast = easeOutCubic(Math.min(1, t / 0.45));
    const ageSec = age / 1000;

    if (this.flash && this.flashMat) {
      const size = 0.4 + blast * BLAST_DIAMETER;
      this.flash.scale.setScalar(size);
      this.flashMat.opacity = 0.95 * flashPeak;
      this.flashMat.color.copy(this.white).lerp(this.orange, Math.min(1, t * 3));
    }

    if (this.ring && this.ringMat) {
      const size = 0.5 + blast * BLAST_DIAMETER * 1.05;
      this.ring.scale.setScalar(size);
      this.ringMat.opacity = 0.75 * Math.max(0, 1 - t / 0.55) * (t > 0.04 ? 1 : t / 0.04);
    }

    for (let i = 0; i < this.fires.length; i += 1) {
      const fire = this.fires[i];
      const mat = this.fireMats[i];
      const cue = this.fireCues[i];
      if (!fire || !mat || !cue) continue;
      const localT = (ageSec - cue.delay) / cue.span;
      if (localT <= 0) {
        mat.opacity = 0;
        continue;
      }
      const life = localT < 0.22 ? localT / 0.22 : Math.max(0, 1 - (localT - 0.22) / 0.78);
      const flicker = 0.85 + Math.sin(now * 0.04 + i * 1.7) * 0.15;
      const rise = (0.25 + life * 1.5 * flicker) * cue.power;
      const width = (0.55 + life * 0.5) * cue.power * flicker;
      fire.scale.set(width, rise, 1);
      fire.position.y = rise * 0.45;
      mat.opacity = 0.9 * life * flicker;
      mat.rotation = Math.sin(now * 0.01 + i) * 0.12;
    }

    this.stepEmbers(dt, t);
    this.stepSmoke(dt, t, now);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }

  private build(): void {
    const fireMap = makeFireTexture();
    const flashMap = makeRadialTexture([
      [0, 'rgba(255,255,230,1)'],
      [0.15, 'rgba(255,200,80,0.95)'],
      [0.4, 'rgba(255,90,20,0.55)'],
      [0.7, 'rgba(180,20,0,0.2)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    const ringMap = makeRingTexture();
    const emberMap = makeRadialTexture([
      [0, 'rgba(255,240,180,1)'],
      [0.35, 'rgba(255,140,40,0.9)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    const smokeMap = makeSmokeTexture();
    this.textures.push(fireMap, flashMap, ringMap, emberMap, smokeMap);

    const flashGeom = new PlaneGeometry(1, 1);
    this.geometries.push(flashGeom);
    this.flashMat = new MeshBasicMaterial({
      map: flashMap,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      opacity: 0,
    });
    this.materials.push(this.flashMat);
    this.flash = new Mesh(flashGeom, this.flashMat);
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.y = 0.05;
    this.flash.renderOrder = 20;
    this.group.add(this.flash);

    const ringGeom = new PlaneGeometry(1, 1);
    this.geometries.push(ringGeom);
    this.ringMat = new MeshBasicMaterial({
      map: ringMap,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      color: 0xffaa44,
      opacity: 0,
    });
    this.materials.push(this.ringMat);
    this.ring = new Mesh(ringGeom, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.ring.renderOrder = 21;
    this.group.add(this.ring);

    for (let i = 0; i < FIRE_COUNT; i += 1) {
      const mat = new SpriteMaterial({
        map: fireMap,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      this.materials.push(mat);
      this.fireMats.push(mat);
      const sprite = new Sprite(mat);
      sprite.renderOrder = 22;
      this.fires.push(sprite);
      this.group.add(sprite);
    }

    const emberGeom = new BufferGeometry();
    const positions = new Float32Array(EMBER_COUNT * 3);
    const colors = new Float32Array(EMBER_COUNT * 4);
    this.emberPos = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
    this.emberCol = new BufferAttribute(colors, 4).setUsage(DynamicDrawUsage);
    emberGeom.setAttribute('position', this.emberPos);
    emberGeom.setAttribute('color', this.emberCol);
    this.geometries.push(emberGeom);
    const emberMat = new PointsMaterial({
      map: emberMap,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      size: 0.18,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.materials.push(emberMat);
    this.embers = new Points(emberGeom, emberMat);
    this.embers.renderOrder = 23;
    this.group.add(this.embers);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      this.emberState.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 });
    }

    for (let i = 0; i < SMOKE_COUNT; i += 1) {
      const mat = new SpriteMaterial({
        map: smokeMap,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        color: 0x4a3a32,
      });
      this.materials.push(mat);
      this.smokeMats.push(mat);
      const sprite = new Sprite(mat);
      sprite.renderOrder = 19;
      this.smokeSprites.push(sprite);
      this.group.add(sprite);
      this.smokeState.push({ x: 0, y: 0, z: 0, vy: 0, grow: 1, life: 0, max: 1 });
    }
  }

  /** Neuf flammes sur les cases, plus six au hasard dans la zone 3×3. */
  private layoutFires(): void {
    let index = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const fire = this.fires[index];
        const cue = this.fireCues[index];
        if (fire && cue) {
          const center = dx === 0 && dz === 0;
          const jitter = center ? 0.05 : 0.14;
          fire.position.set(
            dx * TILE_SIZE * 0.92 + MathUtils.randFloatSpread(jitter),
            0.4,
            dz * TILE_SIZE * 0.92 + MathUtils.randFloatSpread(jitter),
          );
          cue.delay = center ? MathUtils.randFloat(0, 0.05) : MathUtils.randFloat(0.07, 0.32);
          cue.span = center ? MathUtils.randFloat(0.55, 0.78) : MathUtils.randFloat(0.36, 0.68);
          cue.power = center ? MathUtils.randFloat(1.2, 1.5) : MathUtils.randFloat(0.6, 1.15);
        }
        index += 1;
      }
    }
    for (let extra = 0; extra < EXTRA_FIRES; extra += 1) {
      const fire = this.fires[index];
      const cue = this.fireCues[index];
      if (fire && cue) {
        fire.position.set(
          MathUtils.randFloatSpread(BLAST_HALF * 2),
          0.4,
          MathUtils.randFloatSpread(BLAST_HALF * 2),
        );
        cue.delay = MathUtils.randFloat(0.04, 0.4);
        cue.span = MathUtils.randFloat(0.32, 0.62);
        cue.power = MathUtils.randFloat(0.55, 1.05);
      }
      index += 1;
    }
  }

  private seedEmbers(): void {
    for (const ember of this.emberState) {
      const angle = Math.random() * Math.PI * 2;
      const speed = MathUtils.randFloat(1.2, 4.2);
      const lift = MathUtils.randFloat(1.5, 5.5);
      ember.x = MathUtils.randFloatSpread(0.4);
      ember.y = MathUtils.randFloat(0.1, 0.4);
      ember.z = MathUtils.randFloatSpread(0.4);
      ember.vx = Math.cos(angle) * speed;
      ember.vy = lift;
      ember.vz = Math.sin(angle) * speed;
      ember.max = MathUtils.randFloat(0.35, 0.85);
      ember.life = ember.max;
      ember.size = MathUtils.randFloat(0.7, 1.4);
    }
  }

  private seedSmoke(): void {
    for (const puff of this.smokeState) {
      const angle = Math.random() * Math.PI * 2;
      const radius = MathUtils.randFloat(0.2, BLAST_DIAMETER * 0.35);
      puff.x = Math.cos(angle) * radius;
      puff.y = MathUtils.randFloat(0.2, 0.6);
      puff.z = Math.sin(angle) * radius;
      puff.vy = MathUtils.randFloat(0.4, 1.2);
      puff.grow = MathUtils.randFloat(0.8, 1.6);
      puff.max = MathUtils.randFloat(0.55, 1);
      puff.life = puff.max;
    }
  }

  private stepEmbers(dt: number, t: number): void {
    if (!this.emberPos || !this.emberCol) return;
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    for (let i = 0; i < this.emberState.length; i += 1) {
      const ember = this.emberState[i];
      if (!ember) continue;
      ember.life -= dt;
      ember.vy -= 6 * dt;
      ember.vx *= 1 - 1.2 * dt;
      ember.vz *= 1 - 1.2 * dt;
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      ember.z += ember.vz * dt;
      if (ember.y < 0.05) {
        ember.y = 0.05;
        ember.vy *= -0.25;
      }
      const alive = ember.life > 0 ? ember.life / ember.max : 0;
      const heat = Math.min(1, alive * 1.4);
      this.emberPos.setXYZ(i, ember.x, ember.y, ember.z);
      this.emberTint.lerpColors(this.red, this.orange, heat);
      if (heat > 0.7) this.emberTint.lerp(this.white, (heat - 0.7) / 0.3);
      this.emberCol.setXYZW(i, this.emberTint.r, this.emberTint.g, this.emberTint.b, alive * fade);
    }
    this.emberPos.needsUpdate = true;
    this.emberCol.needsUpdate = true;
  }

  private stepSmoke(dt: number, t: number, now: number): void {
    const appear = Math.min(1, Math.max(0, (t - 0.12) / 0.25));
    for (let i = 0; i < this.smokeState.length; i += 1) {
      const puff = this.smokeState[i];
      const sprite = this.smokeSprites[i];
      const mat = this.smokeMats[i];
      if (!puff || !sprite || !mat) continue;
      puff.life -= dt * 0.55;
      puff.y += puff.vy * dt;
      const alive = puff.life > 0 ? puff.life / puff.max : 0;
      const size = (0.5 + (1 - alive) * 1.4) * puff.grow;
      sprite.position.set(puff.x, puff.y, puff.z);
      sprite.scale.set(size, size * 0.85, 1);
      mat.opacity = 0.35 * alive * appear;
      mat.rotation = now * 0.0004 + i;
    }
  }
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function makeFireTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 128, 192);
    const glow = context.createRadialGradient(64, 150, 4, 64, 120, 70);
    glow.addColorStop(0, 'rgba(255,250,200,1)');
    glow.addColorStop(0.25, 'rgba(255,180,40,0.95)');
    glow.addColorStop(0.55, 'rgba(255,70,10,0.7)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.moveTo(64, 8);
    context.bezierCurveTo(110, 50, 118, 110, 90, 180);
    context.bezierCurveTo(78, 155, 50, 155, 38, 180);
    context.bezierCurveTo(10, 110, 18, 50, 64, 8);
    context.fill();
    context.fillStyle = 'rgba(255,255,220,0.95)';
    context.beginPath();
    context.moveTo(64, 40);
    context.bezierCurveTo(88, 70, 90, 110, 72, 150);
    context.bezierCurveTo(64, 135, 56, 135, 56, 150);
    context.bezierCurveTo(38, 110, 40, 70, 64, 40);
    context.fill();
  }
  return new CanvasTexture(canvas);
}

function makeRingTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 256, 256);
    const gradient = context.createRadialGradient(128, 128, 70, 128, 128, 120);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.75, 'rgba(255,200,80,0.95)');
    gradient.addColorStop(0.9, 'rgba(255,80,20,0.55)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  return new CanvasTexture(canvas);
}

function makeSmokeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 128, 128);
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(80,70,65,0.75)');
    gradient.addColorStop(0.5, 'rgba(50,45,40,0.4)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

function makeRadialTexture(stops: [number, string][]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  return new CanvasTexture(canvas);
}
