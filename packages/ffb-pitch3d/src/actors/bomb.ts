import type { GameJson } from '@fumbbl40k/ffb-protocol';
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
  Scene,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { squareToWorld } from '../coords';
import { throwArcHeight, type Figurines } from './figurines';

const MOVE_SPEED = 6;
const BASE_STANDING = 0x01;
const BASE_MOVING = 0x02;
/** Au-dessus du socle, assez haut pour dépasser le numéro. */
const CARRIED_Y = 0.5;
const GROUND_Y = 0.22;
const BODY_RADIUS = 0.18;

/** Bombe Bob-omb (sphère, mèche allumée, gants), parabole comme le ballon. */
export class PitchBomb {
  private readonly group = new Group();
  private readonly figure = new Group();
  private flame: Mesh | null = null;
  private spark: Mesh | null = null;
  private glow: Mesh | null = null;
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: { dispose(): void }[] = [];
  private readonly textures: { dispose(): void }[] = [];
  private targetX = 0;
  private targetZ = 0;
  private carrierId: string | null = null;
  private lob: { startX: number; startZ: number; height: number; releaseY: number } | null = null;
  private settledX = 0;
  private settledZ = 0;
  private settledOnPitch = true;
  private pendingCarrierId: string | null = null;
  private placed = false;
  /**
   * Le modèle pose la bombe sur sa case avant l'animation de lancé.
   * Tant que ce vol n'a pas commencé, on ne la montre pas : sinon elle apparaît,
   * puis le lancé la rejoue depuis le lanceur.
   */
  private revealed = false;
  private airborne = false;
  private flightDistance = 0;
  private lastTick = 0;
  private readonly spinX = MathUtils.randFloat(0.004, 0.008) * 60;
  private readonly spinY = MathUtils.randFloat(0.006, 0.012) * 60;
  private readonly spinZ = MathUtils.randFloat(0.003, 0.007) * 60;

  constructor(scene: Scene) {
    scene.add(this.group);
    this.group.visible = false;
    this.build();
  }

  /** Rien à charger : la géométrie est procédurale. */
  async load(): Promise<void> {}

  /** Affiche la bombe sur sa case, ou la colle au porteur. `cut` : un saut, le lob n'a plus cours. */
  sync(game: GameJson, cut = false): void {
    if (cut) {
      this.lob = null;
      this.revealed = false;
    }
    const field = game.fieldModel;
    const coordinate = field?.bombCoordinate;
    const onPitch = !!coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
    if (this.lob) {
      this.group.visible = true;
      this.placed = true;
      this.revealed = true;
      if (!onPitch || !coordinate) {
        this.settledOnPitch = false;
        this.pendingCarrierId = null;
        return;
      }
      const world = squareToWorld(coordinate[0], coordinate[1]);
      this.settledX = world.x;
      this.settledZ = world.z;
      this.settledOnPitch = true;
      this.pendingCarrierId = carrierOnSquare(game, coordinate[0], coordinate[1]);
      return;
    }
    if (!onPitch || !coordinate) {
      this.group.visible = false;
      this.placed = false;
      this.revealed = false;
      this.carrierId = null;
      return;
    }
    if (!cut && field?.bombMoving && !this.revealed) return;
    const world = squareToWorld(coordinate[0], coordinate[1]);
    const carrier = carrierOnSquare(game, coordinate[0], coordinate[1]);
    const hop = Math.hypot(world.x - this.targetX, world.z - this.targetZ);
    this.targetX = world.x;
    this.targetZ = world.z;
    this.carrierId = carrier;
    this.revealed = true;
    this.airborne = !carrier && hop > 1.6;
    this.flightDistance = this.airborne ? Math.max(hop, 0.001) : 0;
    if (!this.placed) {
      this.group.position.set(world.x, carrier ? CARRIED_Y : GROUND_Y, world.z);
      this.placed = true;
    }
    this.group.visible = true;
  }

  /** Position déjà interpolée, pour que la caméra suive la bombe et non sa case. */
  spot(): { x: number; z: number } | null {
    if (!this.group.visible) return null;
    return { x: this.group.position.x, z: this.group.position.z };
  }

  /** La bombe disparaît dans l'explosion. */
  vanish(): void {
    this.lob = null;
    this.carrierId = null;
    this.pendingCarrierId = null;
    this.placed = false;
    this.revealed = false;
    this.airborne = false;
    this.group.visible = false;
  }

