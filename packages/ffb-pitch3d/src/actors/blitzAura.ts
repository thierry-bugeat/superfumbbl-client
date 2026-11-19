import type { GameJson } from '@fumbbl40k/ffb-protocol';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  Mesh,
  NormalBlending,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

/** L'ensemble du blitz, sceau compris. Les points n'héritent pas l'échelle du groupe : on la recopie. */
const SCALE = 0.75; // Échelle globale du blitz
const BOLT_W = 0.78; // Largeur de l'icône de l'éclair
const BOLT_H = 1.08; // Hauteur de l'icône de l'éclair
const GLOW_SIZE = 1.95;
const WARM_W = 0.95;
const WARM_H = 1.25;
const DISCHARGE_SIZE = 1.85;
const SHELL_COUNT = 10; // Nombre de particules qui sont et qui restent à l'intérieur du "nuage" de particules
const SHELL_RADIUS = 0.62;
const SPARK_COUNT = 40; // Nombre de particules "basiques" qui sont projetées vers l'extérieur du "nuage".
const EMBER_COUNT = 7; // Nombre de particules "lumineuses" qui sont projetées vers l'extérieur du "nuage".
const ARC_COUNT = 5;
const ARC_POINTS = 8;
const FADE_MS = 160;
const POP_MS = 440;
const POP_START = 0.22;
const POP_PEAK = 1.34;
const SHELL_POINT = 0.28 * SCALE;
const SPARK_POINT = 0.16 * SCALE;
const EMBER_POINT = 0.4 * SCALE;
const BURST_MS = 420;
const ICON = 512;
const SPARK_SHEET = 256;

/**
 * Centre du trait. Le liseré dépasse d'un demi-trait, et c'est lui qui
 * suit l'éclair : pointe haut-droite, barbe à droite, pointe bas-gauche, barbe à gauche.
 */
const BOLT: readonly (readonly [number, number])[] = [
  [0.845, 0.109],
  [0.603, 0.394],
  [0.832, 0.403],
  [0.136, 0.879],
  [0.406, 0.585],
  [0.136, 0.553],
  [0.414, 0.21],
  [0.61, 0.182],
];

const SPINE: readonly (readonly [number, number])[] = [
  [0.68, 0.22],
  [0.52, 0.33],
  [0.55, 0.46],
  [0.4, 0.55],
  [0.43, 0.64],
  [0.3, 0.74],
  [0.22, 0.8],
];

const BRANCHES: readonly (readonly (readonly [number, number])[])[] = [
  [[0.55, 0.46], [0.7, 0.43]],
  [[0.4, 0.55], [0.26, 0.53]],
  [[0.43, 0.64], [0.38, 0.68]],
  [[0.52, 0.33], [0.58, 0.26]],
];

const SHELL_PALETTE: readonly (readonly [number, number, number])[] = [
  [0.72, 0.9, 1],
  [1, 0.93, 0.6],
  [0.48, 0.74, 1],
  [1, 1, 1],
];

interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  kind: 'spark' | 'ember';
}

interface Arc {
  points: Float32Array;
  born: number;
  life: number;
  coreMat: MeshBasicMaterial;
  glowMat: MeshBasicMaterial;
  coreAttr: BufferAttribute;
  glowAttr: BufferAttribute;
}

/** Grandit au-delà de 1, puis se dégonfle jusqu'à la taille posée. */
function popScale(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const grow = 0.62;
  const ease = (u: number) => u * u * (3 - 2 * u);
  if (clamped < grow) {
    return POP_START + (POP_PEAK - POP_START) * ease(clamped / grow);
  }
  return POP_PEAK + (1 - POP_PEAK) * ease((clamped - grow) / (1 - grow));
}

/**
 * Éclair au-dessus du joueur qui blitze.
 * Le sceau est or et bleu nuit. Autour : sphère de particules, étincelles
 * qui partent, décharges sur le billboard et arcs dans le volume.
 */
