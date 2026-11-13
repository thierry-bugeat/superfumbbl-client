/**
 * Dés à 6 faces : cube ivoire, points noirs, lancer puis pose sur la face tirée.
 * Un jet d'armure ou de blessure en lance deux. Plusieurs jets s'enchaînent :
 * le suivant part une fois le précédent posé.
 */
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DIE_SIZE = 0.5;
const SPACING = 0.68;
const REST_Y = 1.45;
const ROLL_MS = 700;
const HOLD_MS = 1100;
const UP = new Vector3(0, 1, 0);
const SYMBOL_UP = new Vector3(1, 0, 0);

/** Faces opposées qui totalisent 7. */
const FACE_NORMALS: { value: number; normal: Vector3 }[] = [
  { value: 1, normal: new Vector3(0, 0, 1) },
  { value: 6, normal: new Vector3(0, 0, -1) },
  { value: 2, normal: new Vector3(1, 0, 0) },
  { value: 5, normal: new Vector3(-1, 0, 0) },
  { value: 3, normal: new Vector3(0, 1, 0) },
  { value: 4, normal: new Vector3(0, -1, 0) },
];

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
};

export interface NumberDiceSpec {
  /** Identité du jet. Le même jet ne relance pas l'animation. */
  key: string;
  x: number;
  z: number;
  /** Chaque entrée est un lancer : un dé, ou deux pour l'armure et la blessure. */
  rolls: readonly (readonly number[])[];
}

