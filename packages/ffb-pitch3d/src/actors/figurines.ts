import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS, squareToWorld, TILE_SIZE } from '../coords';
import { plateRect, type PlateRect } from './atlases';
import { loadWalkStrip, walkSheetUrl, type WalkFace } from './walkPlates';

const HOME_COLOR = 0x1a58ff;
const AWAY_COLOR = 0xd74646;
const PAWN_HEIGHT = 0.08;
const BASE_STATE_PRONE = 0x03;
const BASE_STATE_STUNNED = 0x04;
const BASE_STATE_KNOCKED_OUT = 0x05;
const BASE_STATE_BADLY_HURT = 0x06;
const BASE_STATE_SERIOUS_INJURY = 0x07;
const BASE_STATE_RIP = 0x08;
const BASE_STATE_IN_AIR = 0x15;
const FLAG_ACTIVE = 0x100;
/** Réserves au plus près de la touche, puis KO, puis blessés. */
const DUGOUT_FILE_OFFSET = { reserve: 0, ko: 1, casualty: 2 } as const;

interface Actor {
  id: string;
  root: Group;
  plate: Group;
  lie: Group;
  labelMesh: Mesh;
  plateWidth: number;
  plateHeight: number;
  pawnTop: number;
  pawnRadius: number;
  lockFacing: boolean;
  lying: boolean;
  label: Texture;
  maps: Texture[];
  skillGroup: Group;
  injury: Mesh | null;
  badgeKey: string;
  badgeToken: number;
  targetX: number;
  targetZ: number;
  targetScale: number;
  groundY: number;
  landingProne: boolean;
  landingStunned: boolean;
  /** Lancer ou botté : origine du vol. Null une fois retombé. */
  flight: { startX: number; startZ: number; height: number } | null;
  walk: WalkCycle | null;
}

const MOVE_SPEED = 6;
/** Cinq images par seconde : à 10, le cycle défile avant qu'on voie le pas. */
const WALK_FRAME_MS = 200;
/** Même lob que le renvoi du public dans FoulBall : 4·h·t·(1−t), h selon la distance. */
const FLIGHT_ARC_BASE = 1.6;
const FLIGHT_ARC_PER_TILE = 0.48;
const FLIGHT_ARC_MAX = 7.5;

function flightHeight(distance: number): number {
  return Math.min(FLIGHT_ARC_MAX, FLIGHT_ARC_BASE + distance * FLIGHT_ARC_PER_TILE);
}

/** Le modèle rattrape le vol. Tant qu'il est encore au départ, la cible du lancer reste. */
function adoptPlace(actor: Actor, place: Placement): void {
  if (!actor.flight) {
    actor.targetX = place.x;
    actor.targetZ = place.z;
    actor.root.position.y = place.y;
    pose(actor, place.prone, place.stunned);
    return;
  }
  const atStart = Math.hypot(place.x - actor.flight.startX, place.z - actor.flight.startZ) < 0.2;
  if (!place.inAir && atStart) {
    actor.flight = null;
    actor.targetX = place.x;
    actor.targetZ = place.z;
    actor.root.position.y = place.y;
    pose(actor, place.prone, place.stunned);
    return;
  }
  if (!atStart) {
    actor.targetX = place.x;
    actor.targetZ = place.z;
    actor.flight.height = flightHeight(Math.hypot(place.x - actor.flight.startX, place.z - actor.flight.startZ));
  }
  pose(actor, false, false);
}

/** Socle, plaque face/dos et numéro, comme les figurines SpikeBowl. */
export class Figurines {
  private readonly group = new Group();
  private readonly actors = new Map<string, Actor>();
  private readonly pawnGeometry = new CylinderGeometry(1, 1, PAWN_HEIGHT, 20);
  private readonly plateGeometry = new PlaneGeometry(1, 1);
  private readonly markerGeometry = new CylinderGeometry(0.46, 0.46, PAWN_HEIGHT / 2, 20);
  private readonly iconGeometry = new PlaneGeometry(1, 1);
  private readonly injuryGeometry = new PlaneGeometry(0.42, 0.42);
  private readonly injuryMaterial: MeshBasicMaterial;
  private readonly injuryTexture: CanvasTexture;
  private readonly iconTextures = new Map<string, Texture>();
  private readonly iconLoader = new TextureLoader();
  private readonly badges = new Map<string, readonly string[]>();
  private lastTick = 0;