export class BlitzAura {
  private readonly group = new Group();
  private readonly anchor = new Vector3();
  private readonly view = new Vector3();
  private readonly tangent = new Vector3();
  private readonly side = new Vector3();
  private readonly sideUp = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly altUp = new Vector3(1, 0, 0);
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: { dispose(): void }[] = [];
  private readonly textures: { dispose(): void }[] = [];
  private readonly arcs: Arc[] = [];
  private readonly sparks: Mote[];
  private readonly embers: Mote[];
  private readonly shellDir: Float32Array;
  private readonly boltPivot = new Group();
  private readonly corePivot = new Group();
  private readonly glowMat: SpriteMaterial;
  private readonly warmMat: SpriteMaterial;
  private readonly boltMat: SpriteMaterial;
  private readonly coreMat: SpriteMaterial;
  private readonly dischargeMat: SpriteMaterial;
  private readonly dischargeCanvas: HTMLCanvasElement;
  private readonly dischargeCtx: CanvasRenderingContext2D | null;
  private readonly dischargeTex: CanvasTexture;
  private readonly shellMat: PointsMaterial;
  private readonly sparkMat: PointsMaterial;
  private readonly emberMat: PointsMaterial;
  private readonly shellPos: BufferAttribute;
  private readonly shellCol: BufferAttribute;
  private readonly sparkPos: BufferAttribute;
  private readonly sparkCol: BufferAttribute;
  private readonly emberPos: BufferAttribute;
  private readonly emberCol: BufferAttribute;
  private playerId = '';
  private born = 0;
  private lastNow = 0;
  private lastBurst = 0;
  private dischargeAt = 0;
  private flash = 0;
  private dieFrom = 1;
  private dying = false;
  private dieStarted = 0;
  private disposed = false;

  constructor(parent: Object3D) {
    this.group.visible = false;
    this.group.frustumCulled = false;
    parent.add(this.group);

    const disc = discTexture();
    this.textures.push(disc);
    const painted = paintBolt();
    const boltTex = canvasTexture(painted.icon);
    const coreTex = canvasTexture(painted.core);
    const glowTex = glowTexture();
    const warmTex = warmTexture();
    this.dischargeCanvas = document.createElement('canvas');
    this.dischargeCanvas.width = SPARK_SHEET;
    this.dischargeCanvas.height = SPARK_SHEET;
    this.dischargeCtx = this.dischargeCanvas.getContext('2d');
    if (this.dischargeCtx) paintDischarges(this.dischargeCtx, SPARK_SHEET);
    this.dischargeTex = canvasTexture(this.dischargeCanvas, true);
    for (const texture of [boltTex, coreTex, glowTex, warmTex, this.dischargeTex]) this.textures.push(texture);

    this.glowMat = this.sprite(glowTex, GLOW_SIZE, GLOW_SIZE, 6, true);
    this.warmMat = this.sprite(warmTex, WARM_W, WARM_H, 7, true);
    const shell = this.cloud(SHELL_COUNT, disc, SHELL_POINT, 8);
    this.shellMat = shell.material;
    this.shellPos = shell.position;
    this.shellCol = shell.color;
    this.shellDir = shellDirs(SHELL_COUNT);
    const shellColors = this.shellCol;
    for (let i = 0; i < SHELL_COUNT; i += 1) {
      const rgb = SHELL_PALETTE[i % SHELL_PALETTE.length];
      shellColors.setXYZW(i, rgb?.[0] ?? 1, rgb?.[1] ?? 1, rgb?.[2] ?? 1, 1);
    }
    shellColors.needsUpdate = true;

    for (let i = 0; i < ARC_COUNT; i += 1) this.arcs.push(this.makeArc());

    this.dischargeMat = this.sprite(this.dischargeTex, DISCHARGE_SIZE, DISCHARGE_SIZE, 11, true);
    this.group.add(this.boltPivot, this.corePivot);
    this.boltMat = this.sprite(boltTex, BOLT_W, BOLT_H, 12, false, this.boltPivot);
    this.coreMat = this.sprite(coreTex, BOLT_W, BOLT_H, 13, true, this.corePivot);

    const sparks = this.cloud(SPARK_COUNT, disc, SPARK_POINT, 15);
    const embers = this.cloud(EMBER_COUNT, disc, EMBER_POINT, 14);
    this.sparkMat = sparks.material;
    this.emberMat = embers.material;
    this.sparkPos = sparks.position;
    this.sparkCol = sparks.color;
    this.emberPos = embers.position;
    this.emberCol = embers.color;
    this.sparks = this.fillMotes(SPARK_COUNT, 'spark');
    this.embers = this.fillMotes(EMBER_COUNT, 'ember');
  }

