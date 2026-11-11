import { Box3, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Raycaster, SpotLight, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = new URL('../../assets/environment/stadium-001.glb', import.meta.url).href;

/** Stade SpikeBowl, mis à l'échelle du terrain FFB. Les projecteurs n'ont pas d'ombre (un seul soleil en porte). */
export class Stadium {
  readonly group = new Group();
  private lights: SpotLight[] = [];

  async load(pitchWidth: number, pitchDepth: number): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const mesh = gltf.scene;
    mesh.traverse((node: Object3D) => {
      const entry = node as Mesh;
      if (!entry.isMesh) return;
      const source = Array.isArray(entry.material) ? entry.material : [entry.material];
      const converted = source.map((material) => toStandard(material));
      entry.material = converted.length === 1 ? converted[0]! : converted;
      entry.castShadow = true;
      entry.receiveShadow = true;
    });

    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    const fit = Math.min((pitchWidth * 1.55) / Math.max(size.x, 0.0001), (pitchDepth * 2.4) / Math.max(size.z, 0.0001));
    mesh.scale.setScalar(fit);
    const fitted = new Box3().setFromObject(mesh);
    const center = fitted.getCenter(new Vector3());
    mesh.position.set(-center.x, -fitted.min.y, -center.z);
    this.group.add(mesh);

    const halfW = pitchWidth / 2 + 2;
    const halfD = pitchDepth / 2 + 2;
    for (const [x, z] of [[halfW, halfD], [-halfW, halfD], [halfW, -halfD], [-halfW, -halfD]] as const) {
      const light = new SpotLight(0xfff4e0, 6, 70, Math.PI / 5, 0.6, 1);
      light.position.set(x, 16, z);
      light.target.position.set(0, 0, 0);
      this.group.add(light, light.target);
      this.lights.push(light);
    }
    this.group.rotation.y = -Math.PI / 2;
  }

  /** Hauteur du sol de jeu du modèle, une fois mis à l'échelle. */
  surfaceY(): number {
    const hit = new Raycaster(new Vector3(0, 50, 0), new Vector3(0, -1, 0)).intersectObject(this.group, true)[0];
    return hit?.point.y ?? 0;
  }

  dispose(): void {
    for (const light of this.lights) {
      light.dispose();
      light.target.removeFromParent();
      light.removeFromParent();
    }
    this.lights = [];
    this.group.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.group.clear();
  }
}

function toStandard(material: Material): Material {
  if (!(material instanceof MeshBasicMaterial)) return material;
  return new MeshStandardMaterial({
    map: material.map,
    color: material.color.clone(),
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
  });
}
