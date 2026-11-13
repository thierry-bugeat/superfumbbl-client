import { Color, FogExp2, MathUtils, PerspectiveCamera, Scene } from 'three';

/** Brouillard SpikeBowl : plus dense quand la caméra monte, pour fondre le ciel. */
export class PitchFog {
  private fog: FogExp2 | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private color = 0x8fafc8,
    private baseDensity = 0.012,
  ) {}

  init(): void {
    this.fog = new FogExp2(this.color, this.baseDensity);
    this.scene.fog = this.fog;
  }

  setMood(color: number, density: number): void {
    this.color = color;
    this.baseDensity = density;
    if (!this.fog) return;
    this.fog.color.set(color);
    this.fog.density = density;
  }

  update(): void {
    if (!this.fog) return;
    const heightStart = 18;
    const heightEnd = 34;
    const t = MathUtils.clamp((this.camera.position.y - heightStart) / (heightEnd - heightStart), 0, 1);
    this.fog.density = this.baseDensity * MathUtils.lerp(1, 0.35, t);
  }

  dispose(): void {
    this.scene.fog = null;
    this.fog = null;
    this.scene.background = new Color(0x000000);
  }
}
