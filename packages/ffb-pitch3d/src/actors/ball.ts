import type { GameJson } from '@fumbbl40k/ffb-protocol';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
import { squareToWorld } from '../coords';
import type { Figurines } from './figurines';

const BALL_URL = new URL('../../assets/textures/ball.jpg', import.meta.url).href;
const MOVE_SPEED = 6;
const BASE_STANDING = 0x01;
const BASE_MOVING = 0x02;
const BEAM_HEIGHT = 3.2;
/** Au-dessus du socle, assez haut pour dépasser le numéro. */
const CARRIED_Y = 0.5;

const PROFILE = [
  new Vector2(0, -0.21),
  new Vector2(0.035, -0.19),
  new Vector2(0.065, -0.15),
  new Vector2(0.085, -0.1),
  new Vector2(0.098, -0.05),
  new Vector2(0.105, 0),
  new Vector2(0.098, 0.05),
  new Vector2(0.085, 0.1),
  new Vector2(0.065, 0.15),
  new Vector2(0.035, 0.19),
  new Vector2(0, 0.21),
];

/** Ballon ovale, rebond au sol et faisceau, comme dans SpikeBowl. */
export class PitchBall {
  private readonly group = new Group();
  private mesh: Mesh | null = null;
  private beam: Group | null = null;
  private glow: Mesh | null = null;
  private particles: Points | null = null;
  private beamMaterial: MeshBasicMaterial | null = null;
  private beamTexture: CanvasTexture | null = null;
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: { dispose(): void }[] = [];
  private readonly textures: { dispose(): void }[] = [];
  private targetX = 0;
  private targetZ = 0;
  private carrierId: string | null = null;
  /** Porteur lancé : on ignore la case du modèle tant qu'elle n'a pas rejoint l'arrivée. */
  private followId: string | null = null;
  private placed = false;
  private airborne = false;
  private flightDistance = 0;
  private lastTick = 0;
  /** Mêmes vitesses que SpikeBowl (ajoutées à chaque image), en radians par seconde. */
  private readonly spinX = MathUtils.randFloat(0.004, 0.008) * 60;
  private readonly spinY = MathUtils.randFloat(0.006, 0.012) * 60;
  private readonly spinZ = MathUtils.randFloat(0.003, 0.007) * 60;

  constructor(scene: Scene) {
    scene.add(this.group);
    this.group.visible = false;
  }

  async load(): Promise<void> {
    const texture = await new TextureLoader().loadAsync(BALL_URL);
    texture.colorSpace = SRGBColorSpace;
    this.textures.push(texture);
    const geometry = new LatheGeometry(PROFILE, 20);
    this.geometries.push(geometry);
    const material = new MeshStandardMaterial({ map: texture, roughness: 0.7, metalness: 0.05 });
    this.materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const maxTilt = MathUtils.degToRad(25);
    mesh.rotation.set(
      MathUtils.randFloatSpread(maxTilt * 2),
      Math.random() * Math.PI * 2,
      Math.PI / 2 + MathUtils.randFloatSpread(maxTilt * 2),
    );
    this.mesh = mesh;
    this.group.add(mesh);
    this.buildBeam();
  }

  /** Affiche le ballon sur sa case, ou le colle au porteur debout. */
  sync(game: GameJson): void {
    const field = game.fieldModel;
    const coordinate = field?.ballCoordinate;
    const onPitch = !!coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
    if (!onPitch || !coordinate) {
      this.followId = null;
      this.group.visible = false;
      this.placed = false;
      this.carrierId = null;
      return;
    }
    const world = squareToWorld(coordinate[0], coordinate[1]);
    if (this.followId && Math.hypot(world.x - this.targetX, world.z - this.targetZ) >= 0.2) {
      this.group.visible = true;
      this.placed = true;
      return;
    }
    this.followId = null;
    const carrier = carrierOnSquare(game, coordinate[0], coordinate[1]);
    const hop = Math.hypot(world.x - this.targetX, world.z - this.targetZ);
    this.targetX = world.x;
    this.targetZ = world.z;
    this.carrierId = carrier;
    this.airborne = !carrier && (field?.ballMoving === true || hop > 1.6);
    this.flightDistance = this.airborne ? Math.max(hop, 0.001) : 0;
    if (!this.placed) {
      this.group.position.set(world.x, carrier ? CARRIED_Y : 0.22, world.z);
      this.placed = true;
    }
    this.group.visible = true;
  }

  /**
   * Le ballon part avec le joueur lancé et vise la même arrivée, même si le modèle
   * ne déplace la balle qu'à la commande suivante.
   */
  followThrow(figurines: Figurines, id: string): void {
    const flight = figurines.flightOf(id);
    if (!flight) return;
    const atDeparture = Math.hypot(this.group.position.x - flight.startX, this.group.position.z - flight.startZ) < 0.75;
    const onPlayer = Math.hypot(this.group.position.x - flight.x, this.group.position.z - flight.z) < 0.75;
    if (!atDeparture && !onPlayer && this.followId !== id) return;
    this.followId = id;
    this.targetX = flight.targetX;
    this.targetZ = flight.targetZ;
    this.airborne = false;
    this.group.visible = true;
    this.placed = true;
  }

