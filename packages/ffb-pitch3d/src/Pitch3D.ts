import type { GameJson } from '@fumbbl40k/ffb-protocol';
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyCameraPreset, type CameraPreset } from './camera/presets';
import { getDescentPolarAngle, HORIZONTAL_POLAR_RAD, TOP_DOWN_POLAR_RAD } from './camera/descent';
import { PITCH_COLUMNS, PITCH_ROWS, TILE_SIZE } from './coords';
import { PitchFog } from './environment/fog';
import { createPitchGround, type PitchGroundHandle } from './environment/pitchGround';
import { createPitchMarkings } from './environment/pitch';
import { SkyDome } from './environment/skyDome';
import { Stadium } from './environment/stadium';
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
  private readonly cameraStart = new Vector3(0, 32, 24);
  private sun: DirectionalLight | null = null;
  private hemi: HemisphereLight | null = null;
  private fog: PitchFog | null = null;
  private ground: PitchGroundHandle | null = null;
  private sky: SkyDome | null = null;
  private stadium: Stadium | null = null;
  private markings: Group | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private weather: WeatherKey | null = null;
  private fps = 0;
  private frames = 0;
  private fpsStamp = 0;

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
    controls.minDistance = 8;
    controls.maxDistance = 55;
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

    const pitchWidth = PITCH_COLUMNS * TILE_SIZE;
    const pitchDepth = PITCH_ROWS * TILE_SIZE;
    this.ground = await createPitchGround(pitchWidth + 14, pitchDepth + 16);
    scene.add(this.ground.mesh);
    this.markings = createPitchMarkings();
    scene.add(this.markings);

    this.sky = new SkyDome();
    await this.sky.load(120);
    scene.add(this.sky.group);

    this.stadium = new Stadium();
    await this.stadium.load(pitchWidth, pitchDepth);
    scene.add(this.stadium.group);
    const surfaceY = this.stadium.surfaceY() + 0.03;
    this.ground.mesh.position.y = surfaceY;
    this.markings.position.y = surfaceY;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.weather = null;
    this.presentWeather('nice');
    this.fpsStamp = performance.now();
    renderer.render(scene, camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  /** N'applique que la météo. Sans effet si elle n'a pas changé. */
  present(game: GameJson): void {
    const key = pitchWeatherKey(game.fieldModel?.weather);
    if (key === this.weather) return;
    this.presentWeather(key);
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
    this.stadium?.dispose();
    this.stadium = null;
    disposeGroup(this.markings);
    this.markings = null;
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
    this.controls.update();
    this.fog?.update();
    this.ground?.update(now);
    this.frames += 1;
    const elapsed = now - this.fpsStamp;
    if (elapsed >= 500) {
      this.fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.fpsStamp = now;
    }
    this.renderer.render(this.scene, this.camera);
  };
}

function disposeGroup(group: Group | null): void {
  group?.traverse((node) => {
    const mesh = node as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  group?.clear();
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) value.dispose();
  }
  material.dispose();
}

function isTexture(value: unknown): value is Texture {
  return !!value && typeof value === 'object' && (value as Texture).isTexture === true;
}
