import {
  AnimationMixer,
  Box3,
  CanvasTexture,
  Group,
  LoopOnce,
  Mesh,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { edgeX, edgeZ, PITCH_COLUMNS, PITCH_ROWS } from '../coords';

/**
 * Robot expressif de l'exemple Three.js webgl_animation_skinning_morph.
 * Modèle de Tomás Laulhé, CC0, tel que distribué avec three.js r170.
 */
const MODEL_URL = new URL('../../assets/characters/RobotExpressive.glb', import.meta.url).href;

/** Taille debout, en unités de case. Les pieds restent au gazon. */
const SPECTATOR_HEIGHT = 1.15;
/** Hauteur monde de la bulle, queue comprise. */
const BUBBLE_HEIGHT = 0.78;

export const SPECTATOR_STATES = ['Idle', 'Dance', 'Death'] as const;
export type SpectatorState = (typeof SPECTATOR_STATES)[number];

export const SPECTATOR_EMOTES = ['Jump', 'Yes', 'No', 'Wave', 'Punch', 'ThumbsUp'] as const;
export type SpectatorEmote = (typeof SPECTATOR_EMOTES)[number];

const PLAY_ONCE = new Set<string>(['Death', ...SPECTATOR_EMOTES]);

interface Actor {
  index: number;
  holder: Group;
  model: Object3D;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  current: AnimationAction | null;
  emote: string | null;
}

/**
 * Un personnage par spectateur, juste après l'en-but away.
 * Le nombre vient du direct (`serverJoin` / `serverLeave`), pas du jet de foule du match.
 */
export class SpectatorCrowd {
  private readonly group = new Group();
  private prototype: Object3D | null = null;
  private clips: AnimationClip[] = [];
  private readonly actors: Actor[] = [];
  private readonly holders: Group[] = [];
  private readonly bubbleTextures = new Map<string, ComicBubble>();
  private bubble: Sprite | null = null;
  private bubbleMaterial: SpriteMaterial | null = null;
  private hoveredIndex: number | null = null;
  private ready = false;
  private pendingCount = 0;
  private pendingNames: string[] = [];
  private stateName: SpectatorState = 'Idle';
  /** Coach local, en minuscules. Seule sa figurine suit la console. */
  private selfKey = '';
  private lastNow: number | null = null;
  private headY = SPECTATOR_HEIGHT;
  private perRow = 8;
  private spacing = 1.15;
  private rowStep = 1.1;
  private frontInset = 0.75;

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  async load(): Promise<void> {
    if (this.ready || this.prototype) return;
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    this.prototype = gltf.scene;
    this.clips = gltf.animations;
    this.fit(this.prototype);
    this.ready = true;
    this.sync(this.pendingCount, this.pendingNames);
  }

  /** `names[i]` est le coach de la figurine i. Une liste plus longue ajoute des figurines. */
  sync(count: number, names: readonly string[]): void {
    this.pendingCount = Math.max(0, Math.floor(count));
    this.pendingNames = names.map((name) => name.trim());
    if (!this.ready) return;
    const total = Math.max(this.pendingCount, this.pendingNames.length);
    while (this.actors.length < total) this.add(this.actors.length);
    while (this.actors.length > total) {
      const actor = this.actors.pop();
      const holder = this.holders.pop();
      if (actor) this.release(actor);
      else holder?.removeFromParent();
    }
    for (let index = 0; index < this.actors.length; index += 1) {
      const holder = this.holders[index];
      if (!holder) continue;
      holder.userData.spectatorIndex = index;
      holder.userData.spectatorName = this.pendingNames[index] ?? '';
    }
    if (this.hoveredIndex != null && this.hoveredIndex >= this.holders.length) this.hoveredIndex = null;
    this.layout();
    this.retarget();
    this.placeBubble();
  }

  /** Le coach qui regarde. Les autres figurines restent au repos. */
  setSelf(name: string): void {
    this.selfKey = name.trim().toLowerCase();
    this.retarget();
  }

  state(): SpectatorState {
    return this.stateName;
  }

  /** Pose de fond du coach local. La mort joue une fois et reste au sol. */
  setState(state: SpectatorState): void {
    this.stateName = state;
    for (const actor of this.actors) {
      if (!this.mine(actor)) continue;
      actor.emote = null;
      this.crossfade(actor, state, 0.5, state === 'Death');
    }
  }

  /** Geste court du coach local, puis retour à sa pose. */
  playEmote(emote: SpectatorEmote): void {
    for (const actor of this.actors) {
      if (!this.mine(actor)) continue;
      actor.emote = emote;
      this.crossfade(actor, emote, 0.2, true);
    }
  }

  /** Figurines testées par le rayon du pointeur. */
  targets(): Group[] {
    return this.holders;
  }

  /** `index` null : le pointeur a quitté les figurines. Sans nom, pas de bulle. */
  hover(index: number | null): void {
    this.hoveredIndex = index;
    this.placeBubble();
  }

  tick(now: number): void {
    const previous = this.lastNow;
    this.lastNow = now;
    if (previous == null) return;
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    if (dt === 0) return;
    for (const actor of this.actors) actor.mixer.update(dt);
  }

  dispose(): void {
    this.hover(null);
    for (const actor of this.actors) this.release(actor);
    this.actors.length = 0;
    this.holders.length = 0;
    if (this.prototype) this.disposeTree(this.prototype);
    this.prototype = null;
    this.clips = [];
    this.ready = false;
    this.bubbleMaterial?.dispose();
    this.bubbleMaterial = null;
    this.bubble = null;
    for (const drawn of this.bubbleTextures.values()) drawn.texture.dispose();
    this.bubbleTextures.clear();
    this.group.removeFromParent();
  }

  private fit(root: Object3D): void {
    root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(root);
    const size = new Vector3();
    bounds.getSize(size);
    root.scale.setScalar(SPECTATOR_HEIGHT / Math.max(size.y, 0.001));
    root.updateMatrixWorld(true);
    const fitted = new Box3().setFromObject(root);
    root.position.y -= fitted.min.y;
    root.updateMatrixWorld(true);
    const stood = new Box3().setFromObject(root);
    stood.getSize(size);
    this.headY = stood.max.y;
    const span = edgeZ(PITCH_ROWS) - edgeZ(0) - 0.9;
    this.spacing = Math.max(size.x * 1.85, 1.15);
    this.perRow = Math.max(1, Math.floor(span / this.spacing));
    this.rowStep = Math.max(size.z * 1.35, 0.95);
    this.frontInset = size.z * 0.5 + 0.4;
  }

  private add(index: number): void {
    const source = this.prototype;
    if (!source) return;
    const model = cloneSkeleton(source);
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    const mixer = new AnimationMixer(model);
    const actions = new Map<string, AnimationAction>();
    for (const clip of this.clips) {
      const action = mixer.clipAction(clip);
      if (PLAY_ONCE.has(clip.name)) {
        action.clampWhenFinished = true;
        action.setLoop(LoopOnce, 1);
      }
      actions.set(clip.name, action);
    }
    const actor: Actor = { index, holder: new Group(), model, mixer, actions, current: null, emote: null };
    mixer.addEventListener('finished', (event) => {
      const clipName = event.action.getClip().name;
      if (!isEmote(clipName) || actor.emote !== clipName) return;
      actor.emote = null;
      this.crossfade(actor, this.poseFor(actor), 0.2, false);
    });
    actor.holder.add(model);
    const place = this.place(index);
    actor.holder.position.set(place.x, 0, place.z);
    actor.holder.rotation.y = -Math.PI / 2 + sway(index);
    this.group.add(actor.holder);
    this.actors.push(actor);
    this.holders.push(actor.holder);
    this.crossfade(actor, 'Idle', 0, false);
  }

  /** Le coach local prend la pose choisie. Les autres reviennent au repos, sans couper son geste. */
  private retarget(): void {
    for (const actor of this.actors) {
      if (this.mine(actor)) {
        if (actor.emote) continue;
        this.crossfade(actor, this.stateName, actor.current ? 0.35 : 0, false);
        continue;
      }
      actor.emote = null;
      this.crossfade(actor, 'Idle', actor.current ? 0.35 : 0, false);
    }
  }

  private mine(actor: Actor): boolean {
    if (!this.selfKey) return false;
    const name = typeof actor.holder.userData.spectatorName === 'string' ? actor.holder.userData.spectatorName : '';
    return name.trim().toLowerCase() === this.selfKey;
  }

  private poseFor(actor: Actor): SpectatorState {
    return this.mine(actor) ? this.stateName : 'Idle';
  }

  private crossfade(actor: Actor, name: string, duration: number, replay: boolean): void {
    const next = actor.actions.get(name);
    if (!next) return;
    if (!replay && actor.current === next) return;
    const previous = actor.current;
    if (previous && previous !== next) previous.fadeOut(duration);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (duration > 0) next.fadeIn(duration);
    next.play();
    if (name === 'Idle' || name === 'Dance') {
      const clipDuration = next.getClip().duration || 1;
      next.time = ((actor.index * 0.37) % 1) * clipDuration;
    }
    actor.current = next;
  }

  private release(actor: Actor): void {
    actor.mixer.stopAllAction();
    actor.mixer.uncacheRoot(actor.model);
    actor.holder.removeFromParent();
  }

  private disposeTree(root: Object3D): void {
    const materials = new Set<Material>();
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) materials.add(material);
    });
    for (const material of materials) {
      const textured = material as Material & Record<string, { isTexture?: boolean; dispose(): void } | null | undefined>;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        const texture = textured[key];
        if (texture?.isTexture) texture.dispose();
      }
      material.dispose();
    }
  }

  private layout(): void {
    for (let index = 0; index < this.actors.length; index += 1) {
      const holder = this.actors[index]?.holder;
      if (!holder) continue;
      const place = this.place(index);
      holder.position.x = place.x;
      holder.position.z = place.z;
    }
  }

  private place(index: number): { x: number; z: number } {
    const total = Math.max(this.pendingCount, this.pendingNames.length, 1);
    const row = Math.floor(index / this.perRow);
    const col = index % this.perRow;
    const inRow = Math.min(this.perRow, total - row * this.perRow);
    const margin = 0.45;
    const z0 = edgeZ(0) + margin;
    const z1 = edgeZ(PITCH_ROWS) - margin;
    const span = Math.max(z1 - z0, 0);
    const step = inRow <= 1 ? 0 : Math.min(this.spacing, span / Math.max(inRow - 1, 1));
    const stagger = row % 2 ? step * 0.45 : 0;
    const z = Math.min(z1, Math.max(z0, -((inRow - 1) * step) / 2 + col * step + stagger));
    return { x: edgeX(PITCH_COLUMNS) + this.frontInset + row * this.rowStep, z };
  }

  private placeBubble(): void {
    const holder = this.hoveredIndex == null ? null : this.holders[this.hoveredIndex];
    const name = typeof holder?.userData.spectatorName === 'string' ? holder.userData.spectatorName : '';
    if (!holder || !name) {
      this.bubble?.removeFromParent();
      return;
    }
    const drawn = this.bubbleArt(name);
    const bubble = this.ensureBubble();
    const material = bubble.material as SpriteMaterial;
    if (material.map !== drawn.texture) {
      material.map = drawn.texture;
      material.needsUpdate = true;
    }
    bubble.scale.set(BUBBLE_HEIGHT * drawn.aspect, BUBBLE_HEIGHT, 1);
    bubble.position.set(0, this.headY + 0.12, 0);
    holder.add(bubble);
  }

  private ensureBubble(): Sprite {
    if (this.bubble) return this.bubble;
    const material = new SpriteMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const bubble = new Sprite(material);
    bubble.center.set(0.5, 0);
    bubble.raycast = () => {};
    bubble.renderOrder = 12;
    this.bubble = bubble;
    this.bubbleMaterial = material;
    return bubble;
  }

  private bubbleArt(name: string): ComicBubble {
    const cached = this.bubbleTextures.get(name);
    if (cached) return cached;
    const drawn = drawComicBubble(name);
    this.bubbleTextures.set(name, drawn);
    return drawn;
  }
}

