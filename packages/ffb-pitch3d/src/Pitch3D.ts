import type { GameJson } from '@fumbbl40k/ffb-protocol';
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyCameraPreset, type CameraPreset } from './camera/presets';
import { getDescentPolarAngle, HORIZONTAL_POLAR_RAD, TOP_DOWN_POLAR_RAD } from './camera/descent';
import { squareToWorld } from './coords';
import { PitchFog } from './environment/fog';
import { createPitchGround, type PitchGroundHandle } from './environment/pitchGround';
import { SkyDome } from './environment/skyDome';
import { PitchHouse } from './environment/house';
import { Figurines } from './actors/figurines';
import { TackleZones } from './actors/tackleZones';
import { PitchBall } from './actors/ball';
import { BlockDice, type BlockDiceSpec } from './actors/blockDice';
import { NumberDice, type NumberDiceSpec } from './actors/numberDice';
import { disposeAtlases, loadAtlases } from './actors/atlases';
import { pitchWeatherKey, WEATHER, type WeatherKey } from './weather';

export interface PitchDiagnostics {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export class Pitch3D {
  private host: HTMLElement | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private readonly cameraStart = new Vector3(-24, 32, 0);
  private sun: DirectionalLight | null = null;
  private hemi: HemisphereLight | null = null;
  private fog: PitchFog | null = null;
  private ground: PitchGroundHandle | null = null;
  private sky: SkyDome | null = null;
  private house: PitchHouse | null = null;
  private figurines: Figurines | null = null;
  private tackleZones: TackleZones | null = null;
  private tackleZonesOn = false;
  private lineup: GameJson | null = null;
  private ball: PitchBall | null = null;
  private blockDice: BlockDice | null = null;
  private numberDice: NumberDice | null = null;
  private surfaceY = 0;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private weather: WeatherKey | null = null;
  private fps = 0;
  private frames = 0;
  private fpsStamp = 0;
  private readonly keys = new Set<string>();
  private lastCameraTick = 0;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  async init(host: HTMLElement): Promise<void> {
    if (this.renderer) this.destroy();
    this.host = host;
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 400);
    camera.position.copy(this.cameraStart);
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 6;
    controls.maxDistance = 42;
    controls.minPolarAngle = TOP_DOWN_POLAR_RAD;
    controls.maxPolarAngle = HORIZONTAL_POLAR_RAD;
    controls.update();

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;

