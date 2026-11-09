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
  }
}

declare module 'three/addons/loaders/GLTFLoader.js' {
  import { Group, Loader, LoadingManager } from 'three';
  export class GLTFLoader extends Loader {
    constructor(manager?: LoadingManager);
    loadAsync(url: string): Promise<{ scene: Group }>;
  }
}
