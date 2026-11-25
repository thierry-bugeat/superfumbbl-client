/**
 * Personnage bombe (sphère, mèche, gants). La bombe de jeu et les spectateurs
 * partagent ce modèle : chacun a ses matériaux, les clones d'un même personnage
 * partagent les siens.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

/** Centre du corps quand la bombe est posée au sol. */
export const BOMB_STAND_Y = 0.22;

const BODY_RADIUS = 0.18;

export interface BombCharacter {
  figure: Group;
  glow: Mesh;
  flame: Mesh;
  spark: Mesh;
  dispose(): void;
}

interface Kept {
  dispose(): void;
}

export function createBombCharacter(): BombCharacter {
  const geometries: Kept[] = [];
  const materials: Kept[] = [];
  const textures: Kept[] = [];
  const figure = new Group();

  const bodyMat = new MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.92, metalness: 0.05 });
  materials.push(bodyMat);
  const bodyGeom = new SphereGeometry(BODY_RADIUS, 24, 18);
  geometries.push(bodyGeom);
  const body = new Mesh(bodyGeom, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  figure.add(body);

  const face = facePlane(geometries, materials, textures);
  face.position.set(0, 0.02, BODY_RADIUS * 0.92);
  figure.add(face);

  const metal = new MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.45, metalness: 0.7 });
  materials.push(metal);
  const capGeom = new CylinderGeometry(0.055, 0.07, 0.045, 12);
  geometries.push(capGeom);
  const cap = new Mesh(capGeom, metal);
  cap.position.y = BODY_RADIUS + 0.01;
  cap.castShadow = true;
  figure.add(cap);

  const rivetGeom = new SphereGeometry(0.012, 8, 6);
  geometries.push(rivetGeom);
  for (const side of [-1, 1] as const) {
    const rivet = new Mesh(rivetGeom, metal);
    rivet.position.set(side * 0.04, BODY_RADIUS + 0.02, 0.045);
    figure.add(rivet);
  }

  const wick = buildFuse(geometries, materials, textures);
  figure.add(wick.fuse);
  addLimb(figure, geometries, materials, -1);
  addLimb(figure, geometries, materials, 1);
  addFeet(figure, geometries, materials);

  const glow = buildGlow(geometries, materials, textures);
  return {
    figure,
    glow,
    flame: wick.flame,
    spark: wick.spark,
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.length = 0;
      materials.length = 0;
      textures.length = 0;
    },
  };
}

/** Mèche qui crépite. `anchorY` est la hauteur du parent : la lueur reste au sol. */
export function pulseBombWick(
  now: number,
  flame: Mesh | null,
  spark: Mesh | null,
  glow: Mesh | null,
  anchorY: number,
): void {
  const flicker = 0.85 + Math.sin(now * 0.028) * 0.15 + Math.sin(now * 0.061) * 0.08;
  if (flame) {
    flame.scale.set(flicker, 0.9 + flicker * 0.25, 1);
    const material = flame.material as MeshBasicMaterial;
    material.opacity = 0.75 + flicker * 0.2;
  }
  if (spark) {
    spark.rotation.z = now * 0.01;
    spark.scale.setScalar(0.7 + flicker * 0.45);
  }
  if (glow) {
    const scale = 1 + Math.sin(now * 0.003) * 0.06;
    glow.scale.set(scale, scale, 1);
    glow.position.y = 0.04 - anchorY;
  }
}

function facePlane(geometries: Kept[], materials: Kept[], textures: Kept[]): Mesh {
  const texture = faceTexture();
  textures.push(texture);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  materials.push(material);
  const geometry = new PlaneGeometry(BODY_RADIUS * 1.35, BODY_RADIUS * 1.15);
  geometries.push(geometry);
  return new Mesh(geometry, material);
}

function buildFuse(
  geometries: Kept[],
  materials: Kept[],
  textures: Kept[],
): { fuse: Group; flame: Mesh; spark: Mesh } {
  const fuse = new Group();
  const rope = new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.95, metalness: 0 });
  materials.push(rope);
  const curve = new CatmullRomCurve3([
    new Vector3(0, BODY_RADIUS + 0.03, 0),
    new Vector3(0.02, BODY_RADIUS + 0.1, 0.02),
    new Vector3(0.06, BODY_RADIUS + 0.16, 0.01),
    new Vector3(0.1, BODY_RADIUS + 0.2, -0.01),
  ]);
  const tube = new TubeGeometry(curve, 12, 0.014, 6, false);
  geometries.push(tube);
  fuse.add(new Mesh(tube, rope));

  const tip = curve.getPoint(1);
  const flameMap = makeFlameTexture();
  textures.push(flameMap);
  const flameMat = new MeshBasicMaterial({
    map: flameMap,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  materials.push(flameMat);
  const flameGeom = new PlaneGeometry(0.1, 0.14);
  geometries.push(flameGeom);
  const flame = new Mesh(flameGeom, flameMat);
  flame.name = 'bomb-flame';
  flame.position.copy(tip).add(new Vector3(0.02, 0.05, 0));
  fuse.add(flame);

  const sparkMap = makeSparkTexture();
  textures.push(sparkMap);
  const sparkMat = new MeshBasicMaterial({
    map: sparkMap,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  materials.push(sparkMat);
  const sparkGeom = new PlaneGeometry(0.12, 0.12);
  geometries.push(sparkGeom);
  const spark = new Mesh(sparkGeom, sparkMat);
  spark.name = 'bomb-spark';
  spark.position.copy(flame.position);
  fuse.add(spark);

  return { fuse, flame, spark };
}

function addLimb(figure: Group, geometries: Kept[], materials: Kept[], side: -1 | 1): void {
  const armMat = new MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9, metalness: 0 });
  const gloveMat = new MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.85, metalness: 0 });
  materials.push(armMat, gloveMat);

  const armGeom = new CylinderGeometry(0.012, 0.014, 0.08, 6);
  geometries.push(armGeom);
  const arm = new Mesh(armGeom, armMat);
  arm.position.set(side * (BODY_RADIUS * 0.75), -0.02, 0.02);
  arm.rotation.z = side * MathUtils.degToRad(55);
  arm.rotation.x = MathUtils.degToRad(15);
  figure.add(arm);

  const palmGeom = new SphereGeometry(0.045, 10, 8);
  geometries.push(palmGeom);
  const palm = new Mesh(palmGeom, gloveMat);
  palm.position.set(side * (BODY_RADIUS * 0.95 + 0.04), -0.06, 0.05);
  palm.scale.set(1, 0.85, 1.1);
  figure.add(palm);

  const fingerGeom = new SphereGeometry(0.018, 6, 5);
  geometries.push(fingerGeom);
  for (let i = 0; i < 3; i += 1) {
    const finger = new Mesh(fingerGeom, gloveMat);
    const spread = (i - 1) * 0.028;
    finger.position.set(
      side * (BODY_RADIUS * 0.95 + 0.07),
      -0.05 + spread * 0.3,
      0.08 + Math.abs(spread) * 0.2,
    );
    finger.scale.set(0.7, 1.2, 0.7);
    figure.add(finger);
  }
}

