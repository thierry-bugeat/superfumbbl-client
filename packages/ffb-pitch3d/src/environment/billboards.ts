/**
 * Pancartes le long des deux touches : planches clouées sur deux poteaux tordus,
 * avec une affiche par-dessus. Les visuels viennent de pancartes-publicitaires.png.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  BoxGeometry,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS } from '../coords';

/** Pitch : 26 colonnes, 15 rangées.
 *                                        "z" = 7.5
 *                                        ^
 *                                        │
 * "x" = -13 <--┌────────────+────────────┐--> "x" = 13
 *              │            │            │
 *              │            │            │
 *    Caméra => │ Home     (0,0)     Away │
 *              │            │            │
 *              │            │            │
 * "x" = -13 <--└────────────+────────────┘--> "x" = 13
 *                                        │
 *                                        v
 *                                        "z" = -7.5
 */
/** Bords du terrain (26×15, TILE_SIZE=1), centrés sur l'origine. */
const PITCH_X0 = edgeX(0);              // -13  embut home
const PITCH_X1 = edgeX(PITCH_COLUMNS);  //  13  embut away
const PITCH_Z0 = edgeZ(0);              // -7.5 touche home
const PITCH_Z1 = edgeZ(PITCH_ROWS);     //  7.5 touche away
/** Recul hors ligne pour planter une pancarte. */
const SETBACK = 1.55;
const SIDELINE_Z0 = PITCH_Z0 - SETBACK; // -9.05
const SIDELINE_Z1 = PITCH_Z1 + SETBACK; //  9.05
const ENDZONE_X0 = PITCH_X0 - SETBACK;  // -14.55
const ENDZONE_X1 = PITCH_X1 + SETBACK;  //  14.55

const POST_H = 2.05;
const PLANK_W = 2.55;
const PLANK_T = 0.2;
const PLANK_D = 0.05;
const PLANK_Y = [0.42, 0.68, 0.94, 1.2];
const POSTER_H = 1.2;

// rotationY : angle de rotation autour de l'axe vertical
//       0.0    (XX°) : La pancarte est dans la longueur de la touche face au terrain.
//       -0.785 (45°) :
//       -1.571 (90°) : La pancarte est face à la caméra, face à l'embut "Home"
//       -3.142 (180°):
//       -4.712 (270°):
//       Rotation vers la droite si positif, vers la gauche si négatif
// tilt : angle de rotation autour de l'axe horizontal
// x, z : position monde — SIDELINE_Z0/Z1 (touches), ENDZONE_X0/X1 (embuts)
// url : url de l'image
const POSTERS: { url: string; x: number; z: number; tilt: number; rotationY: number }[] = [
  { url: new URL('../../assets/environment/billboards/bugmans.png', import.meta.url).href, x: -12, z: SIDELINE_Z0, tilt: -0.03, rotationY: -0.1 },
  { url: new URL('../../assets/environment/billboards/foulbowl.png', import.meta.url).href, x: -6.6, z: SIDELINE_Z0, tilt: 0.025, rotationY: -0.78 },
  { url: new URL('../../assets/environment/billboards/goblin.png', import.meta.url).href, x: -1, z: SIDELINE_Z0, tilt: -0.02, rotationY: -0.78 },
  { url: new URL('../../assets/environment/billboards/chaos.png', import.meta.url).href, x: 7.4, z: SIDELINE_Z0, tilt: 0.03, rotationY: -0.78 },
  { url: new URL('../../assets/environment/billboards/skaven.png', import.meta.url).href, x: 11.6, z: SIDELINE_Z0, tilt: -0.015, rotationY: -0.78 },
  { url: new URL('../../assets/environment/billboards/orcish.png', import.meta.url).href, x: -10.6, z: SIDELINE_Z1, tilt: 0.02, rotationY: Math.PI + 0.78 },
  { url: new URL('../../assets/environment/billboards/undead.png', import.meta.url).href, x: -4.4, z: SIDELINE_Z1, tilt: -0.028, rotationY: Math.PI + 0.78 },
  { url: new URL('../../assets/environment/billboards/dwarf.png', import.meta.url).href, x: 1.6, z: SIDELINE_Z1, tilt: 0.018, rotationY: Math.PI + 0.78 },
  { url: new URL('../../assets/environment/billboards/nurgle.png', import.meta.url).href, x: 8, z: SIDELINE_Z1, tilt: -0.022, rotationY: Math.PI + 0.78 },
];