  /**
   * Lancé : la parabole part tout de suite vers la case annoncée.
   * Un second ordre pendant le vol allonge la courbe sans changer l'origine.
   */
  throwTo(toX: number, toZ: number, fromX: number, fromZ: number): void {
    this.group.visible = true;
    this.placed = true;
    this.revealed = true;
    this.carrierId = null;
    this.airborne = false;
    if (this.lob) {
      const distance = Math.hypot(toX - this.lob.startX, toZ - this.lob.startZ);
      if (distance < 0.2) return;
      this.lob.height = throwArcHeight(distance);
      this.targetX = toX;
      this.targetZ = toZ;
      this.settledX = toX;
      this.settledZ = toZ;
      this.settledOnPitch = true;
      return;
    }
    let startX = this.group.position.x;
    let startZ = this.group.position.z;
    const nearStart = Math.hypot(startX - fromX, startZ - fromZ) < 0.75;
    if (!nearStart) {
      startX = fromX;
      startZ = fromZ;
      this.group.position.set(fromX, GROUND_Y, fromZ);
    }
    const distance = Math.hypot(toX - startX, toZ - startZ);
    if (distance < 0.2) return;
    this.lob = {
      startX,
      startZ,
      height: throwArcHeight(distance),
      releaseY: this.group.position.y,
    };
    this.targetX = toX;
    this.targetZ = toZ;
    this.settledX = toX;
    this.settledZ = toZ;
    this.settledOnPitch = true;
    this.pendingCarrierId = null;
    this.showGlow(false);
  }

  tick(now: number, figurines: Figurines | null): void {
    if (!this.group.visible) return;
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (this.lob) {
      this.stepLob(dt, figurines);
    } else {
      this.stepGround(dt, figurines, now);
    }
    this.figure.rotation.x += this.spinX * dt;
    this.figure.rotation.y += this.spinY * dt;
    this.figure.rotation.z += this.spinZ * dt;
    this.pulseFlame(now);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }

  private stepLob(dt: number, figurines: Figurines | null): void {
    const lob = this.lob;
    if (!lob) return;
    this.showGlow(false);
    const dx = this.targetX - this.group.position.x;
    const dz = this.targetZ - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    const step = MOVE_SPEED * dt;
    if (distance <= step || distance < 0.0001) {
      this.group.position.x = this.targetX;
      this.group.position.z = this.targetZ;
      this.landLob(figurines);
      return;
    }
    this.group.position.x += (dx / distance) * step;
    this.group.position.z += (dz / distance) * step;
    const total = Math.hypot(this.targetX - lob.startX, this.targetZ - lob.startZ);
    const traveled = Math.hypot(this.group.position.x - lob.startX, this.group.position.z - lob.startZ);
    const t = total <= 0.0001 ? 1 : Math.min(1, traveled / total);
    const arc = 4 * lob.height * t * (1 - t);
    this.group.position.y = lob.releaseY + (GROUND_Y - lob.releaseY) * t + arc;
  }

  private landLob(figurines: Figurines | null): void {
    const landingX = this.targetX;
    const landingZ = this.targetZ;
    this.lob = null;
    this.showGlow(true);
    const carrier = this.pendingCarrierId ? figurines?.where(this.pendingCarrierId) : null;
    if (carrier && Math.hypot(carrier.x - landingX, carrier.z - landingZ) < 0.75) {
      this.carrierId = this.pendingCarrierId;
      this.airborne = false;
      this.group.position.set(carrier.x, carrier.y + CARRIED_Y, carrier.z);
      return;
    }
    this.carrierId = null;
    if (!this.settledOnPitch) {
      this.group.visible = false;
      this.placed = false;
      this.group.position.y = GROUND_Y;
      return;
    }
    const hop = Math.hypot(this.settledX - landingX, this.settledZ - landingZ);
    this.targetX = this.settledX;
    this.targetZ = this.settledZ;
    this.airborne = hop > 1.6;
    this.flightDistance = this.airborne ? Math.max(hop, 0.001) : 0;
    if (!this.airborne) this.group.position.y = GROUND_Y;
  }