function addFeet(figure: Group, geometries: Kept[], materials: Kept[]): void {
  const shoe = new MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.9, metalness: 0 });
  materials.push(shoe);
  const footGeom = new SphereGeometry(0.05, 10, 8);
  geometries.push(footGeom);
  for (const side of [-1, 1] as const) {
    const foot = new Mesh(footGeom, shoe);
    foot.position.set(side * 0.07, -BODY_RADIUS * 0.85, 0.02);
    foot.scale.set(1.1, 0.65, 1.35);
    foot.castShadow = true;
    figure.add(foot);
  }
}

function buildGlow(geometries: Kept[], materials: Kept[], textures: Kept[]): Mesh {
  const texture = radialTexture([
    [0, 'rgba(255,160,40,0.9)'],
    [0.25, 'rgba(255,100,20,0.45)'],
    [0.55, 'rgba(200,40,0,0.15)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  textures.push(texture);
  const material = new MeshBasicMaterial({
    map: texture,
    color: 0xff8822,
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  materials.push(material);
  const geometry = new PlaneGeometry(0.9, 0.9);
  geometries.push(geometry);
  const glow = new Mesh(geometry, material);
  glow.name = 'bomb-glow';
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  glow.renderOrder = 2;
  return glow;
}

function faceTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 224;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 256, 224);
    const eye = (cx: number) => {
      context.beginPath();
      context.ellipse(cx, 78, 28, 42, 0, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = '#111111';
      context.stroke();
      context.beginPath();
      context.ellipse(cx, 88, 10, 16, 0, 0, Math.PI * 2);
      context.fillStyle = '#111111';
      context.fill();
    };
    eye(88);
    eye(168);
    context.beginPath();
    context.moveTo(78, 155);
    context.bezierCurveTo(100, 175, 128, 145, 156, 168);
    context.bezierCurveTo(170, 178, 185, 160, 188, 155);
    context.lineWidth = 8;
    context.lineCap = 'round';
    context.strokeStyle = '#111111';
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeFlameTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 64, 96);
    const outer = context.createRadialGradient(32, 70, 2, 32, 50, 36);
    outer.addColorStop(0, 'rgba(255,220,80,1)');
    outer.addColorStop(0.35, 'rgba(255,120,20,0.95)');
    outer.addColorStop(0.7, 'rgba(220,40,0,0.55)');
    outer.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = outer;
    context.beginPath();
    context.moveTo(32, 8);
    context.bezierCurveTo(48, 30, 56, 55, 40, 88);
    context.bezierCurveTo(32, 78, 28, 78, 24, 88);
    context.bezierCurveTo(8, 55, 16, 30, 32, 8);
    context.fill();
    context.fillStyle = 'rgba(255,250,200,0.95)';
    context.beginPath();
    context.moveTo(32, 28);
    context.bezierCurveTo(40, 42, 42, 58, 34, 72);
    context.bezierCurveTo(32, 66, 30, 66, 30, 72);
    context.bezierCurveTo(22, 58, 24, 42, 32, 28);
    context.fill();
  }
  return new CanvasTexture(canvas);
}

function makeSparkTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 64, 64);
    context.translate(32, 32);
    context.fillStyle = 'rgba(255,240,160,0.95)';
    for (let i = 0; i < 4; i += 1) {
      context.rotate(Math.PI / 4);
      context.beginPath();
      context.moveTo(0, -22);
      context.lineTo(4, -4);
      context.lineTo(22, 0);
      context.lineTo(4, 4);
      context.lineTo(0, 22);
      context.lineTo(-4, 4);
      context.lineTo(-22, 0);
      context.lineTo(-4, -4);
      context.closePath();
      context.fill();
    }
  }
  return new CanvasTexture(canvas);
}

function radialTexture(stops: [number, string][]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  return new CanvasTexture(canvas);
}
