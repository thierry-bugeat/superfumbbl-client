/**
 * Lisière autour du terrain, extraite du Stylized Nature MegaKit de Quaternius (CC0).
 * Les modèles d'automne et les falaises des aperçus ne sont pas dans la version standard.
 */
import { Box3, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS } from '../coords';

const MODEL_URL = new URL('../../assets/environment/nature-kit.glb', import.meta.url).href;

const LIMIT_X = edgeX(PITCH_COLUMNS);
const LIMIT_Z = edgeZ(PITCH_ROWS);
/** Tronc de l'arbre fluffy, pour ne pas le traverser. */
const FLUFFY = { x: -3, z: edgeZ(0) - 3.2, radius: 4.2 };

type Fit = 'height' | 'width';
type Kind = 'tree' | 'bush' | 'rock' | 'detail';

interface ModelSpec {
  fit: Fit;
  size: number;
  kind: Kind;
}

interface Scatter {
  names: string[];
  count: number;
  minOut: number;
  maxOut: number;
  minSep: number;
  /** Tronc : tient ses distances avec les arbres déjà posés. */
  tree?: boolean;
  /** Distance minimale aux troncs, pour les buissons et les rochers. */
  trunkClear?: number;
  /** > 1 rapproche les plants du terrain. */
  bias?: number;
  /** Colle une partie des plants au pied des arbres déjà posés. */
  nearTrees?: boolean;
}

const MODELS: Record<string, ModelSpec> = {
  CommonTree_1: { fit: 'height', size: 5.4, kind: 'tree' },
  CommonTree_2: { fit: 'height', size: 5.2, kind: 'tree' },
  CommonTree_3: { fit: 'height', size: 4.8, kind: 'tree' },
  CommonTree_4: { fit: 'height', size: 5.6, kind: 'tree' },
  Pine_1: { fit: 'height', size: 6.4, kind: 'tree' },
  Pine_2: { fit: 'height', size: 6.0, kind: 'tree' },
  Pine_5: { fit: 'height', size: 7.0, kind: 'tree' },
  TwistedTree_1: { fit: 'height', size: 5.8, kind: 'tree' },
  TwistedTree_2: { fit: 'height', size: 5.4, kind: 'tree' },
  DeadTree_1: { fit: 'height', size: 4.6, kind: 'tree' },
  DeadTree_3: { fit: 'height', size: 4.2, kind: 'tree' },
  Bush_Common: { fit: 'height', size: 1.15, kind: 'bush' },
  Bush_Common_Flowers: { fit: 'height', size: 1.15, kind: 'bush' },
  Fern_1: { fit: 'width', size: 2.3, kind: 'bush' },
  Plant_1: { fit: 'height', size: 0.7, kind: 'bush' },
  Plant_1_Big: { fit: 'height', size: 1.5, kind: 'bush' },
  Plant_7: { fit: 'width', size: 0.9, kind: 'detail' },
  Flower_3_Group: { fit: 'height', size: 0.72, kind: 'detail' },
  Flower_4_Group: { fit: 'height', size: 0.78, kind: 'detail' },
  Flower_3_Single: { fit: 'height', size: 0.5, kind: 'detail' },
  Clover_1: { fit: 'height', size: 0.38, kind: 'detail' },
  Clover_2: { fit: 'height', size: 0.38, kind: 'detail' },
  Grass_Common_Short: { fit: 'height', size: 0.4, kind: 'detail' },
  Grass_Common_Tall: { fit: 'height', size: 0.62, kind: 'detail' },
  Grass_Wispy_Short: { fit: 'height', size: 0.45, kind: 'detail' },
  Grass_Wispy_Tall: { fit: 'height', size: 0.58, kind: 'detail' },
  Mushroom_Common: { fit: 'height', size: 0.22, kind: 'detail' },
  Mushroom_Laetiporus: { fit: 'height', size: 0.28, kind: 'detail' },
  Petal_1: { fit: 'width', size: 0.32, kind: 'detail' },
  Petal_3: { fit: 'width', size: 0.28, kind: 'detail' },
  Rock_Medium_1: { fit: 'height', size: 1.35, kind: 'rock' },
  Rock_Medium_2: { fit: 'height', size: 1.15, kind: 'rock' },
  Pebble_Round_1: { fit: 'width', size: 0.32, kind: 'detail' },
  Pebble_Round_3: { fit: 'width', size: 0.38, kind: 'detail' },
  Pebble_Square_2: { fit: 'width', size: 0.34, kind: 'detail' },
};

