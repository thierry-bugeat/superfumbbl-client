import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getDescentDistance, getDescentPolarAngle } from './descent';

export type CameraPreset = 'overview' | 'tribune' | 'top';

export function applyCameraPreset(
  preset: CameraPreset,
  camera: PerspectiveCamera,
  controls: OrbitControls,
  cameraStart: Vector3,
): void {
  const target = controls.target;
  if (preset === 'top') {
    camera.position.copy(target).add(cameraStart);
    controls.update();
    return;
  }
  const baseAzimuth = new Spherical().setFromVector3(cameraStart.clone().sub(target)).theta;
  const azimuth = preset === 'tribune' ? baseAzimuth + MathUtils.degToRad(-55) : baseAzimuth;
  const distance = getDescentDistance(0.3, controls.minDistance, controls.maxDistance);
  const phi = getDescentPolarAngle(distance, controls.minDistance, controls.maxDistance);
  camera.position.copy(target).add(new Vector3().setFromSphericalCoords(distance, phi, azimuth));
  controls.update();
}