  /** Même joueur : on reste. Un autre joueur relance l'explosion. */
  follow(id: string, now: number): void {
    if (this.playerId === id && this.group.visible) {
      this.dying = false;
      this.dieStarted = 0;
      return;
    }
    this.playerId = id;
    this.dying = false;
    this.dieStarted = 0;
    this.dieFrom = 1;
    this.group.visible = true;
    this.born = now;
    this.wake(now);
  }

  place(x: number, y: number, z: number): void {
    this.anchor.set(x, y, z);
    this.group.position.copy(this.anchor);
  }

  /** L'action est finie : l'éclair se referme sur place. */
  hide(): void {
    if (!this.group.visible || this.dying) return;
    this.dying = true;
  }

  tick(now: number, dt: number): void {
    if (!this.group.visible) return;
    this.lastNow = now;
    if (this.dying) {
      if (this.dieStarted === 0) {
        this.dieStarted = now;
        this.dieFrom = this.group.scale.x / SCALE;
      }
      const fade = Math.min(1, (now - this.dieStarted) / FADE_MS);
      this.applyScale(this.dieFrom * (1 - fade));
      if (fade >= 1) {
        this.group.visible = false;
        this.dying = false;
        this.dieStarted = 0;
        this.playerId = '';
        return;
      }
    } else {
      this.applyScale(popScale((now - this.born) / POP_MS));
    }

    this.stepMotes(this.sparks, this.sparkPos, this.sparkCol, dt);
    this.stepMotes(this.embers, this.emberPos, this.emberCol, dt);
    this.spinShell(now);
    this.stepArcs(now);
    if (now - this.dischargeAt > 90) {
      this.dischargeAt = now;
      if (this.dischargeCtx) {
        paintDischarges(this.dischargeCtx, SPARK_SHEET);
        this.dischargeTex.needsUpdate = true;
      }
    }
    if (now - this.lastBurst > BURST_MS) {
      this.lastBurst = now;
      this.flash = 1;
      for (let i = 0; i < 8; i += 1) {
        const spark = this.sparks[i];
        if (spark) this.launch(spark, true);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.007);
    this.glowMat.opacity = 0.85 + pulse * 0.1 + this.flash * 0.2;
    this.warmMat.opacity = 0.32 + pulse * 0.12 + this.flash * 0.2;
    this.dischargeMat.opacity = 0.42 + 0.2 * Math.abs(Math.sin(now * 0.018));
    const boltPulse = 1 + Math.sin(now * 0.013) * 0.045 + this.flash * 0.08;
    this.boltPivot.scale.setScalar(boltPulse);
    this.corePivot.scale.setScalar(boltPulse);
    const wobble = Math.sin(now * 0.0045) * 0.05;
    this.boltMat.rotation = wobble;
    this.coreMat.rotation = wobble;
    this.coreMat.opacity = 0.4 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.02)) + this.flash * 0.2;
  }

  /** Décale l'icône vers la caméra et tourne les arcs pour qu'ils restent lisibles. */
  orient(camera: PerspectiveCamera): void {
    if (!this.group.visible) return;
    this.view.copy(camera.position).sub(this.anchor);
    if (this.view.lengthSq() < 1e-6) this.view.set(0, 0.45, 1);
    this.view.normalize();
    this.group.position.copy(this.anchor);
    this.group.position.y += Math.sin(this.lastNow * 0.006) * 0.03;
    this.group.position.addScaledVector(this.view, 0.16);
    this.sideUp.crossVectors(this.view, this.up);
    if (this.sideUp.lengthSq() < 1e-6) this.sideUp.copy(this.altUp);
    else this.sideUp.normalize();
    for (const arc of this.arcs) {
      this.writeRibbon(arc.coreAttr, arc.points, 0.028, this.view);
      this.writeRibbon(arc.glowAttr, arc.points, 0.075, this.sideUp);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }

  private wake(now: number): void {
    this.lastBurst = now;
    this.dischargeAt = now;
    this.flash = 1;
    for (const mote of this.sparks) this.launch(mote, true);
    for (const mote of this.embers) this.launch(mote, false);
    for (const arc of this.arcs) {
      this.respawnArc(arc, now);
      arc.born = now - Math.random() * arc.life * 0.85;
    }
    if (this.dischargeCtx) {
      paintDischarges(this.dischargeCtx, SPARK_SHEET);
      this.dischargeTex.needsUpdate = true;
    }
  }

  private sprite(
    map: CanvasTexture,
    width: number,
    height: number,
    order: number,
    additive: boolean,
    parent: Object3D = this.group,
  ): SpriteMaterial {
    const material = new SpriteMaterial({
      map,
      transparent: true,
      blending: additive ? AdditiveBlending : NormalBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(material);
    const sprite = new Sprite(material);
    sprite.scale.set(width, height, 1);
    sprite.renderOrder = order;
    sprite.frustumCulled = false;
    sprite.raycast = () => {};
    parent.add(sprite);
    return material;
  }

  private cloud(
    count: number,
    map: CanvasTexture,
    size: number,
    order: number,
  ): { position: BufferAttribute; color: BufferAttribute; material: PointsMaterial } {
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(new Float32Array(count * 3), 3);
    const color = new BufferAttribute(new Float32Array(count * 4), 4);
    position.setUsage(DynamicDrawUsage);
    color.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', color);
    this.geometries.push(geometry);
    const material = new PointsMaterial({
      size,
      map,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(material);
    const points = new Points(geometry, material);
    points.renderOrder = order;
    points.frustumCulled = false;
    points.raycast = () => {};
    this.group.add(points);
    return { position, color, material };
  }

  /** Gonfle le sceau et les points ensemble. `factor` 1 est la taille posée. */
  private applyScale(factor: number): void {
    const amount = Math.max(0, factor);
    this.group.scale.setScalar(SCALE * amount);
    this.shellMat.size = SHELL_POINT * amount;
    this.sparkMat.size = SPARK_POINT * amount;
    this.emberMat.size = EMBER_POINT * amount;
  }

  private makeArc(): Arc {
    const core = this.ribbon(0xf7fbff, 10);
    const glow = this.ribbon(0x6eb6ff, 9);
    return {
      points: new Float32Array(ARC_POINTS * 3),
      born: 0,
      life: 200,
      coreMat: core.material,
      glowMat: glow.material,
      coreAttr: core.attribute,
      glowAttr: glow.attribute,
    };
  }

  private ribbon(color: number, order: number): { material: MeshBasicMaterial; attribute: BufferAttribute } {
    const geometry = new BufferGeometry();
    const attribute = new BufferAttribute(new Float32Array(ARC_POINTS * 2 * 3), 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    const indices: number[] = [];
    for (let i = 0; i < ARC_POINTS - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);
    this.geometries.push(geometry);
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    });
    this.materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    this.group.add(mesh);
    return { material, attribute };
  }

  private fillMotes(count: number, kind: Mote['kind']): Mote[] {
    const motes: Mote[] = [];
    for (let i = 0; i < count; i += 1) {
      const mote: Mote = {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, max: 1, r: 1, g: 1, b: 1, drag: 1, kind,
      };
      this.launch(mote, false);
      mote.life = Math.random() * mote.max;
      motes.push(mote);
    }
    return motes;
  }

  private launch(mote: Mote, violent: boolean): void {
    const ember = mote.kind === 'ember';
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sp = Math.sin(phi);
    const dx = Math.cos(theta) * sp;
    const dy = Math.cos(phi);
    const dz = Math.sin(theta) * sp;
    const speed = ember
      ? 0.65 + Math.random() * 0.95
      : violent ? 4.8 + Math.random() * 2.8 : 1.6 + Math.random() * 1.7;
    const origin = ember ? 0.28 + Math.random() * 0.32 : violent ? 0.1 : 0.16 + Math.random() * 0.14;
    mote.x = dx * origin;
    mote.y = dy * origin;
    mote.z = dz * origin;
    mote.vx = dx * speed;
    mote.vy = dy * speed;
    mote.vz = dz * speed;
    mote.life = 0;
    mote.max = ember
      ? 0.75 + Math.random() * 0.5
      : violent ? 0.24 + Math.random() * 0.16 : 0.36 + Math.random() * 0.26;
    mote.drag = ember ? 0.5 : violent ? 1.05 : 1.45;
    const roll = Math.random();
    if (ember || roll < 0.42) {
      mote.r = 1;
      mote.g = 0.86;
      mote.b = 0.38;
    } else if (roll < 0.75) {
      mote.r = 0.72;
      mote.g = 0.9;
      mote.b = 1;
    } else {
      mote.r = 1;
      mote.g = 1;
      mote.b = 1;
    }
  }

  private stepMotes(motes: readonly Mote[], position: BufferAttribute, color: BufferAttribute, dt: number): void {
    for (let i = 0; i < motes.length; i += 1) {
      const mote = motes[i];
      if (!mote) continue;
      mote.life += dt;
      if (mote.life >= mote.max) this.launch(mote, false);
      const drag = Math.exp(-mote.drag * dt);
      mote.vx *= drag;
      mote.vy *= drag;
      mote.vz *= drag;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      mote.z += mote.vz * dt;
      position.setXYZ(i, mote.x, mote.y, mote.z);
      const t = mote.max <= 0 ? 1 : mote.life / mote.max;
      const fade = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.88);
      color.setXYZW(i, mote.r, mote.g, mote.b, fade);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
  }

  private spinShell(now: number): void {
    const spin = now * 0.00115;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    for (let i = 0; i < SHELL_COUNT; i += 1) {
      const dx = this.shellDir[i * 3] ?? 0;
      const dy = this.shellDir[i * 3 + 1] ?? 0;
      const dz = this.shellDir[i * 3 + 2] ?? 0;
      const radius = SHELL_RADIUS + Math.sin(now * 0.004 + i * 0.7) * 0.055;
      const x = dx * cos - dz * sin;
      const z = dx * sin + dz * cos;
      this.shellPos.setXYZ(i, x * radius, dy * radius, z * radius);
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.009 + i * 1.3));
      const rgb = SHELL_PALETTE[i % SHELL_PALETTE.length];
      this.shellCol.setXYZW(i, rgb?.[0] ?? 1, rgb?.[1] ?? 1, rgb?.[2] ?? 1, 0.3 + 0.7 * twinkle);
    }
    this.shellPos.needsUpdate = true;
    this.shellCol.needsUpdate = true;
  }

  private stepArcs(now: number): void {
    for (const arc of this.arcs) {
      if (now - arc.born >= arc.life) this.respawnArc(arc, now);
      const t = arc.life <= 0 ? 1 : Math.min(1, Math.max(0, (now - arc.born) / arc.life));
      const env = Math.sin(t * Math.PI);
      arc.coreMat.opacity = env * 0.9;
      arc.glowMat.opacity = env * 0.4;
    }
  }

  private respawnArc(arc: Arc, now: number): void {
    arc.born = now;
    arc.life = 140 + Math.random() * 160;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sp = Math.sin(phi);
    const dx = Math.cos(theta) * sp;
    const dy = Math.cos(phi);
    const dz = Math.sin(theta) * sp;
    const px = -dz;
    const pz = dx;
    const start = 0.14;
    const end = 0.48 + Math.random() * 0.55;
    const amp = 0.1 + Math.random() * 0.07;
    for (let i = 0; i < ARC_POINTS; i += 1) {
      const along = i / (ARC_POINTS - 1);
      const radius = start + (end - start) * along;
      const endPoint = i === 0 || i === ARC_POINTS - 1;
      const jitter = endPoint ? 0 : (Math.random() - 0.5) * amp * 2;
      const lift = endPoint ? 0 : (Math.random() - 0.5) * amp;
      arc.points[i * 3] = dx * radius + px * jitter;
      arc.points[i * 3 + 1] = dy * radius + lift;
      arc.points[i * 3 + 2] = dz * radius + pz * jitter;
    }
    if (Math.random() < 0.28) {
      arc.coreMat.color.setHex(0xfff1c2);
      arc.glowMat.color.setHex(0xffc14a);
    } else {
      arc.coreMat.color.setHex(0xf7fbff);
      arc.glowMat.color.setHex(0x6eb6ff);
    }
  }

  private writeRibbon(attribute: BufferAttribute, points: Float32Array, width: number, up: Vector3): void {
    const half = width * 0.5;
    for (let i = 0; i < ARC_POINTS; i += 1) {
      const previous = Math.max(0, i - 1);
      const next = Math.min(ARC_POINTS - 1, i + 1);
      this.tangent.set(
        (points[next * 3] ?? 0) - (points[previous * 3] ?? 0),
        (points[next * 3 + 1] ?? 0) - (points[previous * 3 + 1] ?? 0),
        (points[next * 3 + 2] ?? 0) - (points[previous * 3 + 2] ?? 0),
      );
      if (this.tangent.lengthSq() < 1e-10) this.tangent.copy(this.up);
      this.side.crossVectors(this.tangent, up);
      if (this.side.lengthSq() < 1e-10) this.side.crossVectors(this.tangent, this.altUp);
      const taper = Math.sin(Math.PI * i / (ARC_POINTS - 1));
      this.side.normalize().multiplyScalar(half * Math.max(0.12, taper));
      const x = points[i * 3] ?? 0;
      const y = points[i * 3 + 1] ?? 0;
      const z = points[i * 3 + 2] ?? 0;
      attribute.setXYZ(i * 2, x - this.side.x, y - this.side.y, z - this.side.z);
      attribute.setXYZ(i * 2 + 1, x + this.side.x, y + this.side.y, z + this.side.z);
    }
    attribute.needsUpdate = true;
  }
}

/** Joueur dont l'action en cours est un blitz (`blitz`, `blitzMove`, `standUpBlitz`…). */
export function actingBlitzId(game: GameJson): string {
  const acting = game.actingPlayer;
  if (!acting) return '';
  const action = String(acting.playerAction ?? '').toLowerCase();
  if (!action.includes('blitz')) return '';
  const id = acting.playerId;
  if (id == null || id === '') return '';
  return String(id);
}

function shellDirs(count: number): Float32Array {
  const dirs = new Float32Array(count * 3);
  const shift = Math.PI * (3 - Math.sqrt(5));
  const steps = Math.max(1, count - 1);
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / steps) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = shift * i;
    dirs[i * 3] = Math.cos(theta) * ring;
    dirs[i * 3 + 1] = y;
    dirs[i * 3 + 2] = Math.sin(theta) * ring;
  }
  return dirs;
}

