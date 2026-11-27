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

const CELL_WIDTH = 300;
const CELL_HEIGHT = 400;
const COLUMNS = 11;
const ROWS = 2;
/** Largeur monde d'une case pleine : suit le passage 250 → 300. */
const PLATE_WIDTH = 0.9 * (300 / 250);
const PLATE_HEIGHT = 1.45;

const RACES: Record<string, { url: string; slots: Slot[] }> = {
  human: {
    url: new URL('../../assets/figurines/humans.png', import.meta.url).href,
    slots: [
      { match: 'lineman', column: 0, trim: [117, 48, 0, 39] },
      { match: 'halfling', column: 1, trim: [176, 43, 0, 38] },
      { match: 'catcher', column: 2, trim: [125, 30, 0, 22] },
      { match: 'thrower', column: 3, trim: [114, 44, 0, 38] },
      { match: 'blitzer', column: 4, trim: [85, 34, 0, 33] },
      { match: 'ogre', column: 5, trim: [56, 0, 0, 0] },
    ],
  },
  orc: {
    url: new URL('../../assets/figurines/orcs.png', import.meta.url).href,
    slots: [
      { match: 'troll', column: 0, trim: [67, 24, 0, 25] },
      { match: 'blitzer', column: 1, trim: [117, 29, 0, 29] },
      { match: 'thrower', column: 2, trim: [98, 72, 0, 67] },
      { match: 'lineman', column: 3, trim: [97, 60, 0, 66] },
      { match: 'goblin', column: 4, trim: [196, 73, 0, 67] },
      { match: 'bigun', column: 5, trim: [94, 25, 0, 24] },
    ],
  },
  amazon: {
    url: new URL('../../assets/figurines/amazons.png', import.meta.url).href,
    slots: [
      { match: 'jaguar', column: 0, trim: [76, 25, 0, 23] },
      { match: 'piranha', column: 1, trim: [98, 36, 0, 37] },
      { match: 'python', column: 2, trim: [113, 38, 0, 33] },
      { match: 'eagle', column: 3, trim: [93, 66, 0, 49] },
    ],
  },
  ogre: {
    url: new URL('../../assets/figurines/ogres.png', import.meta.url).href,
    slots: [
      { match: 'gnoblar', column: 0, trim: [255, 100, 0, 101] },
      { match: 'ogre', column: 1, trim: [93, 26, 0, 23] },
      { match: 'punter', column: 2, trim: [90, 28, 0, 22] },
    ],
  },
  lizardmen: {
    url: new URL('../../assets/figurines/lizardmen.png', import.meta.url).href,
    slots: [
      { match: 'skink', column: 0, trim: [199, 57, 0, 60] },
      { match: 'chameleon', column: 1, trim: [199, 43, 0, 50] },
      { match: 'saurus', column: 2, trim: [107, 11, 0, 11] },
      { match: 'kroxigor', column: 3, trim: [58, 0, 0, 1] },
    ],
  },
  norse: {
    url: new URL('../../assets/figurines/norses.png', import.meta.url).href,
    slots: [
      { match: 'yhetee', column: 0, trim: [84, 8, 0, 6] },
      { match: 'boar', column: 1, trim: [172, 27, 0, 25] },
      { match: 'raider', column: 2, trim: [112, 33, 0, 35] },
      { match: 'ulf', column: 3, trim: [90, 13, 0, 5] },
      { match: 'valkyrie', column: 4, trim: [106, 58, 0, 59] },
      { match: 'berserker', column: 5, trim: [108, 17, 0, 14] },
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

/** Humain, orc, amazone, ogre, lizardmen, norse. Les autres races n'ont pas encore d'atlas illustré. */
export function atlasRace(race: string): string {
  const key = race.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('amazon')) return 'amazon';
  if (key.includes('lizard')) return 'lizardmen';
  if (key.includes('norse')) return 'norse';
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
