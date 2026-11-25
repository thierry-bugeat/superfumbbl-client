import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { Group, MathUtils, Mesh, Scene } from 'three';
import { squareToWorld } from '../coords';
import { BOMB_STAND_Y, createBombCharacter, pulseBombWick, type BombCharacter } from './bombFigure';
import { throwArcHeight, type Figurines } from './figurines';

const MOVE_SPEED = 6;
const BASE_STANDING = 0x01;
const BASE_MOVING = 0x02;
/** Au-dessus du socle, assez haut pour dépasser le numéro. */
const CARRIED_Y = 0.5;
const GROUND_Y = BOMB_STAND_Y;

/** Bombe Bob-omb (sphère, mèche allumée, gants), parabole comme le ballon. */
export class PitchBomb {
  private readonly group = new Group();
  private figure!: Group;
  private character: BombCharacter | null = null;
  private flame: Mesh | null = null;
  private spark: Mesh | null = null;
  private glow: Mesh | null = null;
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
    this.character?.dispose();
    this.character = null;
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
    pulseBombWick(now, this.flame, this.spark, this.glow, this.group.position.y);
  }

  private build(): void {
    const character = createBombCharacter();
    this.character = character;
    this.figure = character.figure;
    this.flame = character.flame;
    this.spark = character.spark;
    this.glow = character.glow;
    this.group.add(this.figure, this.glow);
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
