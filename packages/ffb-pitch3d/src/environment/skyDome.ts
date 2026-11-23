import {
  BackSide,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';

const SKY_URL = new URL('../../assets/environment/skydome-sky-003.avif', import.meta.url).href;
const GROUND_URL = new URL('../../assets/environment/skydome-ground.avif', import.meta.url).href;

/** Dôme de ciel et sol lointain, portés de SpikeBowl. `setTint` sert à la météo. */
export class SkyDome {
  readonly group = new Group();
  private skyMaterial: MeshBasicMaterial | null = null;
  private textures: Texture[] = [];

  async load(radius = 90): Promise<void> {
    const loader = new TextureLoader();
    const [skyTexture, groundTexture] = await Promise.all([
      loader.loadAsync(SKY_URL),
      loader.loadAsync(GROUND_URL),
    ]);
    this.textures = [skyTexture, groundTexture];
    skyTexture.colorSpace = SRGBColorSpace;
    skyTexture.wrapS = RepeatWrapping;
    skyTexture.repeat.set(-1, 0.5);
    skyTexture.offset.set(0.25, 0.5);
    groundTexture.colorSpace = SRGBColorSpace;
    groundTexture.wrapS = MirroredRepeatWrapping;
    groundTexture.wrapT = MirroredRepeatWrapping;
    groundTexture.repeat.set(4, 4);

    this.skyMaterial = new MeshBasicMaterial({ map: skyTexture, side: BackSide, depthWrite: false });
    const sky = new Mesh(
      new SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      this.skyMaterial,
    );
    sky.position.y = 0.02;
    this.group.add(sky);

    const ground = new Mesh(
      new CircleGeometry(radius, 48),
      new MeshStandardMaterial({ map: groundTexture, roughness: 0.98, metalness: 0.02, side: DoubleSide }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.rotation.z = Math.PI / 4;
    // Sous le plateau du terrain (y 0). Au même niveau, les deux textures clignotent.
    ground.position.y = -0.025; // Pour éviter le clignotement des textures.
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  setTint(color: number | Color): void {
    this.skyMaterial?.color.set(color);
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
    this.skyMaterial = null;
    this.textures = [];
  }
}