    this.hemi = new HemisphereLight(0xb6ddff, 0x22331f, 0.85);
    this.sun = new DirectionalLight(0xfff8f0, 1.75);
    this.sun.position.set(18, 28, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.camera.left = -30;
    this.sun.shadow.camera.right = 30;
    this.sun.shadow.camera.top = 24;
    this.sun.shadow.camera.bottom = -24;
    scene.add(this.hemi, this.sun);

    this.fog = new PitchFog(scene, camera);
    this.fog.init();

    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.ground = await createPitchGround(anisotropy);
    scene.add(this.ground.mesh);

    this.sky = new SkyDome();
    await this.sky.load(120);
    scene.add(this.sky.group);

    this.house = new PitchHouse();
    await this.house.load();
    scene.add(this.house.group);
    this.figurines = new Figurines(scene);
    this.tackleZones = new TackleZones(scene);
    this.ball = new PitchBall(scene);
    this.blockDice = new BlockDice(scene);
    this.numberDice = new NumberDice(scene);
    await Promise.all([loadAtlases(anisotropy), this.ball.load(), this.blockDice.load(anisotropy)]);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.bindKeys();
    this.weather = null;
    this.presentWeather('nice');
    applyCameraPreset('overview', camera, controls, this.cameraStart);
    this.fpsStamp = performance.now();
    renderer.render(scene, camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  /** Météo, figurines et ballon. Un état sans joueurs (bouton météo) ne retire personne. */
  present(game: GameJson): void {
    const key = pitchWeatherKey(game.fieldModel?.weather);
    if (key !== this.weather) this.presentWeather(key);
    if (game.fieldModel?.playerDataArray) {
      this.figurines?.sync(game, this.surfaceY);
      this.lineup = game;
      if (this.tackleZonesOn) this.tackleZones?.sync(game);
    }
    if (game.fieldModel?.playerDataArray || (game.fieldModel && 'ballCoordinate' in game.fieldModel)) {
      this.ball?.sync(game);
    }
  }

  /** Lancer ou botté : la parabole part tout de suite vers la case annoncée. */
  throwMate(id: string, squareX: number, squareY: number, withBall: boolean): void {
    const world = squareToWorld(squareX, squareY);
    this.figurines?.flyTo(id, world.x, world.z);
    if (withBall && this.figurines && this.ball) this.ball.followThrow(this.figurines, id);
  }

  /** Remet la vue d'ensemble, cible au centre du terrain. */
  resetCamera(): void {
    if (!this.camera || !this.controls) return;
    this.controls.target.set(0, 0, 0);
    applyCameraPreset('overview', this.camera, this.controls, this.cameraStart);
  }

  /** Affiche le jet. Le même `key` met à jour la couleur et le dé choisi sans relancer. */
  showBlockDice(spec: BlockDiceSpec): void {
    this.blockDice?.show(spec);
  }

  clearBlockDice(): void {
    this.blockDice?.clear();
  }

  /** Passage d'armure, puis jet de blessure. Le même `key` ne relance pas. */
  showNumberDice(spec: NumberDiceSpec): void {
    this.numberDice?.show(spec);
  }

  clearNumberDice(): void {
    this.numberDice?.clear();
  }

  /** `immediate` : un saut. Sinon le jet d'armure puis de blessure se termine avant de disparaître. */
  releaseNumberDice(immediate: boolean): void {
    this.numberDice?.release(immediate);
  }

  /** Affiche ou masque les cases marquées, teintées selon le nombre de zones de tacle. */
  setTackleZones(enabled: boolean): void {
    this.tackleZonesOn = enabled;
    if (enabled && this.lineup) this.tackleZones?.sync(this.lineup);
    this.tackleZones?.setVisible(enabled);
  }

  /** Icônes de skills au-dessus des figurines. Une map vide les retire. */
  setSkillBadges(badges: ReadonlyMap<string, readonly string[]>): void {
    this.figurines?.setSkillBadges(badges);
  }

  /** Figurine sous le pointeur, ou null. */
  pickPlayer(clientX: number, clientY: number): string | null {
    const renderer = this.renderer;
    const camera = this.camera;
    const roots = this.figurines?.roots() ?? [];
    if (!renderer || !camera || roots.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let node: { parent: typeof hit.object.parent; userData: { playerId?: unknown } } | null = hit.object;
      while (node) {
        const id = node.userData.playerId;
        if (typeof id === 'string' && id) return id;
        node = node.parent;
      }
    }
    return null;
  }

  setPreset(preset: CameraPreset): void {
    if (!this.camera || !this.controls) return;
    applyCameraPreset(preset, this.camera, this.controls, this.cameraStart);
  }

  diagnostics(): PitchDiagnostics {
    const info = this.renderer?.info;
    return {
      fps: this.fps,
      calls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
    };
  }

  destroy(): void {
    this.unbindKeys();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls?.dispose();
    this.controls = null;
    this.ground?.dispose();
    this.ground = null;
    this.sky?.dispose();
    this.sky = null;
    this.house?.dispose();
    this.house = null;
    this.figurines?.dispose();
    this.figurines = null;
    this.tackleZones?.dispose();
    this.tackleZones = null;
    this.tackleZonesOn = false;
    this.lineup = null;
    this.ball?.dispose();
    this.ball = null;
    this.blockDice?.dispose();
    this.blockDice = null;
    this.numberDice?.dispose();
    this.numberDice = null;
    disposeAtlases();
    this.fog?.dispose();
    this.fog = null;
    this.scene?.clear();
    this.scene = null;
    const renderer = this.renderer;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    this.renderer = null;
    this.camera = null;
    this.sun = null;
    this.hemi = null;
    this.host = null;
    this.weather = null;
  }

  private presentWeather(key: WeatherKey): void {
    this.weather = key;
    const mood = WEATHER[key];
    this.fog?.setMood(mood.fog, mood.fogDensity);
    if (this.scene) this.scene.background = new Color(mood.fog);
    if (this.sun) {
      this.sun.color.set(mood.sunColor);
      this.sun.intensity = mood.sunIntensity;
    }
    if (this.hemi) {
      this.hemi.color.set(mood.hemiSky);
      this.hemi.intensity = mood.hemiIntensity;
    }
    this.sky?.setTint(mood.skyTint);
    if (this.renderer) this.renderer.toneMappingExposure = mood.exposure;
  }

  private resize(): void {
    if (!this.host || !this.renderer || !this.camera) return;
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (now: number): void => {
    this.frame = requestAnimationFrame(this.animate);
    if (!this.renderer || !this.scene || !this.camera || !this.controls) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const phi = getDescentPolarAngle(distance, this.controls.minDistance, this.controls.maxDistance);
    this.controls.minPolarAngle = Math.max(TOP_DOWN_POLAR_RAD, phi - 0.0001);
    this.controls.maxPolarAngle = Math.min(HORIZONTAL_POLAR_RAD, phi + 0.0001);
    this.tickCameraKeys(now);
    this.controls.update();
    this.fog?.update();
    this.ground?.update(now);
    this.figurines?.tick(now);
    this.figurines?.face(this.camera);
    this.ball?.tick(now, this.figurines);
    this.blockDice?.tick(now);
    this.numberDice?.tick(now);
    this.frames += 1;
    const elapsed = now - this.fpsStamp;
    if (elapsed >= 500) {
      this.fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.fpsStamp = now;
    }
    this.renderer.render(this.scene, this.camera);
  };

  private bindKeys(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private unbindKeys(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.keys.clear();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (typing(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : '';
    if (!CAMERA_KEYS.has(key)) return;
    this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : '';
    if (key) this.keys.delete(key);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  /** ZQSD déplace, A et E tournent, comme dans SpikeBowl. */
  private tickCameraKeys(now: number): void {
    const controls = this.controls;
    const camera = this.camera;
    if (!controls || !camera) return;
    const dt = this.lastCameraTick ? Math.min(0.05, (now - this.lastCameraTick) / 1000) : 0;
    this.lastCameraTick = now;
    if (dt <= 0 || this.keys.size === 0) return;
    const step = PAN_SPEED * dt;
    let fx = controls.target.x - camera.position.x;
    let fz = controls.target.z - camera.position.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) {
      const angle = controls.getAzimuthalAngle();
      fx = Math.sin(angle);
      fz = Math.cos(angle);
    } else {
      fx /= len;
      fz /= len;
    }
    let dx = 0;
    let dz = 0;
    if (this.keys.has('z')) { dx += fx * step; dz += fz * step; }
    if (this.keys.has('s')) { dx -= fx * step; dz -= fz * step; }
    if (this.keys.has('q')) { dx += fz * step; dz -= fx * step; }
    if (this.keys.has('d')) { dx -= fz * step; dz += fx * step; }
    let yaw = 0;
    if (this.keys.has('a')) yaw += ROTATION_SPEED * dt;
    if (this.keys.has('e')) yaw -= ROTATION_SPEED * dt;
    if (yaw !== 0) orbitYaw(camera, controls.target, yaw);
    if (dx === 0 && dz === 0) return;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.target.x += dx;
    controls.target.z += dz;
    const tx = clamp(controls.target.x, -18, 24);
    const tz = clamp(controls.target.z, -16, 16);
    camera.position.x += tx - controls.target.x;
    camera.position.z += tz - controls.target.z;
    controls.target.x = tx;
    controls.target.z = tz;
  }
}

const CAMERA_KEYS = new Set(['z', 'q', 's', 'd', 'a', 'e']);
const PAN_SPEED = 8;
const ROTATION_SPEED = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Orbite autour de la cible, même sens que l'ancien OrbitControls.rotateLeft. */
function orbitYaw(camera: PerspectiveCamera, target: Vector3, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = camera.position.x - target.x;
  const z = camera.position.z - target.z;
  camera.position.x = target.x + x * cos - z * sin;
  camera.position.z = target.z + x * sin + z * cos;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type.toLowerCase();
    return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'submit';
  }
  return target.isContentEditable;
}
