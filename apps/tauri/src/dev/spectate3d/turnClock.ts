import type { GameJson } from '@fumbbl40k/ffb-protocol';

/** Même défaut que le HUD 2D : 4 minutes, sauf option de ligue `turntime`. */
const DEFAULT_TURN_SECONDS = 240;

/**
 * Temps déjà passé dans le tour, en millisecondes. `serverGameTime` l'envoie tel quel :
 * le serveur le fige pendant les dialogues, donc on ne l'avance pas entre deux échantillons.
 */
export function resolveTurnElapsed(input: {
  finished: boolean;
  followingLive: boolean;
  liveElapsed: number | null;
  commandElapsed: number | null;
  snapshotElapsed: number | null;
}): number | null {
  if (input.finished) return null;
  if (input.followingLive && input.liveElapsed !== null) return input.liveElapsed;
  if (input.commandElapsed !== null) return input.commandElapsed;
  return input.snapshotElapsed;
}

export function gameClockStopped(game: { finished?: unknown; turnMode?: unknown }): boolean {
  return (game.finished != null && String(game.finished) !== '') || game.turnMode === 'endGame';
}

export function turnLimitMs(game: GameJson): number {
  const seconds = Number(gameOptions(game).find((option) => option.gameOptionId === 'turntime')?.gameOptionValue);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TURN_SECONDS) * 1000;
}

/** Décompte `m:ss`, comme la pendule du HUD 2D. */
export function formatTurnRemaining(elapsedMs: number, limitMs: number): string {
  const remaining = Math.max(0, Math.floor((limitMs - Math.max(0, elapsedMs)) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function readElapsedMs(value: unknown): number | null {
  const elapsed = typeof value === 'number' ? value : NaN;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function gameOptions(game: GameJson): { gameOptionId?: string; gameOptionValue?: unknown }[] {
  const typed = game.gameOptions?.gameOptionArray;
  if (Array.isArray(typed)) return typed;
  const legacy = (game as { options?: { gameOptionArray?: { gameOptionId?: string; gameOptionValue?: unknown }[] } }).options?.gameOptionArray;
  return Array.isArray(legacy) ? legacy : [];
}
