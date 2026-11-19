import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
} from 'three';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS } from '../coords';

const GRASS_URL = new URL('../../assets/environment/grass.svg', import.meta.url).href;
const GROUND_URL = new URL('../../assets/environment/ground-regular.avif', import.meta.url).href;

/**
 * Repères mesurés sur ground-regular.avif (5413 × 7197).
 * Un carreau du 15 × 26 peint fait 268 px. L'en-but away est en haut de l'image,
 * l'en-but home en bas, les lignes de touche à gauche et à droite.
 */
const SQUARE_PX = 268;
const IMAGE_W = 5413;
const IMAGE_H = 7197;
const AWAY_LINE_PY = 105.5;
const LEFT_LINE_PX = 700;

export interface PitchGroundHandle {
  mesh: Mesh;
  update(timeMs: number): void;
  dispose(): void;
}

/**
 * Plateau de SpikeBowl, avec ground-regular.avif à la place du plateau sevens.
 * L'image est en portrait (longueur dans la hauteur) : les UV la tournent pour
 * que l'en-but home tombe sur la colonne 0, à gauche.
 * Sur le terrain l'herbe courte est éparpillée en clairières, comme dehors,
 * et elle ne dépasse pas la taille d'origine. Au-delà, elle s'étend loin,
 * en herbes hautes et très hautes.
 */
export async function createPitchGround(maxAnisotropy = 16, bladeCount = 16000): Promise<PitchGroundHandle> {
  const loader = new TextureLoader();
  const [groundTexture, grassTexture] = await Promise.all([
    loader.loadAsync(GROUND_URL),
    loader.loadAsync(GRASS_URL),
  ]);
  configureGroundTexture(groundTexture, maxAnisotropy);

  const length = IMAGE_H / SQUARE_PX;
  const width = IMAGE_W / SQUARE_PX;
  const geometry = new PlaneGeometry(length, width);
  geometry.rotateX(-Math.PI / 2);
  turnTextureOntoLength(geometry);
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    map: groundTexture,
    roughness: 0.98,
    metalness: 0.02,
    side: DoubleSide,
    transparent: false,
    alphaTest: 0.02,
    depthWrite: true,
  });
  const mesh = new Mesh(geometry, material);
  const awayX = length / 2 - (AWAY_LINE_PY / IMAGE_H) * length;
  const leftZ = -width / 2 + (LEFT_LINE_PX / IMAGE_W) * width;
  mesh.position.set(edgeX(PITCH_COLUMNS) - awayX, 0, edgeZ(0) - leftZ);
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;

  const grass = installGrass(mesh, grassTexture, bladeCount);
  return {
    mesh,
    update: (timeMs) => grass.update(timeMs),
    dispose() {
      grass.dispose();
      geometry.dispose();
      material.dispose();
      groundTexture.dispose();
    },
  };
}

/** Même réglage que SpikeBowl : pas de mipmaps, pour garder les lignes nettes en vue oblique. */
function configureGroundTexture(texture: Texture, maxAnisotropy: number): void {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
}

/**
 * Après rotateX(-90°), u suit x et v suit -z.
 * On veut la hauteur de l'image (away en haut) le long de x, et sa largeur le long de z.
 */
function turnTextureOntoLength(geometry: PlaneGeometry): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, 1 - v, u);
  }
  uv.needsUpdate = true;
}

/** Portée hors du terrain, en cases. Le sol du dôme va jusqu'à ~90. */
const GRASS_REACH = 74;
const GRASS_DOME_RADIUS = 86;
const GRASS_BLADE_WIDTH = 0.32;
const GRASS_BLADE_HEIGHT = 0.19;
/** Échelle d'origine : sur le terrain, l'herbe ne monte pas plus haut que ça. */
const GRASS_SHORT_MIN = 0.4;
const GRASS_SHORT_SPAN = 0.55;
/** Même seuil dedans et dehors : les clairières traversent la ligne. */
const GRASS_BARE = 0.42;
const GRASS_TALL_AT = 0.46;
const GRASS_VERY_TALL_AT = 0.66;

interface GrassBlade {
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
}

type GrassTier = 'short' | 'tall' | 'very';

