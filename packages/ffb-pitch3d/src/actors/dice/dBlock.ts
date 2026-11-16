/**
 * Dés de blocage, comme dans SpikeBowl : cube arrondi, symboles de l'atlas,
 * lancer puis pose sur la face tirée. La couleur du corps est choisie par l'appelant.
 */
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const ATLAS_URL = new URL('../../../assets/textures/block-dice-atlas.png', import.meta.url).href;
const DIE_SIZE = 0.58;
const SPACING = 0.78;
const REST_Y = 1.65;
const ROLL_MS = 650;
const UP = new Vector3(0, 1, 0);

const FACES: { face: BlockFace; normal: Vector3 }[] = [
  { face: 'SKULL', normal: new Vector3(0, 0, 1) },
  { face: 'BOTH_DOWN', normal: new Vector3(0, 0, -1) },
  { face: 'PUSH', normal: new Vector3(1, 0, 0) },
  { face: 'PUSH', normal: new Vector3(-1, 0, 0) },
  { face: 'POW_PUSH', normal: new Vector3(0, 1, 0) },
  { face: 'POW', normal: new Vector3(0, -1, 0) },
];

type BlockFace = 'SKULL' | 'BOTH_DOWN' | 'PUSH' | 'POW_PUSH' | 'POW';

export interface BlockDiceSpec {
  /** Identité du jet. Le même jet ne relance pas l'animation. */
  key: string;
  x: number;
  z: number;
  faces: readonly number[];
  color: number;
  /** Index du dé retenu, une fois le choix connu. */
  chosen: number | null;
}

