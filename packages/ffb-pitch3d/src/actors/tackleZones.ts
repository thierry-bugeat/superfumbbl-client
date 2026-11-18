import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { latchedOpponentIsHome } from './actingSide';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three';
import { PITCH_COLUMNS, PITCH_ROWS, squareToWorld } from '../coords';

const BASE_STANDING = 0x01;
const BASE_MOVING = 0x02;
const BASE_BLOCKED = 0x0c;
const FLAG_CONFUSED = 0x200;
const FLAG_HYPNOTIZED = 0x800;

const TILE_Y = 0.05;
const LABEL_Y = TILE_Y + 0.012;

/** Cases marquées par au moins une zone de tacle, teintées comme l'overlay FoulBall. */
export class TackleZones {
  private readonly group = new Group();
  private readonly tiles = new Map<string, Mesh>();
  private readonly labels = new Map<string, Mesh>();
  private readonly tileGeometry = new PlaneGeometry(0.86, 0.86);
  private readonly labelGeometry = new PlaneGeometry(0.46, 0.46);
  private readonly textures = new Map<number, CanvasTexture>();
  /** Même retenue que les socles : homePlaying clignote pendant betweenTurns. */
  private actingSide: boolean | null = null;
  private actingGameId: number | null = null;

  constructor(scene: Scene) {
    this.group.visible = false;
    this.tileGeometry.rotateX(-Math.PI / 2);
    this.labelGeometry.rotateX(-Math.PI / 2);
    scene.add(this.group);
  }

  setVisible(enabled: boolean): void {
    this.group.visible = enabled;
  }

  sync(game: GameJson): void {
    const noted = latchedOpponentIsHome(game, this.actingSide, this.actingGameId);
    this.actingSide = noted.side;
    this.actingGameId = noted.gameId;
    const counts = tackleZoneCounts(game, noted.opponentIsHome);
    const seen = new Set<string>();
    for (const [key, count] of counts) {
      seen.add(key);
      const [x, y] = key.split(',').map(Number) as [number, number];
      const world = squareToWorld(x, y);
      const tile = this.tileAt(key, world.x, world.z);
      (tile.material as MeshBasicMaterial).color.set(tileColor(count));
      const label = this.labelAt(key, world.x, world.z);
      const material = label.material as MeshBasicMaterial;
      material.map = this.countTexture(count);
      material.needsUpdate = true;
    }
    for (const key of this.tiles.keys()) {
      if (seen.has(key)) continue;
      this.drop(key);
    }
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) this.drop(key);
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.tileGeometry.dispose();
    this.labelGeometry.dispose();
    this.group.removeFromParent();
  }

  private tileAt(key: string, x: number, z: number): Mesh {
    const existing = this.tiles.get(key);
    if (existing) return existing;
    const mesh = new Mesh(this.tileGeometry, new MeshBasicMaterial({
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      toneMapped: false,
    }));
    mesh.position.set(x, TILE_Y, z);
    mesh.raycast = () => {};
    this.group.add(mesh);
    this.tiles.set(key, mesh);
    return mesh;
  }

  private labelAt(key: string, x: number, z: number): Mesh {
    const existing = this.labels.get(key);
    if (existing) return existing;
    const mesh = new Mesh(this.labelGeometry, new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }));
    mesh.frustumCulled = false;
    // Au-dessus des teintes, qui n'écrivent pas la profondeur, mais masqué par les objets qui l'écrivent.
    mesh.renderOrder = 1;
    // Quart de tour horaire : le haut du chiffre pointe vers le haut de l'écran, dans le coin bas-droit.
    mesh.rotation.y = -Math.PI / 2;
    mesh.position.set(x - 0.28, LABEL_Y, z - 0.28);
    mesh.raycast = () => {};
    this.group.add(mesh);
    this.labels.set(key, mesh);
    return mesh;
  }

  private drop(key: string): void {
    const tile = this.tiles.get(key);
    tile?.removeFromParent();
    (tile?.material as MeshBasicMaterial | undefined)?.dispose();
    this.tiles.delete(key);
    const label = this.labels.get(key);
    label?.removeFromParent();
    (label?.material as MeshBasicMaterial | undefined)?.dispose();
    this.labels.delete(key);
  }

  private countTexture(count: number): CanvasTexture {
    const cached = this.textures.get(count);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 128, 128);
      context.font = 'bold 96px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 12;
      context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      context.strokeText(String(count), 64, 68);
      context.fillStyle = '#ffffff';
      context.fillText(String(count), 64, 68);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.set(count, texture);
    return texture;
  }
}

/** 1 jaune, 2 orange, 3 et plus rouge — mêmes teintes que l'overlay de déplacement FoulBall. */
function tileColor(count: number): number {
  if (count >= 3) return 0xe53935;
  if (count === 2) return 0xfb8c00;
  return 0xffd600;
}

/**
 * Cases du terrain → nombre de joueurs adverses adjacents qui exercent une zone
 * de tacle (debout, en mouvement ou en train de bloquer, ni confus ni hypnotisé).
 * `opponentIsHome` est le côté retenu, pas le homePlaying brut de la commande.
 * Les coéquipiers ne comptent pas.
 */
export function tackleZoneCounts(game: GameJson, opponentIsHome: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  const homeIds = new Set((game.teamHome?.playerArray ?? []).map((player) => String(player.playerId)));
  for (const data of game.fieldModel?.playerDataArray ?? []) {
    const state = Number(data.playerState) || 0;
    if (!exertsTackleZone(state)) continue;
    if (homeIds.has(String(data.playerId)) !== opponentIsHome) continue;
    const coordinate = data.playerCoordinate;
    if (!coordinate) continue;
    const [px, py] = coordinate;
    if (!onPitch(px, py)) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const x = px + dx;
        const y = py + dy;
        if (!onPitch(x, y)) continue;
        const key = `${x},${y}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function exertsTackleZone(state: number): boolean {
  const base = state & 0xff;
  if (base !== BASE_STANDING && base !== BASE_MOVING && base !== BASE_BLOCKED) return false;
  if ((state & FLAG_CONFUSED) !== 0 || (state & FLAG_HYPNOTIZED) !== 0) return false;
  return true;
}

function onPitch(x: number, y: number): boolean {
  return x >= 0 && x < PITCH_COLUMNS && y >= 0 && y < PITCH_ROWS;
}