  constructor(scene: Scene) {
    this.injuryTexture = injuryIconTexture();
    this.injuryMaterial = new MeshBasicMaterial({
      map: this.injuryTexture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    scene.add(this.group);
  }

  sync(game: GameJson, surfaceY: number): void {
    const placed = placements(game, surfaceY);
    const seen = new Set<string>();
    for (const place of placed) {
      seen.add(place.id);
      const existing = this.actors.get(place.id);
      if (!existing || existing.root.userData.signature !== place.signature) {
        const from = existing?.root.position;
        const flight = existing?.flight ? { ...existing.flight } : null;
        const aim = existing ? { x: existing.targetX, z: existing.targetZ } : null;
        existing?.root.removeFromParent();
        if (existing) disposeActor(existing);
        const actor = this.build(place);
        if (from) actor.root.position.set(from.x, from.y, from.z);
        if (flight && aim) {
          actor.flight = flight;
          actor.targetX = aim.x;
          actor.targetZ = aim.z;
        }
        adoptPlace(actor, place);
        this.actors.set(place.id, actor);
        this.group.add(actor.root);
      } else {
        existing.targetScale = place.scale;
        existing.groundY = place.y;
        existing.landingProne = place.prone;
        existing.landingStunned = place.stunned;
        adoptPlace(existing, place);
      }
      const actor = this.actors.get(place.id);
      if (!actor) continue;
      this.ensureInjury(actor, place.injury);
      this.applyBadges(actor);
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue;
      actor.root.removeFromParent();
      disposeActor(actor);
      this.actors.delete(id);
    }
  }

  /**
   * Parabole depuis la position visible jusqu'à la case du lancer.
   * Un second ordre pendant le vol allonge la courbe sans changer l'origine.
   */
  flyTo(id: string, x: number, z: number): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.targetX = x;
    actor.targetZ = z;
    const originX = actor.flight?.startX ?? actor.root.position.x;
    const originZ = actor.flight?.startZ ?? actor.root.position.z;
    const distance = Math.hypot(x - originX, z - originZ);
    if (!actor.flight) {
      if (distance < 0.2) return;
      actor.flight = { startX: actor.root.position.x, startZ: actor.root.position.z, height: flightHeight(distance) };
      pose(actor, false, false);
      return;
    }
    actor.flight.height = flightHeight(distance);
    pose(actor, false, false);
  }

  /** Glisse vers la case cible. Une case dure environ un sixième de seconde. */
  tick(now: number): void {
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const step = MOVE_SPEED * dt;
    for (const actor of this.actors.values()) {
      const dx = actor.targetX - actor.root.position.x;
      const dz = actor.targetZ - actor.root.position.z;
      const distance = Math.hypot(dx, dz);
      const moving = distance > step && distance >= 0.0001;
      if (!moving) {
        actor.root.position.x = actor.targetX;
        actor.root.position.z = actor.targetZ;
        if (actor.flight) {
          actor.root.position.y = actor.groundY;
          actor.flight = null;
          pose(actor, actor.landingProne, actor.landingStunned);
        }
      } else {
        actor.root.position.x += (dx / distance) * step;
        actor.root.position.z += (dz / distance) * step;
        const flight = actor.flight;
        if (flight) {
          const total = Math.hypot(actor.targetX - flight.startX, actor.targetZ - flight.startZ);
          const traveled = Math.hypot(actor.root.position.x - flight.startX, actor.root.position.z - flight.startZ);
          const t = total <= 0.0001 ? 1 : Math.min(1, traveled / total);
          actor.root.position.y = actor.groundY + 4 * flight.height * t * (1 - t);
        }
      }
      stepWalk(actor, moving && !actor.flight, now);
      const scale = actor.root.scale.x + (actor.targetScale - actor.root.scale.x) * Math.min(1, dt * 8);
      actor.root.scale.setScalar(scale);
    }
  }

  /** Racines des figurines, pour le survol à la souris. */
  roots(): Object3D[] {
    return [...this.actors.values()].map((actor) => actor.root);
  }

  /** Position déjà interpolée et orientation de la plaque, pour coller le ballon au porteur. */
  where(id: string): { x: number; y: number; z: number; yaw: number; flying: boolean } | null {
    const actor = this.actors.get(id);
    if (!actor) return null;
    return {
      x: actor.root.position.x,
      y: actor.root.position.y,
      z: actor.root.position.z,
      yaw: actor.plate.rotation.y,
      flying: actor.flight !== null,
    };
  }

  /** Vol en cours : départ, position actuelle et case visée. */
  flightOf(id: string): { startX: number; startZ: number; x: number; z: number; targetX: number; targetZ: number } | null {
    const actor = this.actors.get(id);
    if (!actor?.flight) return null;
    return {
      startX: actor.flight.startX,
      startZ: actor.flight.startZ,
      x: actor.root.position.x,
      z: actor.root.position.z,
      targetX: actor.targetX,
      targetZ: actor.targetZ,
    };
  }

  face(camera: PerspectiveCamera): void {
    for (const actor of this.actors.values()) {
      const dx = camera.position.x - actor.root.position.x;
      const dz = camera.position.z - actor.root.position.z;
      const look = Math.atan2(dx, dz);
      if (!actor.lockFacing) actor.plate.rotation.y = look;
      if (actor.injury) actor.injury.rotation.y = look;
      const yaw = actor.plate.rotation.y;
      // Bas du carré aligné sur le haut du socle, face caméra.
      const labelSize = actor.labelMesh.scale.y;
      actor.labelMesh.position.set(
        Math.sin(yaw) * (actor.pawnRadius + 0.02),
        actor.pawnTop + labelSize / 2,
        Math.cos(yaw) * (actor.pawnRadius + 0.02),
      );
      actor.labelMesh.rotation.y = yaw;
      const skills = actor.skillGroup;
      skills.rotation.y = yaw;
      skills.position.y = actor.pawnTop + actor.plateHeight + 0.05;
    }
  }

  /** Icônes au-dessus de la tête. `urls` vide retire la rangée. */
  setSkillBadges(badges: ReadonlyMap<string, readonly string[]>): void {
    this.badges.clear();
    for (const [id, urls] of badges) this.badges.set(id, urls);
    for (const actor of this.actors.values()) this.applyBadges(actor);
  }

  private applyBadges(actor: Actor): void {
    const urls = (this.badges.get(actor.id) ?? []).slice(0, 8);
    const key = urls.join('|');
    if (actor.badgeKey === key) return;
    actor.badgeKey = key;
    const token = actor.badgeToken + 1;
    actor.badgeToken = token;
    clearSkillMeshes(actor.skillGroup);
    if (urls.length === 0) return;
    void this.mountBadges(actor, urls, token);
  }

  private async mountBadges(actor: Actor, urls: readonly string[], token: number): Promise<void> {
    const textures = await Promise.all(urls.map((url) => this.iconTexture(url)));
    if (actor.badgeToken !== token) return;
    clearSkillMeshes(actor.skillGroup);
    const icons = textures.filter((texture): texture is Texture => texture !== null);
    if (icons.length === 0) return;
    const size = 0.26;
    const gap = 0.02;
    const perRow = 4;
    icons.forEach((texture, index) => {
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      const rowLength = Math.min(perRow, icons.length - row * perRow);
      const rowWidth = rowLength * size + (rowLength - 1) * gap;
      const mesh = new Mesh(this.iconGeometry, new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }));
      mesh.scale.set(size, size, 1);
      mesh.position.set(-rowWidth / 2 + size / 2 + col * (size + gap), row * (size + gap) + size / 2, 0);
      mesh.raycast = () => {};
      mesh.renderOrder = 3;
      actor.skillGroup.add(mesh);
    });
  }

  private async iconTexture(url: string): Promise<Texture | null> {
    const cached = this.iconTextures.get(url);
    if (cached) return cached;
    try {
      const texture = await this.iconLoader.loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      this.iconTextures.set(url, texture);
      return texture;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const actor of this.actors.values()) disposeActor(actor);
    this.actors.clear();
    this.pawnGeometry.dispose();
    this.plateGeometry.dispose();
    this.markerGeometry.dispose();
    this.iconGeometry.dispose();
    this.injuryGeometry.dispose();
    this.injuryMaterial.dispose();
    this.injuryTexture.dispose();
    for (const texture of this.iconTextures.values()) texture.dispose();
    this.iconTextures.clear();
    this.group.removeFromParent();
  }

  private build(place: Placement): Actor {
    const root = new Group();
    root.position.set(place.x, place.y, place.z);
    root.scale.setScalar(place.scale);
    root.userData.signature = place.signature;
    root.userData.playerId = place.id;
    const radius = pawnRadius(place.strength);
    const pawn = new Mesh(this.pawnGeometry, new MeshStandardMaterial({ color: place.color, roughness: 0.45, metalness: 0.08 }));
    pawn.scale.set(radius, 1, radius);
    pawn.position.y = 0.12;
    pawn.castShadow = true;
    root.add(pawn);
    if (place.active) {
      const marker = new Mesh(this.markerGeometry, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
      marker.position.y = 0.06;
      root.add(marker);
    }
    const plate = new Group();
    const lie = new Group();
    const front = plateRect(place.race, place.positionName, 'front');
    const back = plateRect(place.race, place.positionName, 'back');
    const width = front?.width ?? 0.7;
    const height = front?.height ?? 1.2;
    const maps: Texture[] = [];
    const frontMesh = this.faceMesh(front, place.color, width, height, 'front', maps);
    const backMesh = this.faceMesh(back, place.color, width, height, 'back', maps);
    lie.add(frontMesh, backMesh);
    const label = numberLabel(place.number);
    const labelSize = Math.min(0.36, Math.max(0.18, radius * 0.85));
    const labelMesh = new Mesh(this.plateGeometry, new MeshBasicMaterial({ map: label, transparent: true, depthWrite: false, toneMapped: false }));
    labelMesh.scale.set(labelSize, labelSize, 1);
    labelMesh.position.y = pawn.position.y + PAWN_HEIGHT / 2 + labelSize / 2;
    labelMesh.raycast = () => {};
    root.add(labelMesh);
    const skillGroup = new Group();
    skillGroup.position.y = pawn.position.y + PAWN_HEIGHT / 2 + height + 0.05;
    root.add(skillGroup);
    plate.add(lie);
    root.add(plate);
    const pawnTop = pawn.position.y + PAWN_HEIGHT / 2;
    const actor: Actor = {
      id: place.id,
      root,
      plate,
      lie,
      labelMesh,
      plateWidth: width,
      plateHeight: height,
      pawnTop,
      pawnRadius: radius,
      lockFacing: false,
      lying: false,
      label,
      maps,
      skillGroup,
      injury: null,
      badgeKey: '',
      badgeToken: 0,
      targetX: place.x,
      targetZ: place.z,
      targetScale: place.scale,
      groundY: place.y,
      landingProne: place.prone,
      landingStunned: place.stunned,
      flight: null,
      walk: null,
    };
    pose(actor, place.prone, place.stunned);
    this.ensureInjury(actor, place.injury);
    if (!front) this.dressFromWalk(actor, frontMesh, backMesh, place);
    return actor;
  }

  /** Croix rouge au-dessus d'un blessé, comme sur le banc de SpikeBowl. */
  private ensureInjury(actor: Actor, show: boolean): void {
    if (show === (actor.injury !== null)) return;
    actor.injury?.removeFromParent();
    actor.injury = null;
    if (!show) return;
    const mesh = new Mesh(this.injuryGeometry, this.injuryMaterial);
    mesh.userData.sharedMaterial = true;
    mesh.position.y = 1.08;
    mesh.raycast = () => {};
    actor.root.add(mesh);
    actor.injury = mesh;
  }

  /** Sans atlas illustré : sud et nord de la feuille de marche, sinon la plaque de couleur reste. */
  private dressFromWalk(actor: Actor, frontMesh: Mesh, backMesh: Mesh, place: Placement): void {
    const url = walkSheetUrl(place.race, place.positionName, place.home);
    if (!url) return;
    const token = {};
    actor.root.userData.walkToken = token;
    void loadWalkStrip(url).then((strip) => {
      if (!strip || actor.root.userData.walkToken !== token || !actor.root.parent) return;
      const idle = strip.frames[0];
      if (!idle) return;
      const height = Math.max(idle.height, strip.back.height);
      const frames = strip.frames.map((face) => walkTexture(face.canvas));
      for (const texture of frames) actor.maps.push(texture);
      paintWalkFace(frontMesh, idle, height, frames[0] ?? null);
      paintWalkFace(backMesh, strip.back, height, walkTexture(strip.back.canvas));
      const backMap = (backMesh.material as MeshBasicMaterial).map;
      if (backMap) actor.maps.push(backMap);
      actor.plateWidth = idle.width * (height / idle.height);
      actor.plateHeight = height;
      actor.walk = { frames, column: 0, started: null };
      pose(actor, actor.flight ? false : place.prone, actor.flight ? false : place.stunned);
    });
  }

  private faceMesh(rect: PlateRect | null, color: number, width: number, height: number, side: 'front' | 'back', maps: Texture[]): Mesh {
    const material = rect
      ? new MeshBasicMaterial({ map: clonedMap(rect, maps), transparent: true, alphaTest: 0.2, side: FrontSide })
      : new MeshBasicMaterial({ color, side: DoubleSide });
    const mesh = new Mesh(this.plateGeometry, material);
    mesh.scale.set(width, height, 1);
    mesh.position.z = side === 'back' ? -0.001 : 0.001;
    if (side === 'back') mesh.rotation.y = Math.PI;
    mesh.castShadow = true;
    return mesh;
  }
}

