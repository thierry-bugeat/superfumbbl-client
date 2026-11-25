import type { ReplayCommand } from '../../game/replay/replayController';

export type Square = [number, number];

export type ThrowCue =
  | { kind: 'mate'; id: string; to: Square; withBall: boolean }
  | { kind: 'pass'; from: Square; to: Square }
  | { kind: 'bomb'; from: Square; to: Square };

/**
 * Noms d'animation du serveur FFB (`AnimationType`). Seuls ceux que la 3D sait montrer :
 * un nom absent ne lance rien. `throws.check.ts` signale un lancé connu du 2D et absent d'ici.
 */
export const THROW_KIND: Readonly<Record<string, ThrowCue['kind']>> = {
  pass: 'pass',
  hailMaryPass: 'pass',
  throwTeamMate: 'mate',
  kickTeamMate: 'mate',
  throwBomb: 'bomb',
  hailMaryBomb: 'bomb',
};

/** Lancés que la 3D ne montre pas encore. Les ranger ici les sort du contrôle. */
export const UNSHOWN_THROWS: ReadonlySet<string> = new Set(['throwARock', 'throwKeg']);

interface ThrowAnimation {
  animationType?: unknown;
  thrownPlayerId?: unknown;
  startCoordinate?: unknown;
  endCoordinate?: unknown;
  interceptorCoordinate?: unknown;
  withBall?: unknown;
}

/** `onPitch` : refuse une case hors terrain. Un coéquipier lancé peut finir dans le public. */
function square(value: unknown, onPitch = true): Square | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = value[0];
  const y = value[1];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (onPitch && (x < 0 || x > 25 || y < 0 || y > 14)) return null;
  return [x, y];
}

/**
 * Le lancé annoncé par la commande. L'animation donne l'arrivée avant que le modèle
 * n'y pose le joueur ou le ballon : la parabole part à cette annonce.
 */
export function throwCue(command: ReplayCommand | null): ThrowCue | null {
  const animation = command?.animation as ThrowAnimation | null | undefined;
  if (!animation) return null;
  const kind = THROW_KIND[String(animation.animationType ?? '')];
  if (kind === 'mate') {
    const to = square(animation.endCoordinate, false);
    if (animation.thrownPlayerId == null || !to) return null;
    return { kind, id: String(animation.thrownPlayerId), to, withBall: animation.withBall === true };
  }
  if (kind === 'pass' || kind === 'bomb') {
    const from = square(animation.startCoordinate);
    // Une interception termine le vol sur la case de l'intercepteur.
    const to = square(animation.interceptorCoordinate) ?? square(animation.endCoordinate);
    if (!from || !to) return null;
    return { kind, from, to };
  }
  return null;
}