export class BlockDice {
  readonly group = new Group();
  private atlas: Texture | null = null;
  private readonly bodyGeometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.06);
  private readonly faceGeometry = new PlaneGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.62);
  private key = '';
  private mode: 'hidden' | 'rolling' | 'result' = 'hidden';
  private color = 0x1c1c1c;
  private chosen: number | null = null;
  private rollStart = 0;
  private readonly dice: Mesh[] = [];
  private halo: Group | null = null;

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  async load(anisotropy = 1): Promise<void> {
    const atlas = await new TextureLoader().loadAsync(ATLAS_URL);
    atlas.colorSpace = SRGBColorSpace;
    atlas.anisotropy = anisotropy;
    atlas.wrapS = ClampToEdgeWrapping;
    atlas.wrapT = ClampToEdgeWrapping;
    this.atlas = atlas;
  }

  show(spec: BlockDiceSpec): void {
    this.group.position.set(spec.x, 0, spec.z);
    this.color = spec.color;
    this.chosen = spec.chosen;
    if (spec.key === this.key && this.mode !== 'hidden') {
      this.paintBodies();
      if (this.mode === 'result') this.applyChosen();
      return;
    }
    this.key = spec.key;
    this.rebuild(spec.faces);
    this.mode = 'rolling';
    this.rollStart = 0;
    if (this.halo) this.halo.visible = false;
  }

  clear(): void {
    this.key = '';
    this.mode = 'hidden';
    this.chosen = null;
    this.dice.length = 0;
    if (this.halo) this.halo.visible = false;
    this.empty();
  }

  tick(now: number): void {
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
    if (progress >= 1) {
      this.mode = 'result';
      this.layFlat();
      this.applyChosen();
    }
  }

  dispose(): void {
    this.clear();
    this.disposeHalo();
    this.bodyGeometry.dispose();
    this.faceGeometry.dispose();
    this.atlas?.dispose();
    this.atlas = null;
    this.group.removeFromParent();
  }

  private rebuild(values: readonly number[]): void {
    this.empty();
    this.dice.length = 0;
    const count = Math.max(1, Math.min(values.length, 3));
    const total = (count - 1) * SPACING;
    for (let i = 0; i < count; i += 1) {
      const body = new MeshStandardMaterial({
        color: this.color,
        roughness: 0.4,
        metalness: 0.04,
        emissive: this.color,
        emissiveIntensity: 0.22,
      });
      const die = new Mesh(this.bodyGeometry, body);
      die.castShadow = true;
      die.receiveShadow = true;
      die.position.set(0, REST_Y, -total / 2 + i * SPACING);
      die.userData.spinX = 0.35 + Math.random() * 0.2;
      die.userData.spinY = 0.28 + Math.random() * 0.25;
      die.userData.spinZ = 0.3 + Math.random() * 0.2;
      die.userData.jump = 1.05 + Math.random() * 0.4;
      die.userData.face = faceName(values[i] ?? 3);
      this.addStickers(die);
      this.group.add(die);
      this.dice.push(die);
    }
  }

  private addStickers(die: Mesh): void {
    const atlas = this.atlas;
    if (!atlas) return;
    for (const entry of FACES) {
      const cell = atlasCell(entry.face);
      const tex = atlas.clone();
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = atlas.anisotropy;
      tex.wrapS = ClampToEdgeWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.repeat.set(1 / 3, 1 / 2);
      tex.offset.set(cell.col / 3, 1 - (cell.row + 1) / 2);
      tex.needsUpdate = true;
      const sticker = new Mesh(this.faceGeometry, new MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.15,
        depthWrite: false,
        side: DoubleSide,
      }));
      sticker.position.copy(entry.normal).multiplyScalar(DIE_SIZE / 2 + 0.012);
      sticker.lookAt(sticker.position.clone().add(entry.normal));
      die.add(sticker);
    }
  }

  private paintBodies(): void {
    for (const die of this.dice) {
      const material = die.material;
      if (material instanceof MeshStandardMaterial) {
        material.color.set(this.color);
        material.emissive.set(this.color);
      }
    }
  }

  /** Cercle lumineux sous le dé retenu. Les dés restent tous à la même hauteur. */
  private ensureHalo(): Group {
    if (this.halo) return this.halo;
    const group = new Group();
    const ring = new Mesh(new RingGeometry(DIE_SIZE * 0.42, DIE_SIZE * 0.78, 48), new MeshBasicMaterial({
      color: 0xfff6c8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    const glow = new Mesh(new RingGeometry(DIE_SIZE * 0.2, DIE_SIZE * 1.05, 48), new MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      toneMapped: false,
    }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.01;
    group.add(ring, glow);
    group.visible = false;
    this.group.add(group);
    this.halo = group;
    return group;
  }

  private disposeHalo(): void {
    const halo = this.halo;
    if (!halo) return;
    halo.removeFromParent();
    halo.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    });
    this.halo = null;
  }

  /** La face tirée reste vers le ciel. Le symbole se lit de l'en-but extérieur vers l'en-but domicile. */
  private layFlat(): void {
    for (const die of this.dice) {
      const from = faceNormal(die.userData.face as BlockFace | undefined);
      if (!from) continue;
      const align = new Quaternion().setFromUnitVectors(from, UP);
      die.quaternion.copy(align).premultiply(yawAlongPitch(from, align));
      die.position.y = REST_Y;
    }
  }

  private applyChosen(): void {
    const halo = this.ensureHalo();
    const chosen = this.chosen === null ? undefined : this.dice[this.chosen];
    this.dice.forEach((die) => {
      die.position.y = REST_Y;
    });
    if (!chosen) {
      halo.visible = false;
      return;
    }
    halo.visible = true;
    halo.position.set(chosen.position.x, REST_Y - DIE_SIZE / 2 - 0.02, chosen.position.z);
  }

  private empty(): void {
    const children = this.group.children.filter((child) => child !== this.halo);
    for (const child of children) {
      child.removeFromParent();
      child.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (material instanceof MeshBasicMaterial && material.map && material.map !== this.atlas) material.map.dispose();
          material.dispose();
        }
      });
    }
  }
}

function faceName(value: number): BlockFace {
  switch (value) {
    case 1: return 'SKULL';
    case 2: return 'BOTH_DOWN';
    case 5: return 'POW_PUSH';
    case 6: return 'POW';
    default: return 'PUSH';
  }
}

function atlasCell(face: BlockFace): { col: number; row: number } {
  switch (face) {
    case 'SKULL': return { col: 0, row: 0 };
    case 'BOTH_DOWN': return { col: 1, row: 0 };
    case 'PUSH': return { col: 2, row: 0 };
    case 'POW_PUSH': return { col: 0, row: 1 };
    case 'POW': return { col: 1, row: 1 };
  }
}

function faceNormal(face: BlockFace | undefined): Vector3 | null {
  const normal = FACES.find((entry) => entry.face === face)?.normal;
  return normal ? normal.clone().normalize() : null;
}

/** Haut du symbole : en-but extérieur (+X). On lit donc vers l'en-but domicile (−X). */
const SYMBOL_UP = new Vector3(1, 0, 0);

/** Tourne le dé autour de la verticale, sans coucher la face. */
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
