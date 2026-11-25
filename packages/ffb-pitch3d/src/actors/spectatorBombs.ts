import {
  CanvasTexture,
  Group,
  Mesh,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS, squareToWorld } from '../coords';
import { BOMB_STAND_Y, createBombCharacter, pulseBombWick, type BombCharacter } from './bombFigure';

/** Une bombe par case de largeur, face à l'en-but away. Les suivantes reculent. */
const PER_ROW = PITCH_ROWS;

/**
 * Une figurine bombe par spectateur, juste après l'en-but away.
 * Le nombre vient du direct (`serverJoin` / `serverLeave`), pas du jet de foule du match.
 */
/** Hauteur monde de la bulle, queue comprise. */
const BUBBLE_HEIGHT = 0.78;
/** Pointe de la queue, au-dessus de la mèche. */
const BUBBLE_TIP_Y = 0.5;

export class SpectatorBombs {
  private readonly group = new Group();
  private prototype: BombCharacter | null = null;
  private readonly holders: Group[] = [];
  private readonly bubbleTextures = new Map<string, ComicBubble>();
  private bubble: Sprite | null = null;
  private bubbleMaterial: SpriteMaterial | null = null;
  private hoveredIndex: number | null = null;

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  /** `names[i]` est le coach de la figurine i. Une liste plus longue ajoute des figurines. */
  sync(count: number, names: readonly string[]): void {
    const total = Math.max(Math.max(0, Math.floor(count)), names.length);
    while (this.holders.length < total) this.add(this.holders.length);
    while (this.holders.length > total) this.holders.pop()?.removeFromParent();
    for (let index = 0; index < this.holders.length; index += 1) {
      const holder = this.holders[index];
      if (!holder) continue;
      holder.userData.spectatorIndex = index;
      holder.userData.spectatorName = names[index]?.trim() ?? '';
    }
    if (this.hoveredIndex != null && this.hoveredIndex >= this.holders.length) this.hoveredIndex = null;
    this.placeBubble();
  }

  /** Figurines testées par le rayon du pointeur. */
  targets(): Group[] {
    return this.holders;
  }

  /** `index` null : le pointeur a quitté les figurines. Sans nom, pas de bulle. */
  hover(index: number | null): void {
    this.hoveredIndex = index;
    this.placeBubble();
  }

  tick(now: number): void {
    for (const holder of this.holders) {
      const phase = Number(holder.userData.phase) || 0;
      holder.position.y = BOMB_STAND_Y + Math.sin(now * 0.0016 + phase) * 0.02;
      pulseBombWick(
        now,
        named(holder, 'bomb-flame'),
        named(holder, 'bomb-spark'),
        named(holder, 'bomb-glow'),
        holder.position.y,
      );
    }
  }

  dispose(): void {
    this.hover(null);
    this.holders.length = 0;
    this.group.clear();
    this.bubbleMaterial?.dispose();
    this.bubbleMaterial = null;
    this.bubble = null;
    for (const drawn of this.bubbleTextures.values()) drawn.texture.dispose();
    this.bubbleTextures.clear();
    this.prototype?.dispose();
    this.prototype = null;
    this.group.removeFromParent();
  }

  private placeBubble(): void {
    const holder = this.hoveredIndex == null ? null : this.holders[this.hoveredIndex];
    const name = typeof holder?.userData.spectatorName === 'string' ? holder.userData.spectatorName : '';
    if (!holder || !name) {
      this.bubble?.removeFromParent();
      return;
    }
    const drawn = this.bubbleArt(name);
    const bubble = this.ensureBubble();
    const material = bubble.material as SpriteMaterial;
    if (material.map !== drawn.texture) {
      material.map = drawn.texture;
      material.needsUpdate = true;
    }
    bubble.scale.set(BUBBLE_HEIGHT * drawn.aspect, BUBBLE_HEIGHT, 1);
    bubble.position.set(0, BUBBLE_TIP_Y, 0);
    holder.add(bubble);
  }

  private ensureBubble(): Sprite {
    if (this.bubble) return this.bubble;
    const material = new SpriteMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const bubble = new Sprite(material);
    bubble.center.set(0.5, 0);
    bubble.raycast = () => {};
    bubble.renderOrder = 12;
    this.bubble = bubble;
    this.bubbleMaterial = material;
    return bubble;
  }

  private bubbleArt(name: string): ComicBubble {
    const cached = this.bubbleTextures.get(name);
    if (cached) return cached;
    const drawn = drawComicBubble(name);
    this.bubbleTextures.set(name, drawn);
    return drawn;
  }

  private add(index: number): void {
    const source = this.prototype ?? (this.prototype = createBombCharacter());
    const holder = new Group();
    holder.userData.phase = index;
    holder.add(source.figure.clone(true), source.glow.clone(true));
    holder.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.name === 'bomb-glow' || mesh.name === 'bomb-flame' || mesh.name === 'bomb-spark') mesh.raycast = () => {};
    });
    const place = placeSpectator(index);
    holder.position.set(place.x, BOMB_STAND_Y, place.z);
    holder.rotation.y = -Math.PI / 2 + sway(index);
    this.group.add(holder);
    this.holders.push(holder);
  }
}

function named(holder: Group, name: string): Mesh | null {
  const node = holder.getObjectByName(name);
  return node instanceof Mesh ? node : null;
}

function placeSpectator(index: number): { x: number; z: number } {
  const row = Math.floor(index / PER_ROW);
  const col = index % PER_ROW;
  const shifted = squareToWorld(0, col).z + (row % 2 ? 0.35 : 0);
  const z = Math.min(edgeZ(PITCH_ROWS) - 0.45, Math.max(edgeZ(0) + 0.45, shifted));
  return { x: edgeX(PITCH_COLUMNS) + 0.65 + row * 0.8, z };
}

function sway(index: number): number {
  const n = Math.sin(index * 12.9898) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 0.35;
}

interface ComicBubble {
  texture: CanvasTexture;
  aspect: number;
}

const BUBBLE_FONT = '700 46px "Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive';

/** Ovale blanc, contour encré, queue vers la figurine. */
function drawComicBubble(name: string): ComicBubble {
  const probe = document.createElement('canvas').getContext('2d');
  let textWidth = name.length * 26;
  if (probe) {
    probe.font = BUBBLE_FONT;
    textWidth = Math.ceil(probe.measureText(name).width);
  }
  const padX = 36;
  const bodyH = 78;
  const tailH = 28;
  const tailW = 16;
  const line = 8;
  const width = Math.max(148, textWidth + padX * 2);
  const height = bodyH + tailH + line;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (context) {
    context.scale(scale, scale);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    balloonPath(context, line / 2, line / 2, width - line, bodyH - line / 2, 28, tailW, tailH);
    context.fillStyle = '#fffdf6';
    context.fill();
    context.lineWidth = line;
    context.strokeStyle = '#161616';
    context.stroke();
    context.font = BUBBLE_FONT;
    context.fillStyle = '#161616';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, width / 2, bodyH * 0.48);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}

function balloonPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  bottom: number,
  radius: number,
  tailW: number,
  tailH: number,
): void {
  const right = x + width;
  const center = x + width / 2;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(center + tailW, bottom);
  context.lineTo(center, bottom + tailH);
  context.lineTo(center - tailW, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
