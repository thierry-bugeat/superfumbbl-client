declare module 'three/addons/controls/OrbitControls.js' {
  import { Camera, MOUSE, Vector3 } from 'three';
  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement);
    enabled: boolean;
    target: Vector3;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    enableDamping: boolean;
    enablePan: boolean;
    mouseButtons: { LEFT: MOUSE | null; MIDDLE: MOUSE | null; RIGHT: MOUSE | null };
    update(): boolean;
    dispose(): void;
    getAzimuthalAngle(): number;
  }
}

declare module 'three/addons/geometries/RoundedBoxGeometry.js' {
  import { BoxGeometry } from 'three';
  export class RoundedBoxGeometry extends BoxGeometry {
    constructor(width?: number, height?: number, depth?: number, segments?: number, radius?: number);
  }
}

declare module 'three/addons/loaders/GLTFLoader.js' {
  import { AnimationClip, Group, Loader, LoadingManager } from 'three';
  export class GLTFLoader extends Loader {
    constructor(manager?: LoadingManager);
    loadAsync(url: string): Promise<{ scene: Group; animations: AnimationClip[] }>;
  }
}

declare module 'three/addons/utils/SkeletonUtils.js' {
  import { Object3D } from 'three';
  export function clone(source: Object3D): Object3D;
}