function canvasTexture(canvas: HTMLCanvasElement, flat = false): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  if (flat) {
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
  }
  return texture;
}

function discTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return canvasTexture(canvas, true);
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(214,238,255,0.82)');
    gradient.addColorStop(0.2, 'rgba(80,165,255,0.58)');
    gradient.addColorStop(0.46, 'rgba(40,105,255,0.34)');
    gradient.addColorStop(0.75, 'rgba(24,60,170,0.1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  return canvasTexture(canvas, true);
}

function warmTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,226,140,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,186,60,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  return canvasTexture(canvas, true);
}

function paintBolt(): { icon: HTMLCanvasElement; core: HTMLCanvasElement } {
  const icon = document.createElement('canvas');
  icon.width = ICON;
  icon.height = ICON;
  const core = document.createElement('canvas');
  core.width = ICON;
  core.height = ICON;
  const iconCtx = icon.getContext('2d');
  const coreCtx = core.getContext('2d');
  if (!iconCtx || !coreCtx) return { icon, core };
  const w = ICON;
  const h = ICON;

  iconCtx.lineJoin = 'miter';
  iconCtx.miterLimit = 8;
  iconCtx.lineCap = 'round';
  boltPath(iconCtx, w, h);
  iconCtx.shadowColor = 'rgba(80, 160, 255, 0.95)';
  iconCtx.shadowBlur = 36;
  iconCtx.lineWidth = 34;
  iconCtx.strokeStyle = '#6d5426';
  iconCtx.stroke();
  iconCtx.shadowBlur = 0;
  iconCtx.lineWidth = 20;
  iconCtx.strokeStyle = '#e8c56b';
  iconCtx.stroke();
  iconCtx.lineWidth = 8;
  iconCtx.strokeStyle = '#fff0c4';
  iconCtx.stroke();

  const fill = iconCtx.createLinearGradient(w * 0.72, h * 0.16, w * 0.22, h * 0.84);
  fill.addColorStop(0, '#1c458f');
  fill.addColorStop(0.45, '#0c1d4c');
  fill.addColorStop(1, '#070f28');
  iconCtx.fillStyle = fill;
  iconCtx.fill();

  iconCtx.save();
  boltPath(iconCtx, w, h);
  iconCtx.clip();
  const hot = iconCtx.createRadialGradient(w * 0.48, h * 0.44, 8, w * 0.46, h * 0.5, w * 0.3);
  hot.addColorStop(0, 'rgba(255,255,245,0.72)');
  hot.addColorStop(0.38, 'rgba(255,214,110,0.28)');
  hot.addColorStop(1, 'rgba(255,190,60,0)');
  iconCtx.fillStyle = hot;
  iconCtx.fillRect(0, 0, w, h);
  iconCtx.lineWidth = 8;
  iconCtx.strokeStyle = 'rgba(255, 236, 190, 0.8)';
  iconCtx.stroke();
  drawCracks(iconCtx, w, h, 18);
  iconCtx.restore();

  glint(iconCtx, w * 0.86, h * 0.1, 5);
  glint(iconCtx, w * 0.84, h * 0.4, 4);
  glint(iconCtx, w * 0.14, h * 0.55, 3.5);
  glint(iconCtx, w * 0.14, h * 0.88, 4);

  coreCtx.lineJoin = 'round';
  coreCtx.lineCap = 'round';
  coreCtx.save();
  boltPath(coreCtx, w, h);
  coreCtx.clip();
  drawCracks(coreCtx, w, h, 16);
  coreCtx.restore();
  return { icon, core };
}