function installGrass(ground: Mesh, grassTex: Texture, bladeCount: number): { update(timeMs: number): void; dispose(): void } {
  grassTex.colorSpace = SRGBColorSpace;
  grassTex.needsUpdate = true;
  const material = grassMaterial(grassTex);
  const shortGeometry = bladeGeometry(false);
  const wildGeometry = bladeGeometry(true);
  const field = grassField(ground);
  const short: GrassBlade[] = [];
  const wild: GrassBlade[] = [];
  plantPitch(field, Math.round(bladeCount * 0.05), short, wild);
  plantOutside(field, bladeCount, short, wild);
  const meshes = [buildGrass(shortGeometry, material, short), buildGrass(wildGeometry, material, wild)].filter(
    (mesh): mesh is InstancedMesh => mesh !== null,
  );
  ground.add(...meshes);

  return {
    update(timeMs: number) {
      material.uniforms.time!.value = timeMs * 0.001;
      const wind = material.uniforms.windDir!.value as Vector2;
      const tt = timeMs * 0.0002;
      wind.set(Math.sin(tt), Math.cos(tt * 0.7)).normalize();
    },
    dispose() {
      ground.remove(...meshes);
      shortGeometry.dispose();
      wildGeometry.dispose();
      material.dispose();
      grassTex.dispose();
    },
  };
}

interface GrassField {
  pitchX0: number;
  pitchX1: number;
  pitchZ0: number;
  pitchZ1: number;
  originX: number;
  originZ: number;
}

function grassField(ground: Mesh): GrassField {
  return {
    pitchX0: edgeX(0) - ground.position.x,
    pitchX1: edgeX(PITCH_COLUMNS) - ground.position.x,
    pitchZ0: edgeZ(0) - ground.position.z,
    pitchZ1: edgeZ(PITCH_ROWS) - ground.position.z,
    originX: ground.position.x,
    originZ: ground.position.z,
  };
}

/** Herbe courte sur tout le 26 × 15, en touffes et en clairières, comme dehors. */
function plantPitch(field: GrassField, sites: number, short: GrassBlade[], wild: GrassBlade[]): void {
  let placed = 0;
  let guard = 0;
  const spanX = field.pitchX1 - field.pitchX0;
  const spanZ = field.pitchZ1 - field.pitchZ0;
  while (placed < sites && guard < sites * 40) {
    guard += 1;
    const x = field.pitchX0 + Math.random() * spanX;
    const z = field.pitchZ0 + Math.random() * spanZ;
    if (grassCover(x, z) < GRASS_BARE) continue;
    plantClump(field, x, z, 'short', 5, 0.42, true, short, wild);
    placed += 1;
  }
}

/**
 * Prairie hors du terrain. La distance au bord est tirée presque uniformément :
 * comme le pourtour s'allonge, la densité baisse tout seule vers le lointain.
 * Les brins courts partent en touffes, les très hauts restent plus rares.
 */
function plantOutside(field: GrassField, sites: number, short: GrassBlade[], wild: GrassBlade[]): void {
  let placed = 0;
  let guard = 0;
  while (placed < sites && guard < sites * 40) {
    guard += 1;
    const spot = sampleOutside(field);
    const distance = outsideDistance(field, spot.x, spot.z);
    if (distance < 0.05 || distance > GRASS_REACH) continue;
    if (insidePitch(field, spot.x, spot.z) || !insideDome(field, spot.x, spot.z)) continue;
    if (grassCover(spot.x, spot.z) < GRASS_BARE) continue;
    const tier = grassTier(spot.x, spot.z);
    const copies = tier === 'short' ? 5 : tier === 'tall' ? 2 : 1;
    const spread = tier === 'very' ? 0 : tier === 'tall' ? 0.55 : 0.42;
    plantClump(field, spot.x, spot.z, tier, copies, spread, false, short, wild);
    placed += 1;
  }
}