function isEmote(name: string): name is SpectatorEmote {
  return (SPECTATOR_EMOTES as readonly string[]).includes(name);
}

function sway(index: number): number {
  const n = Math.sin(index * 12.9898) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 0.22;
}

interface ComicBubble {
  texture: CanvasTexture;
  aspect: number;
}

const BUBBLE_FONT = '700 46px "Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive';

/** Ovale blanc, contour encré, queue vers la figurine. */
function drawComicBubble(name: string): ComicBubble {
  const probe = document.createElement('canvas').getContext('2d');
  let textWidth = name.length * 26;
  if (probe) {
    probe.font = BUBBLE_FONT;
    textWidth = Math.ceil(probe.measureText(name).width);
  }
  const padX = 36;
  const bodyH = 78;
  const tailH = 28;
  const tailW = 16;
  const line = 8;
  const width = Math.max(148, textWidth + padX * 2);
  const height = bodyH + tailH + line;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (context) {
    context.scale(scale, scale);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    balloonPath(context, line / 2, line / 2, width - line, bodyH - line / 2, 28, tailW, tailH);
    context.fillStyle = '#fffdf6';
    context.fill();
    context.lineWidth = line;
    context.strokeStyle = '#161616';
    context.stroke();
    context.font = BUBBLE_FONT;
    context.fillStyle = '#161616';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, width / 2, bodyH * 0.48);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}

function balloonPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  bottom: number,
  radius: number,
  tailW: number,
  tailH: number,
): void {
  const right = x + width;
  const center = x + width / 2;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(center + tailW, bottom);
  context.lineTo(center, bottom + tailH);
  context.lineTo(center - tailW, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
