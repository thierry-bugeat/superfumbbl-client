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
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyCameraPreset } from './camera/presets';
import { getDescentDistance, getDescentPolarAngle, HORIZONTAL_POLAR_RAD, TOP_DOWN_POLAR_RAD } from './camera/descent';
import { edgeX, squareToWorld } from './coords';
import { PitchFog } from './environment/fog';
import { createPitchGround, type PitchGroundHandle } from './environment/pitchGround';
import { SkyDome } from './environment/skyDome';
import { PitchHouse } from './environment/house';
import { PitchTree } from './environment/tree';
import { PitchNature } from './environment/nature';
import { PitchBillboards } from './environment/billboards';
import { clampRainSettings, DEFAULT_RAIN_SETTINGS, PitchRain, type RainSettings } from './environment/rain';
import { RainSound } from './environment/rainSound';
import { clampSnowSettings, DEFAULT_SNOW_SETTINGS, PitchSnow, type SnowSettings } from './environment/snow';
import { setSnowCap } from './environment/snowCap';
import { Figurines } from './actors/figurines';
import { TackleZones } from './actors/tackleZones';
import { PitchBall } from './actors/ball';
import { PitchBomb } from './actors/bomb';
import { PitchExplosion } from './actors/explosion';
import { BlockDice, type BlockDiceSpec } from './actors/dice/dBlock';
import { NumberDice, type NumberDiceSpec } from './actors/dice/d6';
import { GroundMarks, type GroundMark } from './actors/groundMarks';
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
  private readonly overviewAzimuth = new Spherical().setFromVector3(this.cameraStart).theta;
  private sun: DirectionalLight | null = null;
  /** Derrière l'en-but home : éclaire la face des pancartes, que le soleil prend à revers. */
  private homeFill: DirectionalLight | null = null;
  private hemi: HemisphereLight | null = null;
  private fog: PitchFog | null = null;
  private ground: PitchGroundHandle | null = null;
  private sky: SkyDome | null = null;
  private house: PitchHouse | null = null;
  private tree: PitchTree | null = null;
  private nature: PitchNature | null = null;
  private billboards: PitchBillboards | null = null;
  private figurines: Figurines | null = null;
  private tackleZones: TackleZones | null = null;
  private tackleZonesOn = false;
  private lineup: GameJson | null = null;
  private ball: PitchBall | null = null;
  private bomb: PitchBomb | null = null;
  private explosion: PitchExplosion | null = null;
  private blockDice: BlockDice | null = null;
  private numberDice: NumberDice | null = null;
  private groundMarks: GroundMarks | null = null;
  private surfaceY = 0;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private weather: WeatherKey | null = null;
  private rain: PitchRain | null = null;
  private rainSound: RainSound | null = null;
  private rainSettings: RainSettings = { ...DEFAULT_RAIN_SETTINGS };
  private snow: PitchSnow | null = null;
  private snowSettings: SnowSettings = { ...DEFAULT_SNOW_SETTINGS };
  private readonly background = new Color(WEATHER.nice.fog);
  private readonly boltTint = new Color(0xf4f8ff);
  private readonly flashTint = new Color();
  private readonly flashSky = new Color();
  private lightningActive = false;
  private lastRainTick = 0;
  private fps = 0;
  private frames = 0;
  private fpsStamp = 0;
  private readonly keys = new Set<string>();
  private lastCameraTick = 0;
  private tracking = true;
  private trackingListener: ((enabled: boolean) => void) | null = null;
  private followSubject: CameraFollow | null = null;
  private glidingOverview = false;
  private overviewSettled = false;
  private glidePhi = 0;
  private lastTrackTick = 0;
  private readonly trackSpherical = new Spherical();
  private readonly trackOffset = new Vector3();
  private readonly onWheel = (): void => { this.releaseTracking(); };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.tracking) return;
    if (event.movementX === 0 && event.movementY === 0) return;
    const left = (event.buttons & 1) !== 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const middle = (event.buttons & 4) !== 0;
    if (left || middle) this.releaseTracking();
  };
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  async init(host: HTMLElement): Promise<void> {
    if (this.renderer) this.destroy();
    this.host = host;
    const scene = new Scene();
    scene.background = this.background;
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
    controls.maxDistance = 34;
    controls.minPolarAngle = TOP_DOWN_POLAR_RAD;
    controls.maxPolarAngle = HORIZONTAL_POLAR_RAD;
    controls.update();

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.syncPan();

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
    this.homeFill = new DirectionalLight(0xfff3e0, 1.15);
    this.homeFill.position.set(edgeX(0) - 10, 8, 0);
    this.homeFill.target.position.set(0, 1, 0);
    scene.add(this.homeFill, this.homeFill.target);

    this.fog = new PitchFog(scene, camera);
    this.fog.init();

    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.ground = await createPitchGround(anisotropy);
    scene.add(this.ground.mesh);

    this.sky = new SkyDome();
    await this.sky.load(120);
    scene.add(this.sky.group);

    this.house = new PitchHouse();
    this.tree = new PitchTree();
    this.nature = new PitchNature();
    this.billboards = new PitchBillboards();
    await Promise.all([this.house.load(), this.tree.load(), this.nature.load(), this.billboards.load(anisotropy)]);
    scene.add(this.house.group, this.tree.group, this.nature.group, this.billboards.group);
    this.figurines = new Figurines(scene);
    this.tackleZones = new TackleZones(scene);
    this.ball = new PitchBall(scene);
    this.bomb = new PitchBomb(scene);
    this.explosion = new PitchExplosion(scene);
    this.blockDice = new BlockDice(scene);
    this.numberDice = new NumberDice(scene);
    this.groundMarks = new GroundMarks(scene);
    await Promise.all([loadAtlases(anisotropy), this.ball.load(), this.bomb.load(), this.blockDice.load(anisotropy)]);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.bindKeys();
    this.bindPointer(renderer.domElement);
    this.rain = new PitchRain(scene);
    this.rain.apply(this.rainSettings);
    this.rainSound = new RainSound();
    this.rainSound.setParams(this.rainSettings);
    this.snow = new PitchSnow(scene);
    this.snow.apply(this.snowSettings);
    this.weather = null;
    this.presentWeather('nice');
    applyCameraPreset('overview', camera, controls, this.cameraStart);
    this.fpsStamp = performance.now();
    renderer.render(scene, camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  /** Météo, figurines, ballon et bombe. Un état sans joueurs (bouton météo) ne retire personne. `cut` : un saut. */
  present(game: GameJson, cut = false): void {
    const key = pitchWeatherKey(game.fieldModel?.weather);
    if (key !== this.weather) this.presentWeather(key);
    if (game.fieldModel?.playerDataArray) {
      this.figurines?.sync(game, this.surfaceY);
      this.lineup = game;
      if (this.tackleZonesOn) this.tackleZones?.sync(game);
    }
    if (game.fieldModel?.playerDataArray || (game.fieldModel && 'ballCoordinate' in game.fieldModel)) {
      this.ball?.sync(game, cut);
    }
    if (game.fieldModel?.playerDataArray || (game.fieldModel && 'bombCoordinate' in game.fieldModel)) {
      this.bomb?.sync(game, cut);
    }
  }

  /** Lancer ou botté : la parabole part tout de suite vers la case annoncée. */
  throwMate(id: string, squareX: number, squareY: number, withBall: boolean): void {
    const world = squareToWorld(squareX, squareY);
    this.figurines?.flyTo(id, world.x, world.z);
    if (withBall && this.figurines && this.ball) this.ball.followThrow(this.figurines, id);
  }

  /** Passe : la parabole du ballon part tout de suite, avant que le modèle ne le pose. */
  throwBall(fromX: number, fromY: number, toX: number, toY: number): void {
    const from = squareToWorld(fromX, fromY);
    const to = squareToWorld(toX, toY);
    this.ball?.throwTo(to.x, to.z, from.x, from.z);
  }

  /** Bombe : la parabole part tout de suite, avant que le modèle ne la pose. */
  throwBomb(fromX: number, fromY: number, toX: number, toY: number): void {
    const from = squareToWorld(fromX, fromY);
    const to = squareToWorld(toX, toY);
    this.bomb?.throwTo(to.x, to.z, from.x, from.z);
  }

  /** Détonation Blood Bowl : feu sur la case et les 8 adjacentes (≈ 3×3). */
  explodeBomb(squareX: number, squareY: number): void {
    this.bomb?.vanish();
    this.explosion?.burst(squareX, squareY);
  }

  /** Remet la vue d'ensemble. Le suivi reste dans l'état choisi par le bouton. */
  resetCamera(): void {
    if (!this.camera || !this.controls) return;
    this.glidingOverview = false;
    this.overviewSettled = false;
    this.controls.target.set(0, 0, 0);
    applyCameraPreset('overview', this.camera, this.controls, this.cameraStart);
  }

  /** Glisse vers la même vue que le bouton de réinitialisation, et rend le suivi. */
  glideToOverview(): void {
    if (!this.camera || !this.controls) return;
    this.followSubject = null;
    this.glidingOverview = true;
    this.overviewSettled = true;
    if (this.tracking) return;
    this.tracking = true;
    this.syncPan();
    this.trackingListener?.(true);
  }

  cameraTracking(): boolean {
    return this.tracking;
  }

  /** Allume ou éteint le suivi. Rallumer reprend depuis l'angle actuel. */
  setCameraTracking(enabled: boolean): void {
    if (this.tracking === enabled) return;
    this.tracking = enabled;
    if (!enabled) {
      this.glidingOverview = false;
      this.overviewSettled = false;
    }
    this.syncPan();
    this.trackingListener?.(enabled);
  }

  onCameraTrackingChange(listener: (enabled: boolean) => void): void {
    this.trackingListener = listener;
  }

  /** Qui cadrer. `null` : la caméra reste où elle est. */
  track(subject: CameraFollow | null): void {
    this.followSubject = subject;
    if (subject) {
      this.glidingOverview = false;
      this.overviewSettled = false;
    }
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

  /** Cases de poussée et flèches de dispersion. La même liste ne reconstruit rien. */
  showGroundMarks(marks: readonly GroundMark[]): void {
    if (marks.length === 0) this.groundMarks?.clear();
    else this.groundMarks?.show(marks);
  }

  clearGroundMarks(): void {
    this.groundMarks?.clear();
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

  /** Réglages de la pluie. Conservés même si `init` n'a pas encore tourné. */
  setRainSettings(patch: Partial<RainSettings>): void {
    this.rainSettings = clampRainSettings({ ...this.rainSettings, ...patch });
    this.rain?.apply(this.rainSettings);
    this.rainSound?.setParams(this.rainSettings);
    this.syncRain();
  }

  /** Éclair immédiat, que la pluie soit affichée ou non. */
  triggerRainLightning(): void {
    this.rain?.triggerLightning();
  }

  /** Impacts de gouttes sur la dernière seconde pleine. */
  rainImpacts(): number {
    return this.rain?.impactsPerSecond() ?? 0;
  }

  /** Réglages de la neige. Conservés même si `init` n'a pas encore tourné. */
  setSnowSettings(patch: Partial<SnowSettings>): void {
    this.snowSettings = clampSnowSettings({ ...this.snowSettings, ...patch });
    this.snow?.apply(this.snowSettings);
    this.syncSnow();
  }

  /** Part de la couche au sol, de 0 à 1. Elle fond encore quand les flocons sont masqués. */
  snowCover(): number {
    return this.snow?.cover() ?? 0;
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
    this.unbindPointer();
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
    this.tree?.dispose();
    this.tree = null;
    this.nature?.dispose();
    this.nature = null;
    this.billboards?.dispose();
    this.billboards = null;
    this.figurines?.dispose();
    this.figurines = null;
    this.tackleZones?.dispose();
    this.tackleZones = null;
    this.tackleZonesOn = false;
    this.lineup = null;
    this.ball?.dispose();
    this.ball = null;
    this.bomb?.dispose();
    this.bomb = null;
    this.explosion?.dispose();
    this.explosion = null;
    this.blockDice?.dispose();
    this.blockDice = null;
    this.numberDice?.dispose();
    this.numberDice = null;
    this.groundMarks?.dispose();
    this.groundMarks = null;
    disposeAtlases();
    this.fog?.dispose();
    this.fog = null;
    this.rain?.dispose();
    this.rain = null;
    this.rainSound?.dispose();
    this.rainSound = null;
    this.snow?.dispose();
    this.snow = null;
    setSnowCap(0);
    this.lightningActive = false;
    this.lastRainTick = 0;
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
    this.homeFill = null;
    this.hemi = null;
    this.host = null;
    this.weather = null;
  }

  private presentWeather(key: WeatherKey): void {
    this.weather = key;
    const mood = WEATHER[key];
    this.fog?.setMood(mood.fog, mood.fogDensity);
    if (this.sun) {
      this.sun.color.set(mood.sunColor);
      this.sun.intensity = mood.sunIntensity;
    }
    if (this.hemi) {
      this.hemi.color.set(mood.hemiSky);
      this.hemi.intensity = mood.hemiIntensity;
    }
    this.sky?.setTint(mood.skyTint);
    this.background.set(mood.fog);
    if (this.renderer) this.renderer.toneMappingExposure = mood.exposure;
    this.syncRain();
    this.syncSnow();
  }

  /** La pluie suit la météo, sauf si la console l'a forcée. */
  private syncRain(): void {
    const on = this.rainSettings.force || this.weather === 'rain';
    this.rain?.setVisible(on);
    this.rainSound?.setRaining(on);
  }

  /** La neige tombe par blizzard, ou si la console l'a forcée. Le sol déjà couvert fond tout seul. */
  private syncSnow(): void {
    this.snow?.setVisible(this.snowSettings.force || this.weather === 'blizzard');
  }

  /** Éclair : le ciel, le brouillard et l'exposition s'éclairent, puis reviennent à la météo. */
  private paintLightning(power: number): void {
    const renderer = this.renderer;
    const weather = this.weather;
    if (!renderer || !weather) return;
    const mood = WEATHER[weather];
    if (power <= 0.01) {
      if (!this.lightningActive) return;
      this.lightningActive = false;
      this.background.set(mood.fog);
      this.fog?.setColor(mood.fog);
      this.sky?.setTint(mood.skyTint);
      renderer.toneMappingExposure = mood.exposure;
      return;
    }
    this.lightningActive = true;
    const lift = Math.min(1, power);
    this.flashTint.set(mood.fog).lerp(this.boltTint, lift * 0.45);
    this.background.copy(this.flashTint);
    this.fog?.setColor(this.flashTint);
    this.flashSky.set(mood.skyTint).lerp(this.boltTint, lift * 0.35);
    this.sky?.setTint(this.flashSky);
    renderer.toneMappingExposure = mood.exposure + lift * 0.7;
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
    this.fog?.update();
    this.ground?.update(now);
    this.tree?.tick(now, this.sun);
    this.nature?.tick(now);
    this.figurines?.tick(now);
    this.ball?.tick(now, this.figurines);
    this.bomb?.tick(now, this.figurines);
    this.explosion?.tick(now);
    if (this.keys.has('a') || this.keys.has('e')) this.releaseTracking();
    if (!this.tickOverviewGlide(now)) this.tickTracking(now);
    const distance = this.camera.position.distanceTo(this.controls.target);
    const phi = this.glidingOverview
      ? this.glidePhi
      : trackingPolarAngle(distance, this.tracking && !this.overviewSettled, this.controls.minDistance, this.controls.maxDistance);
    this.controls.minPolarAngle = Math.max(TOP_DOWN_POLAR_RAD, phi - 0.0001);
    this.controls.maxPolarAngle = Math.min(HORIZONTAL_POLAR_RAD, phi + 0.0001);
    this.tickCameraKeys(now);
    this.controls.update();
    this.figurines?.face(this.camera);
    this.blockDice?.tick(now);
    this.numberDice?.tick(now);
    this.groundMarks?.tick(now);
    const rainDt = this.lastRainTick ? Math.min(0.05, (now - this.lastRainTick) / 1000) : 0;
    this.lastRainTick = now;
    const flash = rainDt > 0 ? this.rain?.tick(rainDt, this.controls.target.x, this.controls.target.z) ?? 0 : 0;
    if ((this.rain?.takeBolts() ?? 0) > 0) this.rainSound?.thunder();
    if (rainDt > 0) {
      this.snow?.tick(rainDt, this.camera.quaternion);
      this.rainSound?.tick(rainDt);
    }
    setSnowCap(this.snow?.cap() ?? 0);
    this.paintLightning(flash);
    this.frames += 1;
    const elapsed = now - this.fpsStamp;
    if (elapsed >= 500) {
      this.fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.fpsStamp = now;
    }
    this.renderer.render(this.scene, this.camera);
  };

  private bindPointer(element: HTMLElement): void {
    element.addEventListener('wheel', this.onWheel, { passive: true });
    element.addEventListener('pointermove', this.onPointerMove);
  }

  private unbindPointer(): void {
    const element = this.renderer?.domElement;
    if (!element) return;
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('pointermove', this.onPointerMove);
  }

  /** Le panoramique est ignoré tant que le suivi tient la cible. */
  private syncPan(): void {
    if (this.controls) this.controls.enablePan = !this.tracking;
  }

  /** Tourner ou zoomer rend la main. Le panoramique, lui, ne coupe pas le suivi. */
  private releaseTracking(): void {
    if (!this.tracking) return;
    this.tracking = false;
    this.glidingOverview = false;
    this.overviewSettled = false;
    this.syncPan();
    this.trackingListener?.(false);
  }

  /** Rejoint la vue d'ensemble sans sauter. Un nouveau sujet, ou la main rendue, l'interrompt. */
  private tickOverviewGlide(now: number): boolean {
    if (!this.glidingOverview) return false;
    const camera = this.camera;
    const controls = this.controls;
    if (!this.tracking || !camera || !controls) {
      this.glidingOverview = false;
      this.overviewSettled = false;
      return false;
    }
    this.trackOffset.copy(camera.position).sub(controls.target);
    if (this.trackOffset.lengthSq() < 1e-6) this.trackOffset.set(-16, 12, 0);
    this.trackSpherical.setFromVector3(this.trackOffset);
    const dt = this.lastTrackTick ? Math.min(0.05, (now - this.lastTrackTick) / 1000) : 0;
    this.lastTrackTick = now;
    if (dt <= 0) {
      this.glidePhi = this.trackSpherical.phi;
      return true;
    }
    const blend = 1 - Math.exp(-dt / OVERVIEW_SECONDS);
    const target = controls.target;
    target.x += -target.x * blend;
    target.y += -target.y * blend;
    target.z += -target.z * blend;
    const goalDistance = getDescentDistance(0.3, controls.minDistance, controls.maxDistance);
    const goalAzimuth = this.overviewAzimuth;
    const goalPhi = getDescentPolarAngle(goalDistance, controls.minDistance, controls.maxDistance);
    this.trackSpherical.radius += (goalDistance - this.trackSpherical.radius) * blend;
    this.trackSpherical.theta = lerpAngle(this.trackSpherical.theta, goalAzimuth, blend);
    this.trackSpherical.phi += (goalPhi - this.trackSpherical.phi) * blend;
    this.glidePhi = this.trackSpherical.phi;
    camera.position.copy(target).add(this.trackOffset.setFromSphericalCoords(this.trackSpherical.radius, this.trackSpherical.phi, this.trackSpherical.theta));
    const azimuthLeft = Math.atan2(Math.sin(goalAzimuth - this.trackSpherical.theta), Math.cos(goalAzimuth - this.trackSpherical.theta));
    const arrived = target.lengthSq() < 0.0025
      && Math.abs(this.trackSpherical.radius - goalDistance) < 0.05
      && Math.abs(azimuthLeft) < 0.01;
    if (arrived) {
      target.set(0, 0, 0);
      this.trackSpherical.radius = goalDistance;
      this.trackSpherical.theta = goalAzimuth;
      this.trackSpherical.phi = getDescentPolarAngle(goalDistance, controls.minDistance, controls.maxDistance);
      camera.position.copy(target).add(this.trackOffset.setFromSphericalCoords(this.trackSpherical.radius, this.trackSpherical.phi, this.trackSpherical.theta));
      this.glidingOverview = false;
    }
    return true;
  }

  /** Glisse la cible vers le sujet et règle la distance, sans changer l'azimut. */
  private tickTracking(now: number): void {
    const camera = this.camera;
    const controls = this.controls;
    const subject = this.followSubject;
    if (!this.tracking || !subject || !camera || !controls) {
      this.lastTrackTick = now;
      return;
    }
    const place =
      subject.kind === 'player' ? this.figurines?.where(subject.id)
      : subject.kind === 'bomb' ? this.bomb?.spot()
      : this.ball?.spot();
    const dt = this.lastTrackTick ? Math.min(0.05, (now - this.lastTrackTick) / 1000) : 0;
    this.lastTrackTick = now;
    if (!place || dt <= 0) return;
    const blend = 1 - Math.exp(-dt / TRACK_SECONDS);
    const target = controls.target;
    target.x += (place.x - target.x) * blend;
    target.z += (place.z - target.z) * blend;
    const clampedX = clamp(target.x, -18, 24);
    const clampedZ = clamp(target.z, -16, 16);
    camera.position.x += clampedX - target.x;
    camera.position.z += clampedZ - target.z;
    target.x = clampedX;
    target.z = clampedZ;
    this.trackOffset.copy(camera.position).sub(target);
    if (this.trackOffset.lengthSq() < 1e-6) this.trackOffset.set(-16, 12, 0);
    this.trackSpherical.setFromVector3(this.trackOffset);
    const desired = subject.close ? CLOSE_DISTANCE : FOLLOW_DISTANCE;
    const distance = this.trackSpherical.radius + (desired - this.trackSpherical.radius) * blend;
    const phi = trackingPolarAngle(distance, true, controls.minDistance, controls.maxDistance);
    camera.position.copy(target).add(this.trackOffset.setFromSphericalCoords(distance, phi, this.trackSpherical.theta));
  }

  private bindKeys(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  private unbindKeys(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.onPointerDown);
    this.keys.clear();
  }

  /** Le navigateur ne démarre l'audio qu'après un geste. */
  private onPointerDown = (): void => {
    this.rainSound?.unlock();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    this.rainSound?.unlock();
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
    if (this.tracking || (dx === 0 && dz === 0)) return;
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

/** Cadrage d'une action. `close` : bloc ou touchdown. */
export interface CameraFollow {
  kind: 'player' | 'ball' | 'bomb';
  id: string;
  close: boolean;
}

const OVERVIEW_SECONDS = 0.85;
const FOLLOW_DISTANCE = 16;
const CLOSE_DISTANCE = 12;
/** Le plan serré se rapproche, sans passer sous la hauteur du suivi. */
const CLOSE_MIN_HEIGHT = 10.5;
const TRACK_SECONDS = 0.45;
const CAMERA_KEYS = new Set(['z', 'q', 's', 'd', 'a', 'e']);
const PAN_SPEED = 8;
const ROTATION_SPEED = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

/**
 * Inclinaison du suivi. Tant que la caméra n'est pas revenue à sa distance de suivi,
 * elle garde la hauteur du plan serré : sinon la fin des dés la fait plonger d'un coup.
 */
function trackingPolarAngle(distance: number, holdHeight: boolean, minDistance: number, maxDistance: number): number {
  const curve = getDescentPolarAngle(distance, minDistance, maxDistance);
  if (!holdHeight) return curve;
  const lifted = Math.acos(Math.min(1, CLOSE_MIN_HEIGHT / Math.max(distance, CLOSE_MIN_HEIGHT)));
  return Math.min(curve, lifted);
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
