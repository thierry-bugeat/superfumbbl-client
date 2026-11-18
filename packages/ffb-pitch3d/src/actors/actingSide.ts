import type { GameJson } from '@fumbbl40k/ffb-protocol';

/** Tours où une équipe active ses figurines. */
const TEAM_TURN = new Set([
  'regular',
  'blitz',
  'selectBlitzTarget',
  'quickSnap',
  'highKick',
  'kickoffReturn',
  'passBlock',
]);

/**
 * Sous-modes au milieu d'une activation (dump-off, interception, bombes…).
 * On conserve le côté pour ne pas rétablir l'affichage en plein tour.
 */
const HOLD_ACTING_SIDE = new Set([
  'dumpOff',
  'interception',
  'bombHome',
  'bombAway',
  'bombHomeBlitz',
  'bombAwayBlitz',
  'selectGazeTarget',
  'selectBlockKind',
  'raidingParty',
  'hitAndRun',
  'thenIStartedBlastin',
  'safePairOfHands',
  'trickster',
  'wizard',
  'illegalSubstitution',
]);

/**
 * Côté dont c'est le tour. Le bit ACTIVE reste posé sur les deux équipes :
 * on ne le suit que pour ce côté-là.
 *
 * Fin de tour : le serveur oscille regular ↔ betweenTurns et fait clignoter
 * homePlaying (regular → betweenTurns → regular → betweenTurns + côté inverse
 * → regular + ancien côté → côté définitif). betweenTurns n'est pas une fin
 * de tour : on garde le côté déjà retenu, sinon les socles et les zones de
 * tacle basculent puis reviennent à chaque aller-retour. Le rétablissement
 * se fait une seule fois, quand un vrai mode de tour adopte le nouveau
 * homePlaying, ou quand plus personne n'active (setup, kickoff, fin de match).
 */
export function noteActingSide(
  game: GameJson,
  previous: boolean | null,
  previousGameId: number | null,
): { side: boolean | null; gameId: number } {
  const gameId = Number(game.gameId) || 0;
  if (gameId !== previousGameId) previous = null;
  const finished = game.finished != null && String(game.finished) !== '';
  const mode = String(game.turnMode ?? '');
  if (finished || mode === 'endGame') return { side: null, gameId };
  if (mode === 'betweenTurns' || HOLD_ACTING_SIDE.has(mode)) return { side: previous, gameId };
  if (TEAM_TURN.has(mode)) {
    if (game.homePlaying !== true && game.homePlaying !== false) return { side: previous, gameId };
    return { side: game.homePlaying, gameId };
  }
  return { side: null, gameId };
}

/**
 * Équipe dont on dessine les zones : l'adverse du côté retenu.
 * Sans côté retenu (setup, coup d'envoi), on retombe sur homePlaying.
 */
export function latchedOpponentIsHome(
  game: GameJson,
  previous: boolean | null,
  previousGameId: number | null,
): { opponentIsHome: boolean; side: boolean | null; gameId: number } {
  const noted = noteActingSide(game, previous, previousGameId);
  const opponentIsHome = noted.side === null ? game.homePlaying !== true : noted.side === false;
  return { opponentIsHome, side: noted.side, gameId: noted.gameId };
}