const SCATTER: Scatter[] = [
  { names: ['DeadTree_1', 'DeadTree_3'], count: 2, minOut: 3.4, maxOut: 5.8, minSep: 8, tree: true },
  { names: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4'], count: 26, minOut: 2.2, maxOut: 5.2, minSep: 1.9, tree: true, bias: 2.2 },
  { names: ['Pine_1', 'Pine_2', 'Pine_5'], count: 14, minOut: 2.45, maxOut: 5.6, minSep: 2.1, tree: true, bias: 2 },
  { names: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4'], count: 18, minOut: 4.6, maxOut: 11, minSep: 2.35, tree: true },
  { names: ['Pine_1', 'Pine_2', 'Pine_5'], count: 10, minOut: 5, maxOut: 12, minSep: 2.6, tree: true },
  { names: ['TwistedTree_1', 'TwistedTree_2'], count: 6, minOut: 4.2, maxOut: 11.5, minSep: 3.5, tree: true },
  { names: ['DeadTree_1', 'DeadTree_3'], count: 6, minOut: 3.3, maxOut: 11, minSep: 3.1, tree: true },
  { names: ['Bush_Common', 'Bush_Common_Flowers'], count: 28, minOut: 1, maxOut: 5.4, minSep: 0.95, trunkClear: 1.15, bias: 1.6 },
  { names: ['Fern_1', 'Plant_1_Big', 'Plant_1'], count: 24, minOut: 1.15, maxOut: 4.6, minSep: 0.95, trunkClear: 0.85, bias: 1.6 },
  { names: ['Flower_3_Group', 'Flower_4_Group', 'Flower_3_Single', 'Clover_1', 'Clover_2', 'Plant_7'], count: 64, minOut: 0.4, maxOut: 4.2, minSep: 0.5, bias: 1.4 },
  { names: ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall'], count: 80, minOut: 0.35, maxOut: 5.2, minSep: 0.3, bias: 1.3 },
  { names: ['Mushroom_Common', 'Mushroom_Laetiporus'], count: 36, minOut: 0.7, maxOut: 4.2, minSep: 0.45, nearTrees: true },
  { names: ['Petal_1', 'Petal_3'], count: 16, minOut: 0.35, maxOut: 3.4, minSep: 0.3 },
  { names: ['Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_2'], count: 56, minOut: 0.45, maxOut: 5.2, minSep: 0.28, bias: 1.35 },
  { names: ['Rock_Medium_1', 'Rock_Medium_2'], count: 22, minOut: 1.6, maxOut: 7.5, minSep: 1.5, trunkClear: 1.25, bias: 1.45 },
];

/** Forêt basse autour du terrain : le gazon de jeu reste une clairière. */
export class PitchNature {
  readonly group = new Group();
  private readonly kept: Object3D[] = [];
  private readonly windMaterials: MeshStandardMaterial[] = [];

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const prototypes = new Map<string, Object3D>();
    for (const name of Object.keys(MODELS)) {
      const source = gltf.scene.getObjectByName(name);
      if (!source) continue;
      const height = new Box3().setFromObject(source).max.y;
      source.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (!(material instanceof MeshStandardMaterial) || material.userData.wind) continue;
          if (!isFoliage(material.name)) continue;
          enableWind(material, height);
          this.windMaterials.push(material);
        }
      });
      prototypes.set(name, source);
      this.kept.push(source);
    }

    const rand = mulberry32(0x51a11e);
    const trunks: { x: number; z: number }[] = [];
    for (const scatter of SCATTER) {
      const spots = scatter.nearTrees
        ? around(trunks, scatter, rand)
        : border(scatter, rand, trunks);
      if (scatter.tree) trunks.push(...spots);
      for (const spot of spots) {
        const name = scatter.names[Math.floor(rand() * scatter.names.length)]!;
        const spec = MODELS[name];
        const proto = prototypes.get(name);
        if (!spec || !proto) continue;
        const prop = fit(proto, spec);
        prop.position.x = spot.x;
        prop.position.z = spot.z;
        prop.rotation.y = rand() * Math.PI * 2;
        const jitter = 0.86 + rand() * 0.28;
        prop.scale.multiplyScalar(jitter);
        prop.position.y *= jitter;
        const shadow = spec.kind === 'tree' || spec.kind === 'bush' || spec.kind === 'rock';
        prop.traverse((node) => {
          const mesh = node as Mesh;
          if (mesh.isMesh) mesh.castShadow = shadow;
        });
        this.group.add(prop);
      }
    }
  }

  /** Balancement du feuillage. Les clones partagent ces matériaux. */
  tick(now: number): void {
    const time = now * 0.001;
    for (const material of this.windMaterials) {
      const shaders = material.userData.shaders as WindShader[] | undefined;
      if (!shaders) continue;
      for (const shader of shaders) {
        const uniform = shader.uniforms.uTime;
        if (uniform) uniform.value = time;
      }
    }
  }

  dispose(): void {
    const geometries = new Set<Mesh['geometry']>();
    const materials = new Set<Mesh['material']>();
    for (const root of this.kept) {
      root.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
        else if (material) materials.add(material);
      });
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
    this.kept.length = 0;
    this.windMaterials.length = 0;
    this.group.clear();
  }
}

type WindShader = { uniforms: Record<string, { value: unknown }> };

/** Feuilles et pétales. L'écorce, l'herbe, les champignons et les pierres restent fixes. */
function isFoliage(name: string): boolean {
  return name.startsWith('Leaves') || name.startsWith('Flowers');
}

