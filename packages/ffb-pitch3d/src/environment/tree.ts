/**
 * Arbre fluffy (feuillage anime + vent), adapté de leoawen/fluffytree-threejs (MIT).
 * Copyright (c) 2025 Leonardo Soares Gonçalves.
 */
import {
  Box3,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Material,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Vector3,
  type DirectionalLight,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { edgeZ } from '../coords';
import { attachCanopySnow, enableSnowCap } from './snowCap';

const MODEL_URL = new URL('../../assets/environment/fluffy-tree.glb', import.meta.url).href;
const TREE_HEIGHT = 5.5;
/** GLTFLoader remplace espaces et points : « NOVA COPA Esfera.004 » devient « NOVA_COPA_Esfera004 ». */
const CANOPY_PREFIX = 'NOVA_COPA';
/** Centre du tronc, le long de la touche gauche, hors du terrain. */
const ALONG_PITCH = 3;
const SIDELINE_SETBACK = 3.2;

const GRADIENT = {
  gradientStart: -1.0,
  gradientEnd: 2.7,
  litColor: new Color(0x6cbe62),
  shadowColor: new Color(0x1c3328),
  highlightColor: new Color(0xa6cc71),
  highlightStart: 0.5,
  highlightEnd: 1.8,
  leafShadowDarkness: 0.2,
};

/** Plus ample que la démo : la caméra du terrain est trop loin pour 5 cm de balancement. */
const WIND = { strength: 0.22, frequency: 4.0, speed: 0.55 };

const NOISE_GLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}
float cnoise(vec3 P){
  vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0); Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x); vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy); vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5; gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0); vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5; gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1); vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x); vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z); vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x); vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z); vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0); vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y); float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}`;

type CanopyShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

/** Arbre fluffy sur la touche gauche, un peu en retrait, bas au niveau du gazon. */
export class PitchTree {
  readonly group = new Group();
  private readonly canopyMaterials: MeshLambertMaterial[] = [];
  private readonly lightDir = new Vector3();
  private startedAt = 0;

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const scene = gltf.scene;
    scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (isCanopy(mesh.name)) {
        const material = createCanopyMaterial(mesh);
        mesh.material = material;
        this.canopyMaterials.push(material);
      } else {
        mesh.material = toTrunkMaterial(mesh.material);
      }
    });

    scene.updateMatrixWorld(true);
    const rawHeight = new Box3().setFromObject(scene, true).getSize(new Vector3()).y;
    scene.scale.setScalar(TREE_HEIGHT / Math.max(rawHeight, 0.001));

    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene, true);
    const center = bounds.getCenter(new Vector3());
    scene.position.set(ALONG_PITCH - center.x, -bounds.min.y, edgeZ(0) - SIDELINE_SETBACK - center.z);
    this.group.add(scene);
    this.group.updateMatrixWorld(true);
    this.refreshCanopyCenters(scene);
    this.startedAt = performance.now();
  }

  /** Vent + direction du soleil pour le dégradé du feuillage. */
  tick(now: number, sun: DirectionalLight | null): void {
    if (this.canopyMaterials.length === 0) return;
    const elapsed = (now - this.startedAt) / 1000;
    if (sun) this.lightDir.copy(sun.position).normalize();
    for (const material of this.canopyMaterials) {
      const shaders = material.userData.shaders as CanopyShader[] | undefined;
      if (!shaders) continue;
      for (const shader of shaders) {
        const time = shader.uniforms.uTime;
        if (time) time.value = elapsed;
        const light = shader.uniforms.uLightDirection;
        if (sun && light) (light.value as Vector3).copy(this.lightDir);
      }
    }
  }

  dispose(): void {
    this.group.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.canopyMaterials.length = 0;
    this.group.clear();
  }

  private refreshCanopyCenters(scene: Group): void {
    scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || !isCanopy(mesh.name)) return;
      const material = mesh.material as MeshLambertMaterial;
      const center = canopyCenter(mesh);
      const shaders = material.userData.shaders as CanopyShader[] | undefined;
      if (!shaders?.length) {
        material.userData.pendingTreeCenter = center;
        return;
      }
      for (const shader of shaders) {
        const uniform = shader.uniforms.uTreeCenter;
        if (uniform) (uniform.value as Vector3).copy(center);
      }
    });
  }
}

function isCanopy(name: string): boolean {
  return name.startsWith(CANOPY_PREFIX);
}

function canopyCenter(mesh: Mesh): Vector3 {
  mesh.geometry.computeBoundingBox();
  const center = new Vector3();
  mesh.geometry.boundingBox!.getCenter(center);
  mesh.updateWorldMatrix(true, false);
  return center.applyMatrix4(mesh.matrixWorld);
}

function createCanopyMaterial(mesh: Mesh): MeshLambertMaterial {
  const alphaMap = (mesh.material as MeshStandardMaterial).map as Texture | null;
  const treeCenter = canopyCenter(mesh);
  const material = new MeshLambertMaterial({
    alphaMap: alphaMap ?? undefined,
    side: DoubleSide,
    alphaTest: 0.5,
    depthWrite: true,
  });

  const compiled: CanopyShader[] = [];
  material.userData.shaders = compiled;

  material.onBeforeCompile = (shader) => {
    const canopyShader = shader as unknown as CanopyShader;
    compiled.push(canopyShader);
    const pending = material.userData.pendingTreeCenter as Vector3 | undefined;
    Object.assign(canopyShader.uniforms, {
      uLightDirection: { value: new Vector3(0.5, 1, 0.3).normalize() },
      uTreeCenter: { value: pending?.clone() ?? treeCenter.clone() },
      uGradientStart: { value: GRADIENT.gradientStart },
      uGradientEnd: { value: GRADIENT.gradientEnd },
      uLitColor: { value: GRADIENT.litColor.clone() },
      uShadowColor: { value: GRADIENT.shadowColor.clone() },
      uHighlightColor: { value: GRADIENT.highlightColor.clone() },
      uHighlightStart: { value: GRADIENT.highlightStart },
      uHighlightEnd: { value: GRADIENT.highlightEnd },
      uLeafShadowDarkness: { value: GRADIENT.leafShadowDarkness },
      uTime: { value: 0 },
      uWindStrength: { value: WIND.strength },
      uWindFrequency: { value: WIND.frequency },
      uWindSpeed: { value: WIND.speed },
    });

    const worldVarying = canopyShader.vertexShader.includes('varying vec3 vWorldPosition')
      ? ''
      : 'varying vec3 vWorldPosition;';
    canopyShader.vertexShader = `
      ${worldVarying}
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindFrequency;
      uniform float uWindSpeed;
      ${NOISE_GLSL}
      ${canopyShader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float time = uTime * uWindSpeed;
      float noise = cnoise(vec3(position.x * uWindFrequency, position.y * uWindFrequency, time));
      vec3 windDirection = vec3(1.0, 0.0, 1.0);
      float displacement = noise * uWindStrength * (position.y / 8.0);
      transformed.xyz += normalize(windDirection) * displacement;
      vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `,
    );

    if (!canopyShader.fragmentShader.includes('#include <color_fragment>')) return;

    const fragmentVarying = canopyShader.fragmentShader.includes('varying vec3 vWorldPosition')
      ? ''
      : 'varying vec3 vWorldPosition;';
    canopyShader.fragmentShader = `
      ${fragmentVarying}
      uniform vec3 uLightDirection;
      uniform vec3 uTreeCenter;
      uniform float uGradientStart;
      uniform float uGradientEnd;
      uniform vec3 uLitColor;
      uniform vec3 uShadowColor;
      uniform vec3 uHighlightColor;
      uniform float uHighlightStart;
      uniform float uHighlightEnd;
      uniform float uLeafShadowDarkness;
      ${canopyShader.fragmentShader}
    `
      .replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float shadow = 1.0;
        #if ( NUM_DIR_LIGHT_SHADOWS > 0 )
          shadow = getShadow(
            directionalShadowMap[ 0 ],
            directionalLightShadows[ 0 ].shadowMapSize,
            directionalLightShadows[ 0 ].shadowIntensity,
            directionalLightShadows[ 0 ].shadowBias,
            directionalLightShadows[ 0 ].shadowRadius,
            vDirectionalShadowCoord[ 0 ]
          );
        #endif
        vec3 fromCenterToSurface = normalize(vWorldPosition - uTreeCenter);
        float lightAlignment = dot(fromCenterToSurface, uLightDirection);
        float baseGradientFactor = smoothstep(uGradientStart, uGradientEnd, lightAlignment);
        vec3 baseColor = mix(uShadowColor, uLitColor, baseGradientFactor);
        float highlightFactor = smoothstep(uHighlightStart, uHighlightEnd, lightAlignment);
        vec3 gradientColor = mix(baseColor, uHighlightColor, highlightFactor);
        diffuseColor.rgb = mix(gradientColor * uLeafShadowDarkness, gradientColor, shadow);
        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `
        #include <normal_fragment_begin>
        vec3 worldUp = vec3(0.0, 1.0, 0.0);
        normal = normalize(mat3(viewMatrix) * worldUp);
        `,
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = diffuseColor.rgb;',
      );
    attachCanopySnow(canopyShader);
  };

  material.customProgramCacheKey = () => 'fluffy-canopy-v5';
  return material;
}

function toTrunkMaterial(source: Material | Material[]): Material | Material[] {
  if (Array.isArray(source)) return source.map((entry) => toTrunkMaterial(entry) as Material);
  if (source instanceof MeshStandardMaterial) {
    source.side = FrontSide;
    enableSnowCap(source);
    return source;
  }
  return source;
}
