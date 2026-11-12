import {
  ClampToEdgeWrapping,
  DoubleSide,
  InstancedMesh,
  LinearFilter,
  MathUtils,
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
 * L'herbe animée reste en dehors du 26 × 15.
 */
export async function createPitchGround(maxAnisotropy = 16, bladeCount = 4000): Promise<PitchGroundHandle> {
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

  const grass = installGrass(mesh, grassTexture, length, width, bladeCount);
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

function installGrass(ground: Mesh, grassTex: Texture, length: number, width: number, bladeCount: number): { update(timeMs: number): void; dispose(): void } {
  grassTex.colorSpace = SRGBColorSpace;
  grassTex.needsUpdate = true;
  const bladeH = 0.19;
  const bladeGeometry = new PlaneGeometry(0.32, bladeH);
  bladeGeometry.translate(0, bladeH / 2, 0);
  const grassMaterial = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      map: { value: grassTex },
      windDir: { value: new Vector2(1, 0.3).normalize() },
    },
    vertexShader: `
      uniform float time;
      uniform vec2 windDir;
      varying vec2 vUv;
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
        vec3 pos = (instanceMatrix * vec4(position, 1.0)).xyz;
        vec2 worldXZ = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;
        float wave = sin(mod(dot(worldXZ, windDir) * 0.6 + time * 2.0, 6.283185307179586));
        float wind = wave * 0.5 + noise(worldXZ * 0.25 + vec2(time * 0.2)) * 0.22;
        float influence = pow(clamp(uv.y, 0.0, 1.0), 1.25);
        pos.x += windDir.x * wind * 0.14 * influence;
        pos.z += windDir.y * wind * 0.14 * influence;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.5) discard;
        gl_FragColor = vec4(tex.rgb * mix(0.8, 1.4, vUv.y), 1.0);
      }
    `,
    transparent: true,
    side: 2,
  });
  const grass = new InstancedMesh(bladeGeometry, grassMaterial, bladeCount);
  const dummy = new Object3D();
  const pitchX0 = edgeX(0) - ground.position.x;
  const pitchX1 = edgeX(PITCH_COLUMNS) - ground.position.x;
  const pitchZ0 = edgeZ(0) - ground.position.z;
  const pitchZ1 = edgeZ(PITCH_ROWS) - ground.position.z;
  for (let i = 0; i < bladeCount; i += 1) {
    let x = 0;
    let z = 0;
    do {
      x = MathUtils.randFloatSpread(length);
      z = MathUtils.randFloatSpread(width);
    } while (x > pitchX0 && x < pitchX1 && z > pitchZ0 && z < pitchZ1);
    dummy.position.set(x, 0.02, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const scale = 0.4 + Math.random() * 0.55;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  ground.add(grass);

  return {
    update(timeMs: number) {
      grassMaterial.uniforms.time!.value = timeMs * 0.001;
      const wind = grassMaterial.uniforms.windDir!.value as Vector2;
      const tt = timeMs * 0.0002;
      wind.set(Math.sin(tt), Math.cos(tt * 0.7)).normalize();
    },
    dispose() {
      ground.remove(grass);
      bladeGeometry.dispose();
      grassMaterial.dispose();
      grassTex.dispose();
    },
  };
}