/**
 * Vent dans l'espace du modèle : le pied reste planté, le haut suit la brise.
 * `height` est celle du modèle entier, pour que la tige et la fleur bougent ensemble.
 */
function enableWind(material: MeshStandardMaterial, height: number): void {
  material.userData.wind = true;
  const compiled: WindShader[] = [];
  material.userData.shaders = compiled;
  material.customProgramCacheKey = () => 'nature-foliage-wind-v1';
  material.onBeforeCompile = (shader) => {
    compiled.push(shader as WindShader);
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uHeight = { value: Math.max(height, 0.001) };
    shader.vertexShader = `
      uniform float uTime;
      uniform float uHeight;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float windAlong = smoothstep(uHeight * 0.22, uHeight, position.y);
      float windPhase = modelMatrix[3].x * 0.45 + modelMatrix[3].z * 0.37;
      float gust = sin(uTime * 1.25 + windPhase);
      float rustle = sin(uTime * 2.7 + windPhase * 1.6 + position.y * 0.65);
      float reach = max(uHeight * 0.06, 0.3);
      float windAmount = (gust * 0.78 + rustle * 0.22) * reach * windAlong;
      transformed.x += windAmount;
      transformed.z += windAmount * 0.42;
      `,
    );
  };
}

function fit(proto: Object3D, spec: ModelSpec): Object3D {
  const box = new Box3().setFromObject(proto);
  const size = box.getSize(new Vector3());
  const span = spec.fit === 'width' ? Math.max(size.x, size.z) : size.y;
  const scale = spec.size / Math.max(span, 0.001);
  const clone = proto.clone(true);
  clone.scale.setScalar(scale);
  clone.position.y = -box.min.y * scale;
  return clone;
}

interface Spot {
  x: number;
  z: number;
}

/** Répartit le long du pourtour, pour que la lisière soit pleine sur les quatre côtés. */
function border(scatter: Scatter, rand: () => number, trunks: Spot[]): Spot[] {
  const spots: Spot[] = [];
  let guard = 0;
  while (spots.length < scatter.count && guard < scatter.count * 80) {
    guard += 1;
    const spot = borderPoint(scatter, rand);
    if (!accept(spot.x, spot.z, scatter, spots, trunks)) continue;
    spots.push(spot);
  }
  return spots;
}

function borderPoint(scatter: Scatter, rand: () => number): Spot {
  const extend = scatter.maxOut;
  const spanX = (LIMIT_X + extend) * 2;
  const spanZ = (LIMIT_Z + extend) * 2;
  const perimeter = 2 * (spanX + spanZ);
  let u = rand() * perimeter;
  const span = scatter.maxOut - scatter.minOut;
  const outward = scatter.minOut + span * (scatter.bias ? rand() ** scatter.bias : rand());
  if (u < spanX) return { x: -LIMIT_X - extend + u, z: -(LIMIT_Z + outward) };
  u -= spanX;
  if (u < spanZ) return { x: LIMIT_X + outward, z: -LIMIT_Z - extend + u };
  u -= spanZ;
  if (u < spanX) return { x: LIMIT_X + extend - u, z: LIMIT_Z + outward };
  u -= spanX;
  return { x: -(LIMIT_X + outward), z: LIMIT_Z + extend - u };
}

/** Champignons et détails au pied des troncs, comme sur les aperçus. */
function around(trunks: Spot[], scatter: Scatter, rand: () => number): Spot[] {
  const spots: Spot[] = [];
  if (trunks.length === 0) return border(scatter, rand, trunks);
  let guard = 0;
  while (spots.length < scatter.count && guard < scatter.count * 40) {
    guard += 1;
    const trunk = trunks[Math.floor(rand() * trunks.length)]!;
    const angle = rand() * Math.PI * 2;
    const distance = 0.7 + rand() * 1.6;
    const x = trunk.x + Math.cos(angle) * distance;
    const z = trunk.z + Math.sin(angle) * distance;
    if (!accept(x, z, scatter, spots, trunks)) continue;
    spots.push({ x, z });
  }
  return spots;
}

function accept(x: number, z: number, scatter: Scatter, spots: Spot[], trunks: Spot[]): boolean {
  const outside = Math.hypot(Math.max(Math.abs(x) - LIMIT_X, 0), Math.max(Math.abs(z) - LIMIT_Z, 0));
  if (outside < scatter.minOut || outside > scatter.maxOut) return false;
  if (Math.hypot(x, z) > 36) return false;
  if (x > LIMIT_X - 2 && z > 1) return false;
  if (Math.hypot(x - FLUFFY.x, z - FLUFFY.z) < FLUFFY.radius) return false;
  const trunkClear = scatter.tree ? scatter.minSep : (scatter.trunkClear ?? 0);
  if (trunkClear > 0 && trunks.some((trunk) => Math.hypot(trunk.x - x, trunk.z - z) < trunkClear)) return false;
  return spots.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= scatter.minSep);
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