  private stepGround(dt: number, figurines: Figurines | null, now: number): void {
    this.showGlow(true);
    const carrier = this.carrierId ? figurines?.where(this.carrierId) : null;
    if (carrier) {
      this.group.position.set(carrier.x, carrier.y + CARRIED_Y, carrier.z);
      this.airborne = false;
      return;
    }
    const dx = this.targetX - this.group.position.x;
    const dz = this.targetZ - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    const step = MOVE_SPEED * dt;
    if (distance <= step || distance < 0.0001) {
      this.group.position.x = this.targetX;
      this.group.position.z = this.targetZ;
      this.airborne = false;
    } else {
      this.group.position.x += (dx / distance) * step;
      this.group.position.z += (dz / distance) * step;
    }
    const along = this.airborne ? 1 - Math.min(1, distance / this.flightDistance) : 1;
    const arc = this.airborne ? Math.sin(along * Math.PI) * Math.min(2.4, this.flightDistance * 0.35) : 0;
    const bounce = ((Math.sin(now * 0.0022) + 1) / 2) * 0.08;
    this.group.position.y = GROUND_Y + bounce + arc;
  }

  private showGlow(onGround: boolean): void {
    if (this.glow) this.glow.visible = onGround;
  }

  private pulseFlame(now: number): void {
    const flicker = 0.85 + Math.sin(now * 0.028) * 0.15 + Math.sin(now * 0.061) * 0.08;
    if (this.flame) {
      this.flame.scale.set(flicker, 0.9 + flicker * 0.25, 1);
      const material = this.flame.material as MeshBasicMaterial;
      material.opacity = 0.75 + flicker * 0.2;
    }
    if (this.spark) {
      const spin = now * 0.01;
      this.spark.rotation.z = spin;
      this.spark.scale.setScalar(0.7 + flicker * 0.45);
    }
    if (this.glow) {
      const scale = 1 + Math.sin(now * 0.003) * 0.06;
      this.glow.scale.set(scale, scale, 1);
      this.glow.position.y = 0.04 - this.group.position.y;
    }
  }