function drawCracks(ctx: CanvasRenderingContext2D, w: number, h: number, width: number): void {
  energy(ctx, SPINE, w, h, width, 'rgba(255, 236, 150, 0.95)', 'rgba(255,255,255,0.98)');
  for (const branch of BRANCHES) {
    energy(ctx, branch, w, h, width * 0.55, 'rgba(190, 225, 255, 0.9)', 'rgba(255,255,255,0.95)');
  }
}

function energy(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  w: number,
  h: number,
  width: number,
  glow: string,
  core: string,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = glow;
  ctx.lineWidth = width;
  strokeOpen(ctx, points, w, h);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = core;
  ctx.lineWidth = Math.max(1.5, width * 0.32);
  ctx.stroke();
  ctx.restore();
}

function boltPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const first = BOLT[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first[0] * w, first[1] * h);
  for (let i = 1; i < BOLT.length; i += 1) {
    const point = BOLT[i];
    if (!point) continue;
    ctx.lineTo(point[0] * w, point[1] * h);
  }
  ctx.closePath();
}

function strokeOpen(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  w: number,
  h: number,
): void {
  const first = points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first[0] * w, first[1] * h);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (!point) continue;
    ctx.lineTo(point[0] * w, point[1] * h);
  }
}

function glint(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 246, 214, 0.95)';
  ctx.shadowColor = 'rgba(255, 210, 90, 0.95)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintDischarges(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const count = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const start = size * (0.11 + Math.random() * 0.08);
    const end = size * (0.34 + Math.random() * 0.13);
    drawJagged(
      ctx,
      size / 2 + Math.cos(angle) * start,
      size / 2 + Math.sin(angle) * start,
      size / 2 + Math.cos(angle) * end,
      size / 2 + Math.sin(angle) * end,
      4 + Math.floor(Math.random() * 3),
      9 + Math.random() * 8,
      i % 3 === 0,
    );
  }
}