  tick(now: number, figurines: Figurines | null): void {
    if (!this.group.visible) return;
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const ride = this.followId ? figurines?.where(this.followId) : null;
    if (this.followId && ride) {
      this.group.position.set(ride.x, ride.y + CARRIED_Y, ride.z);
      this.airborne = false;
      if (!ride.flying) this.followId = null;
    } else {
      const carrier = this.carrierId ? figurines?.where(this.carrierId) : null;
      if (carrier) {
        this.group.position.set(carrier.x, carrier.y + CARRIED_Y, carrier.z);
        this.airborne = false;
      } else {
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
        this.group.position.y = 0.22 + bounce + arc;
      }
    }
    if (this.mesh) {
      this.mesh.rotation.x += this.spinX * dt;
      this.mesh.rotation.y += this.spinY * dt;
      this.mesh.rotation.z += this.spinZ * dt;
    }
    this.pulseBeam(now);
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

  private buildBeam(): void {
    const beamTexture = radialTexture([
      [0, 'rgba(120,180,255,1)'],
      [0.2, 'rgba(80,140,255,0.8)'],
      [0.5, 'rgba(30,80,255,0.4)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    beamTexture.wrapS = RepeatWrapping;
    beamTexture.wrapT = RepeatWrapping;
    this.beamTexture = beamTexture;
    this.textures.push(beamTexture);
    const alpha = verticalFade();
    this.textures.push(alpha);
    const material = new MeshBasicMaterial({
      map: beamTexture,
      alphaMap: alpha,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      color: 0x66aaff,
      opacity: 0.4,
    });
    this.materials.push(material);
    this.beamMaterial = material;
    const beam = new Group();
    const plane = new PlaneGeometry(0.9, BEAM_HEIGHT);
    this.geometries.push(plane);
    const front = new Mesh(plane, material);
    const side = new Mesh(plane, material);
    side.rotation.y = Math.PI / 2;
    beam.add(front, side);
    beam.position.y = BEAM_HEIGHT / 2;
    this.beam = beam;
    this.group.add(beam);

    const glowTexture = radialTexture([
      [0, 'rgba(180,220,255,0.95)'],
      [0.2, 'rgba(120,180,255,0.65)'],
      [0.5, 'rgba(70,120,255,0.3)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.textures.push(glowTexture);
    const glowMaterial = new MeshBasicMaterial({
      map: glowTexture,
      color: 0x66aaff,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.materials.push(glowMaterial);
    const glow = new Mesh(new CircleGeometry(1.2, 36), glowMaterial);
    this.geometries.push(glow.geometry);
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = 2;
    this.glow = glow;
    this.group.add(glow);

    const count = 10;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 0.8;
      positions[i * 3 + 1] = Math.random() * BEAM_HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometries.push(geometry);
    const pointsMaterial = new PointsMaterial({
      color: 0x88ccff,
      size: 0.08,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(pointsMaterial);
    this.particles = new Points(geometry, pointsMaterial);
    this.group.add(this.particles);
  }

  private pulseBeam(now: number): void {
    const wave = Math.sin(now * 0.003);
    if (this.beam) this.beam.scale.set(1 + wave * 0.12, 1, 1 + Math.cos(now * 0.004) * 0.12);
    if (this.beamTexture) this.beamTexture.offset.y = -now * 0.0004;
    if (this.beamMaterial) this.beamMaterial.opacity = 0.32 + (wave + 1) * 0.08;
    if (this.glow) {
      const scale = 1 + Math.sin(now * 0.002) * 0.04;
      this.glow.scale.set(scale, scale, 1);
      this.glow.position.y = 0.04 - this.group.position.y;
    }
    const attribute = this.particles?.geometry.getAttribute('position');
    const positions = attribute?.array as Float32Array | undefined;
    if (!positions) return;
    for (let i = 1; i < positions.length; i += 3) {
      const y = (positions[i] ?? 0) + 0.02;
      positions[i] = y > BEAM_HEIGHT ? 0 : y;
    }
    if (attribute) attribute.needsUpdate = true;
  }
}

function carrierOnSquare(game: GameJson, x: number, y: number): string | null {
  const field = game.fieldModel;
  if (!field?.ballInPlay || field.ballMoving) return null;
  for (const data of field.playerDataArray ?? []) {
    const coordinate = data.playerCoordinate;
    if (!coordinate || coordinate[0] !== x || coordinate[1] !== y) continue;
    const base = Number(data.playerState) & 0xff;
    if (base === BASE_STANDING || base === BASE_MOVING) return String(data.playerId);
  }
  return null;
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

function verticalFade(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 256, 0, 0);
    gradient.addColorStop(0, 'rgb(255,255,255)');
    gradient.addColorStop(0.5, 'rgb(255,255,255)');
    gradient.addColorStop(1, 'rgb(0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 8, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
