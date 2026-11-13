import { MathUtils } from 'three';

/** Inclinaison SpikeBowl : plus on s'éloigne, plus la vue se redresse vers le dessus. */
const HORIZONTAL_POLAR_RAD = MathUtils.degToRad(89);
const TOP_DOWN_POLAR_RAD = MathUtils.degToRad(2);
/** À 45°, la distance est plus courte qu'avec une rampe linéaire : la caméra est plus près du sol. */
const POLAR_CURVE = 0.5;

export { HORIZONTAL_POLAR_RAD, TOP_DOWN_POLAR_RAD };

export function getDescentPolarAngle(distance: number, minDistance: number, maxDistance: number): number {
  const span = Math.max(maxDistance - minDistance, 0.0001);
  const t = MathUtils.clamp((distance - minDistance) / span, 0, 1);
  return MathUtils.lerp(HORIZONTAL_POLAR_RAD, TOP_DOWN_POLAR_RAD, Math.pow(t, POLAR_CURVE));
}

export function getDescentDistance(curveT: number, minDistance: number, maxDistance: number): number {
  return MathUtils.lerp(minDistance, maxDistance, MathUtils.clamp(curveT, 0, 1));
}
