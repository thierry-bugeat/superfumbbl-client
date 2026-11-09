/** Terrain FFB : 26 colonnes (x 0..25) par 15 rangées (y 0..14), centré sur l'origine. */

export const PITCH_COLUMNS = 26;
export const PITCH_ROWS = 15;
export const TILE_SIZE = 1;

const CENTER_X = (PITCH_COLUMNS - 1) / 2;
const CENTER_Y = (PITCH_ROWS - 1) / 2;

export interface WorldPoint {
  x: number;
  z: number;
}

/** Centre de la case (x, y) en coordonnées monde. Le terrain est dans le plan xz. */
export function squareToWorld(x: number, y: number, tileSize = TILE_SIZE): WorldPoint {
  return { x: (x - CENTER_X) * tileSize, z: (y - CENTER_Y) * tileSize };
}

/** Case dont le centre est le plus proche du point monde. N'arrondit pas hors terrain. */
export function worldToSquare(x: number, z: number, tileSize = TILE_SIZE): { x: number; y: number } {
  return {
    x: Math.round(x / tileSize + CENTER_X),
    y: Math.round(z / tileSize + CENTER_Y),
  };
}

/** Bord gauche (index 0) ou droit du terrain, en monde. `boundary` 0..26. */
export function edgeX(boundary: number, tileSize = TILE_SIZE): number {
  return (boundary - PITCH_COLUMNS / 2) * tileSize;
}

/** Bord haut (index 0) ou bas du terrain, en monde. `boundary` 0..15. */
export function edgeZ(boundary: number, tileSize = TILE_SIZE): number {
  return (boundary - PITCH_ROWS / 2) * tileSize;
}
