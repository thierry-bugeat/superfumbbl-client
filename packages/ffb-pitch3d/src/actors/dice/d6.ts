/**
 * Dés à 6 faces : cube ivoire, points noirs, lancer puis pose sur la face tirée.
 * Les dés de blessure sont noirs, à points blancs.
 * Un jet d'armure ou de blessure en lance deux. Plusieurs jets s'enchaînent :
 * chacun reste affiché 600 ms, disparaît, puis le suivant est lancé.
 * Un autre jet, d'une autre figurine, ne retire pas ceux qui sont encore là.
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

/** Même cube et même écart que les dés de bloc. */
const DIE_SIZE = 0.58;
const SPACING = 0.78;
/** Même hauteur de pose que les dés de bloc. */
const REST_Y = 1.65;
const ROLL_MS = 700;
/** Le résultat reste visible, puis les dés disparaissent. */
const HOLD_MS = 600;
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
  /** Même ordre que `rolls`. `true` : dés noirs, points blancs. */
  injury?: readonly boolean[];
  /** Joueur du jet, quand la sortie du terrain doit attendre les dés de blessure. */
  playerId?: string;
  /** Case de ce joueur, en monde, au moment du jet. */
  anchor?: { x: number; z: number };
}

/** Durée jusqu'à la fin de l'affichage des dés de blessure. `null` s'il n'y en a pas. */
export function injuryRevealMs(spec: NumberDiceSpec): number | null {
  let elapsed = 0;
  let reveal: number | null = null;
  spec.rolls.forEach((roll, index) => {
    const values = roll.filter((value) => value >= 1 && value <= 6).slice(0, 2);
    if (values.length === 0) return;
    elapsed += ROLL_MS + HOLD_MS;
    if (spec.injury?.[index] === true) reveal = elapsed;
  });
  return reveal;
}

interface ActiveThrow {
  rolls: number[][];
  /** Aligné sur `rolls`. */
  injury: boolean[];
  phase: number;
  mode: 'rolling' | 'holding';
  rollStart: number;
  holdStart: number;
  dice: Mesh[];
  group: Group;
}