interface Placement {
  id: string;
  number: number;
  strength: number;
  race: string;
  positionName: string;
  home: boolean;
  color: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  prone: boolean;
  stunned: boolean;
  injury: boolean;
  inAir: boolean;
  active: boolean;
  signature: string;
}

function placements(game: GameJson, surfaceY: number): Placement[] {
  const out: Placement[] = [];
  placeTeam(out, game.teamHome, game, true, surfaceY);
  placeTeam(out, game.teamAway, game, false, surfaceY);
  return out;
}

function placeTeam(out: Placement[], team: TeamJson | undefined, game: GameJson, home: boolean, surfaceY: number): void {
  if (!team) return;
  const byId = new Map<string, PlayerJson>();
  for (const player of team.playerArray ?? []) byId.set(String(player.playerId), player);
  let dugout = { reserve: 0, ko: 0, casualty: 0 };
  for (const data of game.fieldModel?.playerDataArray ?? []) {
    const player = byId.get(String(data.playerId));
    if (!player) continue;
    const coordinate = data.playerCoordinate;
    const state = Number(data.playerState) || 0;
    const base = state & 0xff;
    const onPitch = !!coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
    const file = benchFile(base);
    const world = onPitch
      ? squareToWorld(coordinate[0], coordinate[1])
      : dugoutSpot(home, file, dugout[file]++);
    const positionName = positionNameOf(team, player);
    out.push({
      id: String(player.playerId),
      number: Number(player.playerNr) || 0,
      strength: Number(player.strength) || 3,
      race: String(team.race ?? ''),
      positionName,
      home,
      color: home ? HOME_COLOR : AWAY_COLOR,
      x: world.x,
      y: surfaceY,
      z: world.z,
      scale: 1,
      prone: onPitch && base === BASE_STATE_PRONE,
      stunned: onPitch ? base === BASE_STATE_STUNNED : file !== 'reserve',
      injury: !onPitch && file === 'casualty',
      inAir: onPitch && base === BASE_STATE_IN_AIR,
      active: onPitch && (state & FLAG_ACTIVE) !== 0,
      signature: `${positionName}|${player.playerNr}|${home ? 1 : 0}|${onPitch && (state & FLAG_ACTIVE) !== 0 ? 1 : 0}`,
    });
  }
}