function plantClump(
  field: GrassField,
  x: number,
  z: number,
  tier: GrassTier,
  copies: number,
  spread: number,
  onPitch: boolean,
  short: GrassBlade[],
  wild: GrassBlade[],
): void {
  for (let copy = 0; copy < copies; copy += 1) {
    const bladeX = x + (copy === 0 ? 0 : (Math.random() - 0.5) * spread * 2);
    const bladeZ = z + (copy === 0 ? 0 : (Math.random() - 0.5) * spread * 2);
    if (insidePitch(field, bladeX, bladeZ) !== onPitch) continue;
    if (!onPitch && !insideDome(field, bladeX, bladeZ)) continue;
    if (grassCover(bladeX, bladeZ) < GRASS_BARE) continue;
    const blade = makeBlade(bladeX, bladeZ, onPitch ? 'short' : tier);
    (blade.sy > 1.15 ? wild : short).push(blade);
  }
}

function sampleOutside(field: GrassField): { x: number; z: number } {
  const spanX = field.pitchX1 - field.pitchX0;
  const spanZ = field.pitchZ1 - field.pitchZ0;
  const along = Math.random() * 2 * (spanX + spanZ);
  let x = field.pitchX0;
  let z = field.pitchZ0;
  let nx = 0;
  let nz = -1;
  if (along < spanX) {
    x = field.pitchX0 + along;
    nz = -1;
  } else if (along < spanX * 2) {
    x = field.pitchX0 + (along - spanX);
    z = field.pitchZ1;
    nz = 1;
  } else if (along < spanX * 2 + spanZ) {
    z = field.pitchZ0 + (along - spanX * 2);
    nx = -1;
    nz = 0;
  } else {
    x = field.pitchX1;
    z = field.pitchZ0 + (along - spanX * 2 - spanZ);
    nx = 1;
    nz = 0;
  }
  const distance = GRASS_REACH * Math.pow(Math.random(), 1.15);
  const tangent = (Math.random() - 0.5) * Math.max(distance, 1) * 0.9;
  return { x: x + nx * distance - nz * tangent, z: z + nz * distance + nx * tangent };
}

function makeBlade(x: number, z: number, tier: GrassTier): GrassBlade {
  const short = GRASS_SHORT_MIN + Math.random() * GRASS_SHORT_SPAN;
  if (tier === 'short') return { x, z, yaw: Math.random() * Math.PI, sx: short, sy: short };
  const very = tier === 'very';
  return {
    x,
    z,
    yaw: Math.random() * Math.PI,
    sx: (very ? 1.05 : 0.82) + Math.random() * (very ? 0.5 : 0.4),
    sy: (very ? 6.4 : 2.9) + Math.random() * (very ? 3 : 1.6),
  };
}