export class NumberDice {
  readonly group = new Group();
  private readonly bodyGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.055);
  private readonly faceGeometry = new PlaneGeometry(DIE_SIZE * 0.72, DIE_SIZE * 0.72);
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: 0xf6f1e6,
    roughness: 0.42,
    metalness: 0.04,
  });
  private readonly pipMaterials = new Map<number, MeshBasicMaterial>();
  private key = '';
  private mode: 'hidden' | 'rolling' | 'holding' | 'result' = 'hidden';
  private rolls: number[][] = [];
  private phase = 0;
  private rollStart = 0;
  private holdStart = 0;
  /** L'étape a changé : finir le jet en cours, puis retirer les dés. */
  private dismissAfter = false;
  private readonly dice: Mesh[] = [];

  constructor(scene: Scene) {
    for (const value of [1, 2, 3, 4, 5, 6]) this.pipMaterials.set(value, pipMaterial(value));
    scene.add(this.group);
  }

  show(spec: NumberDiceSpec): void {
    const rolls = spec.rolls
      .map((roll) => roll.filter((value) => value >= 1 && value <= 6).slice(0, 2))
      .filter((roll) => roll.length > 0);
    if (rolls.length === 0) {
      this.clear();
      return;
    }
    this.dismissAfter = false;
    this.group.position.set(spec.x, 0, spec.z);
    if (spec.key === this.key && this.mode !== 'hidden') return;
    this.key = spec.key;
    this.rolls = rolls;
    this.phase = 0;
    this.beginPhase();
  }

  clear(): void {
    this.key = '';
    this.mode = 'hidden';
    this.rolls = [];
    this.phase = 0;
    this.dismissAfter = false;
    this.dice.length = 0;
    this.empty();
  }

  /** Un saut dans le replay retire les dés tout de suite. Un pas en avant les laisse finir. */
  release(immediate: boolean): void {
    if (immediate || this.mode === 'hidden' || this.mode === 'result') {
      this.clear();
      return;
    }
    this.dismissAfter = true;
  }

  tick(now: number): void {
    if (this.mode === 'holding') {
      if (this.holdStart === 0) this.holdStart = now;
      if (now - this.holdStart < HOLD_MS) return;
      if (this.phase >= this.rolls.length - 1) {
        this.clear();
        return;
      }
      this.phase += 1;
      this.beginPhase();
      return;
    }
    if (this.mode !== 'rolling') return;
    if (this.rollStart === 0) this.rollStart = now;
    const progress = Math.min(1, (now - this.rollStart) / ROLL_MS);
    for (const die of this.dice) {
      const data = die.userData as { spinX: number; spinY: number; spinZ: number; jump: number };
      die.rotation.x += data.spinX;
      die.rotation.y += data.spinY;
      die.rotation.z += data.spinZ;
      die.position.y = REST_Y + 4 * progress * (1 - progress) * data.jump;
    }
    if (progress < 1) return;
    this.layFlat();
    if (this.phase < this.rolls.length - 1) {
      this.mode = 'holding';
      this.holdStart = now;
      return;
    }
    if (this.dismissAfter) {
      this.mode = 'holding';
      this.holdStart = now;
      return;
    }
    this.mode = 'result';
  }

  dispose(): void {
    this.clear();
    this.bodyGeometry.dispose();
    this.faceGeometry.dispose();
    this.bodyMaterial.dispose();
    for (const material of this.pipMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.pipMaterials.clear();
    this.group.removeFromParent();
  }

  private beginPhase(): void {
    const values = this.rolls[this.phase];
    if (!values) {
      this.mode = 'result';
      return;
    }
    this.rebuild(values);
    this.mode = 'rolling';
    this.rollStart = 0;
    this.holdStart = 0;
  }

  private rebuild(values: readonly number[]): void {
    this.empty();
    this.dice.length = 0;
    const total = (values.length - 1) * SPACING;
    for (let i = 0; i < values.length; i += 1) {
      const die = new Mesh(this.bodyGeometry, this.bodyMaterial);
      die.castShadow = true;
      die.receiveShadow = true;
      die.position.set(0, REST_Y, -total / 2 + i * SPACING);
      die.userData.spinX = 0.32 + Math.random() * 0.22;
      die.userData.spinY = 0.26 + Math.random() * 0.24;
      die.userData.spinZ = 0.3 + Math.random() * 0.2;
      die.userData.jump = 1.05 + Math.random() * 0.45;
      die.userData.result = values[i];
      this.addPips(die);
      this.group.add(die);
      this.dice.push(die);
    }
  }

  private addPips(die: Mesh): void {
    for (const entry of FACE_NORMALS) {
      const material = this.pipMaterials.get(entry.value);
      if (!material) continue;
      const sticker = new Mesh(this.faceGeometry, material);
      sticker.position.copy(entry.normal).multiplyScalar(DIE_SIZE / 2 + 0.01);
      sticker.lookAt(sticker.position.clone().add(entry.normal));
      die.add(sticker);
    }
  }

  /** La face tirée reste vers le ciel. Les points se lisent de l'en-but extérieur vers l'en-but domicile. */
  private layFlat(): void {
    for (const die of this.dice) {
      const from = faceNormal(die.userData.result as number | undefined);
      if (!from) continue;
      const align = new Quaternion().setFromUnitVectors(from, UP);
      die.quaternion.copy(align).premultiply(yawAlongPitch(from, align));
      die.position.y = REST_Y;
    }
  }

  private empty(): void {
    for (const child of [...this.group.children]) child.removeFromParent();
  }
}

function faceNormal(value: number | undefined): Vector3 | null {
  const normal = FACE_NORMALS.find((entry) => entry.value === value)?.normal;
  return normal ? normal.clone().normalize() : null;
}

function yawAlongPitch(normal: Vector3, align: Quaternion): Quaternion {
  const sticker = new Object3D();
  sticker.position.copy(normal);
  sticker.lookAt(sticker.position.clone().add(normal));
  const heading = new Vector3(0, 1, 0).applyQuaternion(sticker.quaternion).applyQuaternion(align);
  heading.y = 0;
  if (heading.lengthSq() < 1e-8) return new Quaternion();
  heading.normalize();
  const angle = Math.atan2(heading.clone().cross(SYMBOL_UP).y, heading.dot(SYMBOL_UP));
  return new Quaternion().setFromAxisAngle(UP, angle);
}

function pipMaterial(value: number): MeshBasicMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#1a1a1a';
    for (const [u, v] of PIPS[value] ?? []) {
      ctx.beginPath();
      ctx.arc(u * 128, v * 128, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return new MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.2,
    depthWrite: false,
    side: DoubleSide,
  });
}