/** Affiches de touche, face au terrain. */
export class PitchBillboards {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly textures: Texture[] = [];

  async load(anisotropy = 8): Promise<void> {
    const wood = woodGeometry();
    const nails = nailGeometry();
    this.geometries.push(wood, nails);
    const woodMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02, vertexColors: true });
    const nailMat = new MeshStandardMaterial({ color: 0x2a241c, roughness: 0.45, metalness: 0.72 });
    this.materials.push(woodMat, nailMat);

    const loader = new TextureLoader();
    await Promise.all(POSTERS.map(async (poster) => {
      const texture = await loader.loadAsync(poster.url);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = anisotropy;
      this.textures.push(texture);
      const image = texture.image as { width: number; height: number };
      const aspect = image.width / Math.max(image.height, 1);
      let posterH = POSTER_H;
      let posterW = posterH * aspect;
      if (posterW > 2.02) {
        posterW = 2.02;
        posterH = posterW / aspect;
      }
      const material = new MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0,
        transparent: true,
        alphaTest: 0.25,
        side: FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(material);

      const board = new Group();
      const planks = new Mesh(wood, woodMat);
      planks.castShadow = true;
      planks.receiveShadow = true;
      const pegs = new Mesh(nails, nailMat);
      pegs.castShadow = true;
      const sheet = new Mesh(new PlaneGeometry(posterW, posterH), material);
      sheet.position.set(0, 0.86, 0.062);
      sheet.receiveShadow = true;
      this.geometries.push(sheet.geometry);
      board.add(planks, pegs, sheet);

      board.position.set(poster.x, 0, poster.z);
      board.rotation.y = poster.rotationY;
      board.rotation.z = poster.tilt;
      board.rotation.x = -0.05;
      this.group.add(board);
    }));
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>();
    this.group.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) geometries.add(mesh.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.group.clear();
  }
}

function woodGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(tint(twistedPost(0.11, 3.4), 0x6a4328));
  parts.push(tint(twistedPost(-0.09, -3.1), 0x5c3a22));
  parts[0]!.applyMatrix4(new Matrix4().makeTranslation(-1.46, 0, -0.01));
  parts[1]!.applyMatrix4(new Matrix4().makeTranslation(1.46, 0, -0.01));
  const plankColors = [0x8d5e34, 0x7a512c, 0x96663a, 0x6f4a29];
  PLANK_Y.forEach((y, index) => {
    const plank = new BoxGeometry(PLANK_W, PLANK_T, PLANK_D);
    plank.translate((index % 2 === 0 ? -0.02 : 0.025), y, 0.02);
    parts.push(tint(plank, plankColors[index]!));
  });
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('planches de pancarte');
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function nailGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const y of PLANK_Y) {
    for (const x of [-1.16, 1.16]) {
      const nail = new CylinderGeometry(0.034, 0.04, 0.04, 6);
      nail.rotateX(Math.PI / 2);
      nail.translate(x, y, 0.052);
      parts.push(nail);
    }
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('clous de pancarte');
  for (const part of parts) part.dispose();
  return merged;
}

/** Poteau à six pans, vrillé et un peu cintré. La base est en y = 0. */
function twistedPost(bend: number, twist: number): BufferGeometry {
  const geo = new CylinderGeometry(0.07, 0.1, POST_H, 6, 10, false);
  const pos = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const along = y / POST_H + 0.5;
    const angle = twist * along;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const bow = Math.sin(along * Math.PI) * bend;
    pos.setXYZ(i, x * c - z * s + bow, y, x * s + z * c);
  }
  geo.computeVertexNormals();
  geo.translate(0, POST_H / 2, 0);
  return geo;
}

function tint(geo: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const shade = 0.92 + ((i * 13) % 5) * 0.02;
    colors[i * 3] = Math.min(1, color.r * shade);
    colors[i * 3 + 1] = Math.min(1, color.g * shade);
    colors[i * 3 + 2] = Math.min(1, color.b * shade);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}
