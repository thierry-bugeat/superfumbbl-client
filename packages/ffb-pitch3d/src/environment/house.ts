import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { edgeX, PITCH_COLUMNS } from '../coords';

const MODEL_URL = new URL('../../assets/environment/forest-house.glb', import.meta.url).href;
const HOUSE_HEIGHT = 4;

/** Maison de SpikeBowl, derrière l'en-but extérieur, le bas au niveau du gazon. */
export class PitchHouse {
  readonly group = new Group();

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const scene = gltf.scene;
    scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const house = scene.getObjectByName('House_House_0') ?? scene;
    scene.updateMatrixWorld(true);
    const rawHeight = new Box3().setFromObject(house, true).getSize(new Vector3()).y;
    scene.scale.setScalar(HOUSE_HEIGHT / Math.max(rawHeight, 0.001));
    scene.rotation.y = -Math.PI / 2;

    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene, true);
    const houseBounds = new Box3().setFromObject(house, true);
    const houseCenter = houseBounds.getCenter(new Vector3());
    const floorY = floorBottom(scene) ?? bounds.min.y;
    const clearing = clearingBounds(scene) ?? houseBounds;
    scene.position.set(
      edgeX(PITCH_COLUMNS) + 0.4 - clearing.min.x - 2.5,
      -floorY,
      -houseCenter.z + 10,
    );
    keepPastEndZone(scene);
    this.group.add(scene);
  }

  dispose(): void {
    this.group.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.group.clear();
  }
}

/** Les rochers éloignés traversent le terrain après la rotation. On les range derrière la maison. */
function keepPastEndZone(scene: Group): void {
  const limit = edgeX(PITCH_COLUMNS) + 0.4;
  scene.updateMatrixWorld(true);
  const clearing = clearingBounds(scene);
  const behind = (clearing?.max.x ?? limit) + 0.6;
  for (const child of scene.children) {
    if (CLEARING.includes(child.name)) continue;
    const box = new Box3().setFromObject(child, true);
    if (box.isEmpty() || box.min.x >= limit) continue;
    const parent = child.parent;
    if (!parent) continue;
    const origin = child.getWorldPosition(new Vector3());
    const target = origin.clone();
    target.x += behind - box.min.x;
    child.position.copy(parent.worldToLocal(target));
  }
}

/** Le point le plus bas du modèle est une pointe de rocher. Le sol visible, lui, est le terre-plein. */
function floorBottom(scene: Group): number | null {
  let bottom: number | null = null;
  for (const name of ['Ground_Ground_0', 'Grass.Ground_GrassALPHA_0']) {
    const part = scene.getObjectByName(name);
    if (!part) continue;
    const y = new Box3().setFromObject(part, true).min.y;
    bottom = bottom === null ? y : Math.min(bottom, y);
  }
  return bottom;
}

/** Maison, terre-plein, arbres et clôture. Les gros rochers isolés n'en font pas partie. */
const CLEARING = [
  'Ground_Ground_0',
  'Grass.Ground_GrassALPHA_0',
  'House_House_0',
  'Chimney_RoofMoss_0',
  'SupportBeams_Window_0',
  'HouseFence_WoodPlanks_0',
  'FenceLeft_WoodFence_0',
  'BTree_BrichTree_0',
  'RedwoodAlpha_TreeLeafs_0',
  'Rocks_BigRock_0',
  'RockPath_Round_Small_1',
];

function clearingBounds(scene: Group): Box3 | null {
  const box = new Box3();
  let found = false;
  for (const name of CLEARING) {
    const part = scene.getObjectByName(name);
    if (!part) continue;
    box.union(new Box3().setFromObject(part, true));
    found = true;
  }
  return found ? box : null;
}
