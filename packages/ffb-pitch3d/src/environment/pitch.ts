import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { PITCH_COLUMNS, PITCH_ROWS, TILE_SIZE, edgeX, edgeZ } from '../coords';

/**
 * Marquage FFB par-dessus le sol texturé.
 * Lignes blanches, zones d'en-but teintées (colonnes 0 et 25).
 */
export function createPitchMarkings(): Group {
  const group = new Group();
  const line = new MeshBasicMaterial({ color: 0xf4f7f2 });
  const endZone = new MeshBasicMaterial({ color: 0xc8a24a, transparent: true, opacity: 0.28, depthWrite: false });
  const depth = PITCH_ROWS * TILE_SIZE;
  const width = PITCH_COLUMNS * TILE_SIZE;
  const x0 = edgeX(0);
  const z0 = edgeZ(0);

  addRect(group, x0, z0, TILE_SIZE, depth, 0.01, endZone);
  addRect(group, edgeX(PITCH_COLUMNS - 1), z0, TILE_SIZE, depth, 0.01, endZone);

  const y = 0.03;
  const t = 0.06;
  addRect(group, x0, z0 - t / 2, width, t, y, line);
  addRect(group, x0, edgeZ(PITCH_ROWS) - t / 2, width, t, y, line);
  addRect(group, x0 - t / 2, z0, t, depth, y, line);
  addRect(group, edgeX(PITCH_COLUMNS) - t / 2, z0, t, depth, y, line);
  for (const boundary of [1, 12, 13, 14, 25]) {
    addRect(group, edgeX(boundary) - t / 2, z0, t, depth, y, line);
  }
  for (const boundary of [4, 11]) {
    addRect(group, x0, edgeZ(boundary) - t / 2, width, t, y, line);
  }
  return group;
}

function addRect(
  group: Group,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  y: number,
  material: MeshBasicMaterial,
): void {
  const mesh = new Mesh(new BoxGeometry(sizeX, 0.012, sizeZ), material);
  mesh.position.set(x + sizeX / 2, y, z + sizeZ / 2);
  mesh.receiveShadow = true;
  group.add(mesh);
}