export class NumberDice {
  readonly group = new Group();
  private readonly bodyGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.06);
  private readonly faceGeometry = new PlaneGeometry(DIE_SIZE * 0.72, DIE_SIZE * 0.72);
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: 0xf6f1e6,
    roughness: 0.42,
    metalness: 0.04,
  });
  private readonly injuryBody = new MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.46,
    metalness: 0.08,
  });
  private readonly pipMaterials = new Map<number, MeshBasicMaterial>();
  private readonly injuryPips = new Map<number, MeshBasicMaterial>();
  private readonly throws: ActiveThrow[] = [];
  /** Jets déjà partis. Un pas suivant ne les relance pas et ne les déplace pas. */
  private readonly seen = new Set<string>();

  constructor(scene: Scene) {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      this.pipMaterials.set(value, pipMaterial(value, '#1a1a1a'));
      this.injuryPips.set(value, pipMaterial(value, '#f4f4f4'));
    }
    scene.add(this.group);
  }

  show(spec: NumberDiceSpec): void {
    const rolls: number[][] = [];
    const injury: boolean[] = [];
    spec.rolls.forEach((roll, index) => {
      const values = roll.filter((value) => value >= 1 && value <= 6).slice(0, 2);
      if (values.length === 0) return;
      rolls.push(values);
      injury.push(spec.injury?.[index] === true);
    });
    if (rolls.length === 0 || this.seen.has(spec.key)) return;
    this.seen.add(spec.key);
    const group = new Group();
    group.position.set(spec.x, 0, spec.z);
    this.group.add(group);
    const item: ActiveThrow = {
      rolls,
      injury,
      phase: 0,
      mode: 'rolling',
      rollStart: 0,
      holdStart: 0,
      dice: [],
      group,
    };
    this.throws.push(item);
    this.beginPhase(item);
  }

  clear(): void {
    for (const item of [...this.throws]) this.finish(item);
    this.seen.clear();
  }

  /** Un saut retire tous les dés. Un pas en avant laisse chaque jet finir ses 600 ms. */
  release(immediate: boolean): void {
    if (immediate) this.clear();
  }

  tick(now: number): void {
    for (const item of [...this.throws]) this.tickThrow(item, now);
  }

  dispose(): void {
    this.clear();
    this.bodyGeometry.dispose();
    this.faceGeometry.dispose();
    this.bodyMaterial.dispose();
    this.injuryBody.dispose();
    for (const material of [...this.pipMaterials.values(), ...this.injuryPips.values()]) {
      material.map?.dispose();
      material.dispose();
    }
    this.pipMaterials.clear();
    this.injuryPips.clear();
    this.group.removeFromParent();
  }

  private tickThrow(item: ActiveThrow, now: number): void {
    if (item.mode === 'holding') {
      if (item.holdStart === 0) item.holdStart = now;
      if (now - item.holdStart < HOLD_MS) return;
      if (item.phase >= item.rolls.length - 1) {
        this.finish(item);
        return;
      }
      item.phase += 1;
      this.beginPhase(item);
      return;
    }
    if (item.rollStart === 0) item.rollStart = now;
    const progress = Math.min(1, (now - item.rollStart) / ROLL_MS);
    for (const die of item.dice) {
      const data = die.userData as { spinX: number; spinY: number; spinZ: number; jump: number };
      die.rotation.x += data.spinX;
      die.rotation.y += data.spinY;
      die.rotation.z += data.spinZ;
      die.position.y = REST_Y + 4 * progress * (1 - progress) * data.jump;
    }
    if (progress < 1) return;
    this.layFlat(item);
    item.mode = 'holding';
    item.holdStart = now;
  }

  private finish(item: ActiveThrow): void {
    const index = this.throws.indexOf(item);
    if (index >= 0) this.throws.splice(index, 1);
    item.group.removeFromParent();
  }

  private beginPhase(item: ActiveThrow): void {
    const values = item.rolls[item.phase];
    if (!values) {
      this.finish(item);
      return;
    }
    this.rebuild(item, values, item.injury[item.phase] === true);
    item.mode = 'rolling';
    item.rollStart = 0;
    item.holdStart = 0;
  }

  private rebuild(item: ActiveThrow, values: readonly number[], injury: boolean): void {
    for (const child of [...item.group.children]) child.removeFromParent();
    item.dice = [];
    const total = (values.length - 1) * SPACING;
    const body = injury ? this.injuryBody : this.bodyMaterial;
    for (let i = 0; i < values.length; i += 1) {
      const die = new Mesh(this.bodyGeometry, body);
      die.castShadow = true;
      die.receiveShadow = true;
      die.position.set(0, REST_Y, -total / 2 + i * SPACING);
      die.userData.spinX = 0.32 + Math.random() * 0.22;
      die.userData.spinY = 0.26 + Math.random() * 0.24;
      die.userData.spinZ = 0.3 + Math.random() * 0.2;
      die.userData.jump = 1.05 + Math.random() * 0.45;
      die.userData.result = values[i];
      this.addPips(die, injury);
      item.group.add(die);
      item.dice.push(die);
    }
  }

  private addPips(die: Mesh, injury: boolean): void {
    const pips = injury ? this.injuryPips : this.pipMaterials;
    for (const entry of FACE_NORMALS) {
      const material = pips.get(entry.value);
      if (!material) continue;
      const sticker = new Mesh(this.faceGeometry, material);
      sticker.position.copy(entry.normal).multiplyScalar(DIE_SIZE / 2 + 0.01);
      sticker.lookAt(sticker.position.clone().add(entry.normal));
      die.add(sticker);
    }
  }

  /** La face tirée reste vers le ciel. Les points se lisent de l'en-but extérieur vers l'en-but domicile. */
  private layFlat(item: ActiveThrow): void {
    for (const die of item.dice) {
      const from = faceNormal(die.userData.result as number | undefined);
      if (!from) continue;
      const align = new Quaternion().setFromUnitVectors(from, UP);
      die.quaternion.copy(align).premultiply(yawAlongPitch(from, align));
      die.position.y = REST_Y;
    }
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

function pipMaterial(value: number, ink: string): MeshBasicMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = ink;
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
