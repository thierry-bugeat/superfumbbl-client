import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Shape,
  ShapeGeometry,
} from 'three';
import { squareToWorld } from '../coords';

/** Plaque jaune et flèche, comme l'overlay de poussée de SpikeBowl. Le pas de côté est cyan. */
const PUSH_PLATE = 0xf5d53d;
const PUSH_ARROW = 0xffff00;
const CHOSEN_PLATE = 0xfff6c4;
const CHOSEN_ARROW = 0xfffdf2;
const SIDESTEP_PLATE = 0x4ec4e0;
const SIDESTEP_ARROW = 0xb8f0fa;
const SIDESTEP_CHOSEN_PLATE = 0xe7fbff;
const SIDESTEP_CHOSEN_ARROW = 0xffffff;
const SCATTER_ARROW = 0xffb000;

const PLATE = 0.82;
const PLATE_Y = 0.045;
const ARROW_Y = 0.07;
const SHAFT_LENGTH = 0.46;
const HEAD_LENGTH = 0.22;
const ARROW_LENGTH = SHAFT_LENGTH + HEAD_LENGTH;

export interface GroundMark {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** `none` : flèche seule, pour une dispersion. */
  plate: 'push' | 'sidestep' | 'none';
  /** Case encore au choix, case retenue, ou case d'une poussée déjà résolue. */
  role: 'open' | 'chosen' | 'settled';
}

/** Cases de poussée et flèches de dispersion, à plat sur le terrain. */
export class GroundMarks {
  private readonly group = new Group();
  private readonly plateGeometry = new PlaneGeometry(PLATE, PLATE);
  private readonly arrowGeometry = arrowShape();
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly chosen: MeshBasicMaterial[] = [];
  private key = '';

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  show(marks: readonly GroundMark[]): void {
    const next = marks.map(markKey).join(';');
    if (next === this.key) return;
    this.key = next;
    this.clearMeshes();
    for (const mark of marks) this.add(mark);
  }

  clear(): void {
    this.key = '';
    this.clearMeshes();
  }

  tick(now: number): void {
    if (this.chosen.length === 0) return;
    const wave = 0.5 - 0.5 * Math.cos((now / 900) * Math.PI * 2);
    const opacity = 0.62 + wave * 0.38;
    for (const material of this.chosen) material.opacity = opacity;
  }

  dispose(): void {
    this.clearMeshes();
    this.plateGeometry.dispose();
    this.arrowGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.group.removeFromParent();
  }

  private add(mark: GroundMark): void {
    const at = squareToWorld(mark.toX, mark.toY);
    const chosen = mark.role === 'chosen';
    const sidestep = mark.plate === 'sidestep';
    if (mark.plate !== 'none') {
      const color = chosen
        ? (sidestep ? SIDESTEP_CHOSEN_PLATE : CHOSEN_PLATE)
        : (sidestep ? SIDESTEP_PLATE : PUSH_PLATE);
      const opacity = mark.role === 'settled' ? 0.28 : chosen ? 1 : 0.8;
      const plate = new Mesh(this.plateGeometry, this.material(color, opacity, chosen));
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(at.x, PLATE_Y, at.z);
      plate.renderOrder = 2;
      this.group.add(plate);
    }
    if (mark.fromX === mark.toX && mark.fromY === mark.toY) return;
    const from = squareToWorld(mark.fromX, mark.fromY);
    const color = mark.plate === 'none'
      ? SCATTER_ARROW
      : chosen
        ? (sidestep ? SIDESTEP_CHOSEN_ARROW : CHOSEN_ARROW)
        : (sidestep ? SIDESTEP_ARROW : PUSH_ARROW);
    const opacity = mark.role === 'settled' ? 0.35 : 0.95;
    const arrow = new Mesh(this.arrowGeometry, this.material(color, opacity, false));
    arrow.rotation.x = Math.PI / 2;
    arrow.position.z = -ARROW_LENGTH / 2;
    const root = new Group();
    root.position.set(at.x, ARROW_Y, at.z);
    root.rotation.y = Math.atan2(at.x - from.x, at.z - from.z);
    root.renderOrder = 3;
    root.add(arrow);
    this.group.add(root);
  }

  private material(color: number, opacity: number, chosen: boolean): MeshBasicMaterial {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(material);
    if (chosen) this.chosen.push(material);
    return material;
  }

  private clearMeshes(): void {
    this.chosen.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    for (const child of this.group.children) {
      child.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.geometry && mesh.geometry !== this.plateGeometry && mesh.geometry !== this.arrowGeometry) {
          mesh.geometry.dispose();
        }
      });
    }
    this.group.clear();
  }
}

function markKey(mark: GroundMark): string {
  return `${mark.fromX},${mark.fromY},${mark.toX},${mark.toY},${mark.plate},${mark.role}`;
}

function arrowShape(): ShapeGeometry {
  const halfShaft = 0.07;
  const halfHead = 0.16;
  const shape = new Shape();
  shape.moveTo(0, ARROW_LENGTH);
  shape.lineTo(halfHead, SHAFT_LENGTH);
  shape.lineTo(halfShaft, SHAFT_LENGTH);
  shape.lineTo(halfShaft, 0);
  shape.lineTo(-halfShaft, 0);
  shape.lineTo(-halfShaft, SHAFT_LENGTH);
  shape.lineTo(-halfHead, SHAFT_LENGTH);
  shape.closePath();
  return new ShapeGeometry(shape);
}