  private build(): void {
    this.group.add(this.figure);

    const bodyMat = new MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.92, metalness: 0.05 });
    this.materials.push(bodyMat);
    const bodyGeom = new SphereGeometry(BODY_RADIUS, 24, 18);
    this.geometries.push(bodyGeom);
    const body = new Mesh(bodyGeom, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.figure.add(body);

    const face = this.facePlane();
    face.position.set(0, 0.02, BODY_RADIUS * 0.92);
    this.figure.add(face);

    const metal = new MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.45, metalness: 0.7 });
    this.materials.push(metal);
    const capGeom = new CylinderGeometry(0.055, 0.07, 0.045, 12);
    this.geometries.push(capGeom);
    const cap = new Mesh(capGeom, metal);
    cap.position.y = BODY_RADIUS + 0.01;
    cap.castShadow = true;
    this.figure.add(cap);

    const rivetGeom = new SphereGeometry(0.012, 8, 6);
    this.geometries.push(rivetGeom);
    for (const side of [-1, 1] as const) {
      const rivet = new Mesh(rivetGeom, metal);
      rivet.position.set(side * 0.04, BODY_RADIUS + 0.02, 0.045);
      this.figure.add(rivet);
    }

    this.figure.add(this.buildFuse());
    this.addLimb(-1);
    this.addLimb(1);
    this.addFeet();
    this.buildGlow();
  }

  private facePlane(): Mesh {
    const texture = faceTexture();
    this.textures.push(texture);
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.materials.push(material);
    const geometry = new PlaneGeometry(BODY_RADIUS * 1.35, BODY_RADIUS * 1.15);
    this.geometries.push(geometry);
    return new Mesh(geometry, material);
  }

  private buildFuse(): Group {
    const fuse = new Group();
    const rope = new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.95, metalness: 0 });
    this.materials.push(rope);
    const curve = new CatmullRomCurve3([
      new Vector3(0, BODY_RADIUS + 0.03, 0),
      new Vector3(0.02, BODY_RADIUS + 0.1, 0.02),
      new Vector3(0.06, BODY_RADIUS + 0.16, 0.01),
      new Vector3(0.1, BODY_RADIUS + 0.2, -0.01),
    ]);
    const tube = new TubeGeometry(curve, 12, 0.014, 6, false);
    this.geometries.push(tube);
    fuse.add(new Mesh(tube, rope));

    const tip = curve.getPoint(1);
    const flameMap = makeFlameTexture();
    this.textures.push(flameMap);
    const flameMat = new MeshBasicMaterial({
      map: flameMap,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.materials.push(flameMat);
    const flameGeom = new PlaneGeometry(0.1, 0.14);
    this.geometries.push(flameGeom);
    const flame = new Mesh(flameGeom, flameMat);
    flame.position.copy(tip).add(new Vector3(0.02, 0.05, 0));
    this.flame = flame;
    fuse.add(flame);

    const sparkMap = makeSparkTexture();
    this.textures.push(sparkMap);
    const sparkMat = new MeshBasicMaterial({
      map: sparkMap,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.materials.push(sparkMat);
    const sparkGeom = new PlaneGeometry(0.12, 0.12);
    this.geometries.push(sparkGeom);
    const spark = new Mesh(sparkGeom, sparkMat);
    spark.position.copy(flame.position);
    this.spark = spark;
    fuse.add(spark);

    return fuse;
  }

  private addLimb(side: -1 | 1): void {
    const armMat = new MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9, metalness: 0 });
    const gloveMat = new MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.85, metalness: 0 });
    this.materials.push(armMat, gloveMat);

    const armGeom = new CylinderGeometry(0.012, 0.014, 0.08, 6);
    this.geometries.push(armGeom);
    const arm = new Mesh(armGeom, armMat);
    arm.position.set(side * (BODY_RADIUS * 0.75), -0.02, 0.02);
    arm.rotation.z = side * MathUtils.degToRad(55);
    arm.rotation.x = MathUtils.degToRad(15);
    this.figure.add(arm);

    const palmGeom = new SphereGeometry(0.045, 10, 8);
    this.geometries.push(palmGeom);
    const palm = new Mesh(palmGeom, gloveMat);
    palm.position.set(side * (BODY_RADIUS * 0.95 + 0.04), -0.06, 0.05);
    palm.scale.set(1, 0.85, 1.1);
    this.figure.add(palm);

    const fingerGeom = new SphereGeometry(0.018, 6, 5);
    this.geometries.push(fingerGeom);
    for (let i = 0; i < 3; i += 1) {
      const finger = new Mesh(fingerGeom, gloveMat);
      const spread = (i - 1) * 0.028;
      finger.position.set(
        side * (BODY_RADIUS * 0.95 + 0.07),
        -0.05 + spread * 0.3,
        0.08 + Math.abs(spread) * 0.2,
      );
      finger.scale.set(0.7, 1.2, 0.7);
      this.figure.add(finger);
    }
  }

  private addFeet(): void {
    const shoe = new MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.9, metalness: 0 });
    this.materials.push(shoe);
    const footGeom = new SphereGeometry(0.05, 10, 8);
    this.geometries.push(footGeom);
    for (const side of [-1, 1] as const) {
      const foot = new Mesh(footGeom, shoe);
      foot.position.set(side * 0.07, -BODY_RADIUS * 0.85, 0.02);
      foot.scale.set(1.1, 0.65, 1.35);
      foot.castShadow = true;
      this.figure.add(foot);
    }
  }

  private buildGlow(): void {
    const texture = radialTexture([
      [0, 'rgba(255,160,40,0.9)'],
      [0.25, 'rgba(255,100,20,0.45)'],
      [0.55, 'rgba(200,40,0,0.15)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.textures.push(texture);
    const material = new MeshBasicMaterial({
      map: texture,
      color: 0xff8822,
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.materials.push(material);
    const geometry = new PlaneGeometry(0.9, 0.9);
    this.geometries.push(geometry);
    const glow = new Mesh(geometry, material);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    glow.renderOrder = 2;
    this.glow = glow;
    this.group.add(glow);
  }
}

function carrierOnSquare(game: GameJson, x: number, y: number): string | null {
  const field = game.fieldModel;
  if (!field || field.bombMoving) return null;
  for (const data of field.playerDataArray ?? []) {
    const coordinate = data.playerCoordinate;
    if (!coordinate || coordinate[0] !== x || coordinate[1] !== y) continue;
    const base = Number(data.playerState) & 0xff;
    if (base === BASE_STANDING || base === BASE_MOVING) return String(data.playerId);
  }
  return null;
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
