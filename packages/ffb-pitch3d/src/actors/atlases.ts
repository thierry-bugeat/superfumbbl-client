import { ClampToEdgeWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

export type PlateSide = 'front' | 'back';

export interface PlateRect {
  texture: Texture;
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface Slot {
  /** Motif cherché dans le nom de poste FFB, du plus spécifique au plus général. */
  match: string;
  column: number;
  /** [haut, droite, bas, gauche] en pixels de la case d'atlas. */
  trim: [number, number, number, number];
}

interface RaceAtlas {
  texture: Texture;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  slots: Slot[];
}

const CELL_WIDTH = 250;
const CELL_HEIGHT = 400;
const COLUMNS = 11;
const ROWS = 2;
const PLATE_WIDTH = 0.9;
const PLATE_HEIGHT = 1.45;

const RACES: Record<string, { url: string; slots: Slot[] }> = {
  human: {
    url: new URL('../../assets/figurines/humans.png', import.meta.url).href,
    slots: [
      { match: 'ogre', column: 5, trim: [60, 0, 0, 0] },
      { match: 'blitzer', column: 4, trim: [85, 10, 0, 10] },
      { match: 'thrower', column: 3, trim: [110, 20, 0, 15] },
      { match: 'catcher', column: 2, trim: [115, 0, 0, 0] },
      { match: 'halfling', column: 1, trim: [180, 20, 0, 10] },
      { match: 'lineman', column: 0, trim: [115, 20, 0, 15] },
    ],
  },
  orc: {
    url: new URL('../../assets/figurines/orcs.png', import.meta.url).href,
    slots: [
      { match: 'troll', column: 0, trim: [68, 0, 0, 0] },
      { match: 'bigun', column: 5, trim: [94, 0, 0, 0] },
      { match: 'blocker', column: 5, trim: [94, 0, 0, 0] },
      { match: 'blitzer', column: 1, trim: [110, 5, 0, 5] },
      { match: 'thrower', column: 2, trim: [100, 43, 0, 47] },
      { match: 'goblin', column: 4, trim: [191, 45, 0, 47] },
      { match: 'lineman', column: 3, trim: [99, 35, 0, 42] },
    ],
  },
  amazon: {
    url: new URL('../../assets/figurines/amazons.png', import.meta.url).href,
    slots: [
      { match: 'python', column: 2, trim: [114, 11, 0, 13] },
      { match: 'thrower', column: 2, trim: [114, 11, 0, 13] },
      { match: 'piranha', column: 1, trim: [69, 14, 0, 4] },
      { match: 'blitzer', column: 1, trim: [69, 14, 0, 4] },
      { match: 'jaguar', column: 0, trim: [76, 0, 0, 0] },
      { match: 'blocker', column: 0, trim: [76, 0, 0, 0] },
      { match: 'eagle', column: 3, trim: [94, 34, 0, 34] },
      { match: 'lineman', column: 3, trim: [94, 34, 0, 34] },
    ],
  },
  ogre: {
    url: new URL('../../assets/figurines/ogres.png', import.meta.url).href,
    slots: [
      { match: 'gnoblar', column: 0, trim: [256, 85, 0, 64] },
      { match: 'lineman', column: 0, trim: [256, 85, 0, 64] },
      { match: 'punter', column: 2, trim: [86, 0, 0, 0] },
      { match: 'blocker', column: 1, trim: [91, 0, 0, 0] },
      { match: 'ogre', column: 1, trim: [91, 0, 0, 0] },
    ],
  },
};

const loaded = new Map<string, RaceAtlas>();

export async function loadAtlases(maxAnisotropy: number): Promise<void> {
  const loader = new TextureLoader();
  await Promise.all(Object.entries(RACES).map(async ([race, spec]) => {
    const texture = await loader.loadAsync(spec.url);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    loaded.set(race, {
      texture,
      columns: COLUMNS,
      rows: ROWS,
      cellWidth: CELL_WIDTH,
      cellHeight: CELL_HEIGHT,
      slots: spec.slots,
    });
  }));
}

export function disposeAtlases(): void {
  for (const atlas of loaded.values()) atlas.texture.dispose();
  loaded.clear();
}

/** Humain, orc, amazone, ogre. Les autres races n'ont pas encore d'atlas illustré. */
export function atlasRace(race: string): string {
  const key = race.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('amazon')) return 'amazon';
  if (key.includes('ogre')) return 'ogre';
  if (key.includes('human')) return 'human';
  if (key.includes('orc')) return 'orc';
  return '';
}

/** Découpe du portrait (face) dans l'atlas, pour la carte joueur. */
export function portraitCrop(race: string, positionName: string): { url: string; sx: number; sy: number; sw: number; sh: number } | null {
  const spec = RACES[atlasRace(race)];
  if (!spec) return null;
  const name = positionName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slot = spec.slots.find((entry) => name.includes(entry.match)) ?? spec.slots[spec.slots.length - 1];
  if (!slot) return null;
  const [top, right, bottom, left] = slot.trim;
  return {
    url: spec.url,
    sx: slot.column * CELL_WIDTH + left,
    sy: top,
    sw: Math.max(1, CELL_WIDTH - left - right),
    sh: Math.max(1, CELL_HEIGHT - top - bottom),
  };
}

export function plateRect(race: string, positionName: string, side: PlateSide): PlateRect | null {
  const atlas = loaded.get(atlasRace(race));
  if (!atlas) return null;
  const name = positionName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slot = atlas.slots.find((entry) => name.includes(entry.match)) ?? atlas.slots[atlas.slots.length - 1];
  if (!slot) return null;
  const [top, right, bottom, left] = slot.trim;
  const insets = {
    top: top / atlas.cellHeight,
    right: right / atlas.cellWidth,
    bottom: bottom / atlas.cellHeight,
    left: left / atlas.cellWidth,
  };
  const row = side === 'back' ? 1 : 0;
  const cellX = 1 / atlas.columns;
  const cellY = 1 / atlas.rows;
  const widthFrac = Math.max(0.05, 1 - insets.left - insets.right);
  const heightFrac = Math.max(0.05, 1 - insets.top - insets.bottom);
  return {
    texture: atlas.texture,
    repeatX: cellX * widthFrac,
    repeatY: cellY * heightFrac,
    offsetX: slot.column * cellX + cellX * insets.left,
    offsetY: 1 - (row + 1) * cellY + cellY * insets.bottom,
    width: PLATE_WIDTH * widthFrac,
    height: PLATE_HEIGHT * heightFrac,
  };
}
