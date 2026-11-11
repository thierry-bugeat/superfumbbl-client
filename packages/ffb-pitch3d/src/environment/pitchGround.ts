import {
  InstancedMesh,
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

const GRASS_URL = new URL('../../assets/environment/grass.svg', import.meta.url).href;

export interface PitchGroundHandle {
  mesh: Mesh;
  update(timeMs: number): void;
  dispose(): void;
}

/**
 * Sol et brins d'herbe portés de SpikeBowl.
 * Le visuel de sol de SpikeBowl est un plateau sevens vertical : il n'est pas plaqué
 * sur le 26 × 15. Le vert et les lignes FFB le remplacent. L'herbe animée, elle, est reprise.
 */
export async function createPitchGround(groundWidth: number, groundDepth: number, bladeCount = 4000): Promise<PitchGroundHandle> {
  const grassTexture = await new TextureLoader().loadAsync(GRASS_URL);
  const geometry = new PlaneGeometry(groundWidth, groundDepth);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial({
    color: 0x2f6b3a,
    roughness: 0.92,
    metalness: 0.02,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;

  const grass = installGrass(mesh, grassTexture, groundWidth, groundDepth, bladeCount);
  return {
    mesh,
    update: (timeMs) => grass.update(timeMs),
    dispose() {
      grass.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

function installGrass(ground: Mesh, grassTex: Texture, groundWidth: number, groundDepth: number, bladeCount: number): { update(timeMs: number): void; dispose(): void } {
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
  const marginX = 1.2;
  const marginZ = 1.2;
  for (let i = 0; i < bladeCount; i += 1) {
    dummy.position.set(
      MathUtils.randFloatSpread(groundWidth - marginX * 2),
      0.02,
      MathUtils.randFloatSpread(groundDepth - marginZ * 2),
    );
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