function buildGrass(geometry: BufferGeometry, material: ShaderMaterial, blades: GrassBlade[]): InstancedMesh | null {
  if (blades.length === 0) return null;
  const mesh = new InstancedMesh(geometry, material, blades.length);
  mesh.frustumCulled = false;
  const dummy = new Object3D();
  for (let i = 0; i < blades.length; i += 1) {
    const blade = blades[i]!;
    dummy.position.set(blade.x, 0.02, blade.z);
    dummy.rotation.set(0, blade.yaw, 0);
    dummy.scale.set(blade.sx, blade.sy, blade.sx);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function bladeGeometry(crossed: boolean): BufferGeometry {
  const plane = new PlaneGeometry(GRASS_BLADE_WIDTH, GRASS_BLADE_HEIGHT);
  plane.translate(0, GRASS_BLADE_HEIGHT / 2, 0);
  if (!crossed) return plane;
  const position = plane.getAttribute('position');
  const uv = plane.getAttribute('uv');
  const source = plane.getIndex();
  const count = position.count;
  const positions = new Float32Array(count * 6);
  const uvs = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    uvs[i * 2] = uv.getX(i);
    uvs[i * 2 + 1] = uv.getY(i);
    const crossedIndex = count + i;
    positions[crossedIndex * 3] = z;
    positions[crossedIndex * 3 + 1] = y;
    positions[crossedIndex * 3 + 2] = -x;
    uvs[crossedIndex * 2] = uv.getX(i);
    uvs[crossedIndex * 2 + 1] = uv.getY(i);
  }
  const indexCount = source ? source.count : 0;
  const indices = new Uint16Array(indexCount * 2);
  for (let i = 0; i < indexCount; i += 1) {
    const vertex = source?.getX(i) ?? 0;
    indices[i] = vertex;
    indices[indexCount + i] = vertex + count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  plane.dispose();
  return geometry;
}

/** L'alpha du SVG garde la silhouette. Le nuage choisit un vert : jaune, pré, bleu-vert, olive. */
function grassMaterial(grassTex: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      map: { value: grassTex },
      windDir: { value: new Vector2(1, 0.3).normalize() },
      fogColor: { value: new Color() },
      fogDensity: { value: 0 },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
    },
    vertexShader: `
      uniform float time;
      uniform vec2 windDir;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <fog_pars_vertex>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      void main() {
        vUv = uv;
        vec2 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        vTint = vec3(noise(root * 0.10), noise(root * 0.62 + vec2(8.0, 3.0)), 0.0);
        vec3 pos = (instanceMatrix * vec4(position, 1.0)).xyz;
        vec2 worldXZ = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;
        float wave = sin(mod(dot(worldXZ, windDir) * 0.6 + time * 2.0, 6.283185307179586));
        float wind = wave * 0.5 + noise(worldXZ * 0.25 + vec2(time * 0.2)) * 0.22;
        float influence = pow(clamp(uv.y, 0.0, 1.0), 1.25);
        float bend = wind * 0.2 * clamp(length(instanceMatrix[1].xyz), 0.7, 5.0) * influence;
        pos.x += windDir.x * bend;
        pos.z += windDir.y * bend;
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.5) discard;
        float shade = mix(0.48, 1.05, pow(clamp(vUv.y, 0.0, 1.0), 0.85));
        vec3 yellow = vec3(0.74, 0.72, 0.10);
        vec3 meadow = vec3(0.24, 0.62, 0.14);
        vec3 teal = vec3(0.10, 0.50, 0.44);
        vec3 olive = vec3(0.50, 0.48, 0.12);
        vec3 hue = mix(yellow, meadow, smoothstep(0.30, 0.46, vTint.x));
        hue = mix(hue, teal, smoothstep(0.56, 0.74, vTint.x));
        hue = mix(hue, olive, smoothstep(0.58, 0.80, vTint.y));
        gl_FragColor = vec4(hue * shade, 1.0);
        #include <fog_fragment>
      }
    `,
    transparent: false,
    depthWrite: true,
    side: DoubleSide,
    fog: true,
  });
}

function insidePitch(field: GrassField, x: number, z: number): boolean {
  return x > field.pitchX0 && x < field.pitchX1 && z > field.pitchZ0 && z < field.pitchZ1;
}

function outsideDistance(field: GrassField, x: number, z: number): number {
  const dx = Math.max(field.pitchX0 - x, 0, x - field.pitchX1);
  const dz = Math.max(field.pitchZ0 - z, 0, z - field.pitchZ1);
  return Math.hypot(dx, dz);
}

function insideDome(field: GrassField, x: number, z: number): boolean {
  const worldX = x + field.originX;
  const worldZ = z + field.originZ;
  return worldX * worldX + worldZ * worldZ <= GRASS_DOME_RADIUS * GRASS_DOME_RADIUS;
}

function grassTier(x: number, z: number): GrassTier {
  const growth = grassGrowth(x, z);
  if (growth < GRASS_TALL_AT) return 'short';
  if (growth < GRASS_VERY_TALL_AT) return 'tall';
  return 'very';
}

/** Grandes zones vides, un peu mordues par un détail plus fin. */
function grassCover(x: number, z: number): number {
  const broad = valueNoise(x * 0.055, z * 0.055);
  const detail = valueNoise(x * 0.15 + 8.2, z * 0.15 - 5.4);
  return broad * 0.7 + detail * 0.3;
}

/** Hauteur de la prairie, décalée du masque des clairières. */
function grassGrowth(x: number, z: number): number {
  const broad = valueNoise(x * 0.048 + 19.4, z * 0.048 - 7.7);
  const detail = valueNoise(x * 0.13 + 2.2, z * 0.13 + 14.8);
  return broad * 0.72 + detail * 0.28;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = noiseHash(ix, iz);
  const b = noiseHash(ix + 1, iz);
  const c = noiseHash(ix, iz + 1);
  const d = noiseHash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz * (1 - ux) + (d - b) * ux * uz;
}

function noiseHash(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