/** Un pas hors de la ligne de touche. Réserves, KO et blessés ont chacun leur file. */
const DUGOUT_GAP = 1;

type DugoutFile = keyof typeof DUGOUT_FILE_OFFSET;

/**
 * Même taille que sur le terrain, en file le long de la longueur.
 * Vue d'ensemble : home part du bas à gauche, away du haut à droite.
 * Les KO sont une file plus loin que les réserves, les blessés encore une de plus.
 */
function dugoutSpot(home: boolean, file: DugoutFile, index: number): { x: number; z: number } {
  const along = index % PITCH_COLUMNS;
  const rank = Math.floor(index / PITCH_COLUMNS);
  const x = home
    ? edgeX(along) + TILE_SIZE / 2
    : edgeX(PITCH_COLUMNS - along) - TILE_SIZE / 2;
  const out = DUGOUT_GAP + DUGOUT_FILE_OFFSET[file] + rank * 3;
  return { x, z: home ? edgeZ(0) - out : edgeZ(PITCH_ROWS) + out };
}

function benchFile(base: number): DugoutFile {
  if (base === BASE_STATE_KNOCKED_OUT) return 'ko';
  if (base === BASE_STATE_BADLY_HURT || base === BASE_STATE_SERIOUS_INJURY || base === BASE_STATE_RIP) return 'casualty';
  return 'reserve';
}

function injuryIconTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 96, 96);
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.beginPath();
    context.arc(48, 48, 40, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#d82020';
    context.fillRect(39, 22, 18, 52);
    context.fillRect(22, 39, 52, 18);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function positionNameOf(team: TeamJson, player: PlayerJson): string {
  const positions = (team.roster as { positionArray?: { positionId?: string; positionName?: string }[] } | undefined)?.positionArray;
  const found = positions?.find((entry) => String(entry.positionId) === String(player.positionId));
  return found?.positionName || String(player.positionId ?? '');
}

function pawnRadius(strength: number): number {
  if (strength <= 1) return 0.3;
  if (strength === 2) return 0.34;
  if (strength === 3) return 0.38;
  if (strength === 4) return 0.42;
  if (strength === 5) return 0.46;
  if (strength >= 6) return 0.48;
  return 0.4;
}

function pose(actor: Actor, prone: boolean, stunned: boolean): void {
  actor.lockFacing = stunned;
  actor.lying = prone || stunned;
  const { pawnTop, plateWidth, plateHeight } = actor;
  if (stunned) {
    actor.plate.position.y = pawnTop + 0.02;
    actor.plate.rotation.x = Math.PI / 2;
    actor.plate.rotation.y = 0;
    actor.lie.rotation.z = 0;
    return;
  }
  actor.plate.rotation.x = 0;
  if (prone) {
    actor.plate.position.y = pawnTop + plateWidth / 2;
    actor.lie.rotation.z = Math.PI / 2;
    return;
  }
  actor.plate.position.y = pawnTop + plateHeight / 2;
  actor.lie.rotation.z = 0;
}

function clearSkillMeshes(group: Group): void {
  for (const child of [...group.children]) {
    const mesh = child as Mesh;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
    child.removeFromParent();
  }
}

function numberLabel(number: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = '#111111';
    context.fillRect(4, 4, 56, 56);
    context.fillStyle = '#ffffff';
    context.font = 'bold 28px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(number || '?'), 32, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface WalkCycle {
  frames: CanvasTexture[];
  column: number;
  started: number | null;
}

function walkTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function paintWalkFace(mesh: Mesh, face: WalkFace, height: number, map: CanvasTexture | null): void {
  const texture = map ?? walkTexture(face.canvas);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: FrontSide });
  const previous = mesh.material;
  mesh.material = material;
  mesh.scale.set(face.width * (height / face.height), height, 1);
  if (!Array.isArray(previous)) previous.dispose();
}