function drawJagged(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  segments: number,
  amp: number,
  heavy: boolean,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const j = (Math.random() - 0.5) * amp * Math.sin(Math.PI * t);
    pts.push([x0 + dx * t + nx * j, y0 + dy * t + ny * j]);
  }
  pts.push([x1, y1]);
  strokePixels(ctx, pts, heavy ? 4.2 : 2.6, 'rgba(140, 200, 255, 0.55)', 8);
  strokePixels(ctx, pts, heavy ? 1.7 : 1.1, 'rgba(255,255,255,0.92)', 0);
  ctx.save();
  ctx.fillStyle = Math.random() < 0.4 ? 'rgba(255, 220, 130, 0.95)' : 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(255, 230, 160, 0.9)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x1, y1, heavy ? 3.2 : 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (!heavy || pts.length < 4 || Math.random() > 0.6) return;
  const mid = pts[1 + Math.floor(Math.random() * (pts.length - 2))];
  if (!mid) return;
  const branch = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6);
  const reach = len * (0.28 + Math.random() * 0.22);
  drawJagged(
    ctx,
    mid[0],
    mid[1],
    mid[0] + Math.cos(branch) * reach,
    mid[1] + Math.sin(branch) * reach,
    3,
    amp * 0.45,
    false,
  );
}

function strokePixels(
  ctx: CanvasRenderingContext2D,
  pts: readonly (readonly [number, number])[],
  width: number,
  color: string,
  blur: number,
): void {
  const first = pts[0];
  if (!first) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i += 1) {
    const point = pts[i];
    if (!point) continue;
    ctx.lineTo(point[0], point[1]);
  }
  ctx.stroke();
  ctx.restore();
}