/** Colonnes 2 à 9 pendant le glissement, colonne 1 à l'arrêt. */
function stepWalk(actor: Actor, moving: boolean, now: number): void {
  const walk = actor.walk;
  if (!walk || walk.frames.length < 2) return;
  const material = actor.lie.children[0] as Mesh | undefined;
  const basic = material?.material;
  if (!material?.isMesh || !(basic instanceof MeshBasicMaterial) || !basic.map) return;
  let column = 0;
  if (moving && !actor.lying) {
    if (walk.started == null) walk.started = now;
    column = 1 + Math.floor((now - walk.started) / WALK_FRAME_MS) % (walk.frames.length - 1);
  } else {
    walk.started = null;
  }
  if (column === walk.column) return;
  walk.column = column;
  basic.map = walk.frames[column] ?? basic.map;
}

function clonedMap(rect: PlateRect, maps: Texture[]): Texture {
  const map = rect.texture.clone();
  map.colorSpace = SRGBColorSpace;
  map.image = rect.texture.image;
  map.repeat.set(rect.repeatX, rect.repeatY);
  map.offset.set(rect.offsetX, rect.offsetY);
  map.needsUpdate = true;
  maps.push(map);
  return map;
}

function disposeActor(actor: Actor): void {
  actor.label.dispose();
  for (const map of actor.maps) map.dispose();
  actor.root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.userData.sharedMaterial) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
