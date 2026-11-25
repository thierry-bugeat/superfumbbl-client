import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { CameraFollow } from '@fumbbl40k/ffb-pitch3d';
import type { ReplayCommand } from '../../game/replay/replayController';

const STANDING = 0x01;
const MOVING = 0x02;
/** Même vitesse que le glissé du ballon, en cases par seconde. */
const BALL_SPEED = 6;

let lastBall: [number, number] | null = null;
let flightUntil = 0;
/** Case d'arrivée d'une passe déjà lancée : le modèle l'y pose avant la fin du vol. */
let thrownTo: [number, number] | null = null;

/**
 * Qui cadrer. Le joueur qui agit, le ballon seulement le temps de son trajet,
 * et un plan plus serré sur un bloc ou un touchdown.
 */
export function cameraFollow(
  game: GameJson,
  command: ReplayCommand | null,
  options: { touchdown: boolean; block: boolean; traveling: boolean },
): CameraFollow | null {
  if (options.touchdown) {
    const scorer = scoringPlayerId(command);
    if (scorer && onPitch(game, scorer)) return { kind: 'player', id: scorer, close: true };
    if (options.traveling) return { kind: 'ball', id: '', close: true };
  }
  if (options.traveling) return { kind: 'ball', id: '', close: false };
  if (options.block) {
    const defender = game.defenderId;
    if (defender && onPitch(game, defender)) return { kind: 'player', id: defender, close: true };
    const acting = actingId(game);
    if (acting && onPitch(game, acting)) return { kind: 'player', id: acting, close: true };
  }
  const acting = actingId(game);
  if (acting && onPitch(game, acting)) return { kind: 'player', id: acting, close: false };
  return null;
}

/**
 * Le ballon change de case sans être porté. Le drapeau `ballMoving` reste vrai
 * tant qu'il est libre, y compris posé : il ne dit pas qu'il se déplace.
 * Le délai couvre le glissé à l'écran, puis le cadrage lâche le ballon.
 * Une passe est annoncée avant ce changement : le cadrage part au lâcher
 * et ne se rallonge pas quand le modèle pose ensuite la case d'arrivée.
 */
export function noteBallThrow(from: [number, number], to: [number, number], now = performance.now()): void {
  const squares = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const until = now + (squares / BALL_SPEED) * 1000;
  if (until > flightUntil) flightUntil = until;
  thrownTo = to;
}

export function consumeBallTravel(game: GameJson | null, jumped: boolean, now = performance.now()): boolean {
  const to = game ? ballSquare(game) : null;
  const from = lastBall;
  lastBall = to;
  if (!game || jumped) {
    flightUntil = 0;
    thrownTo = null;
    return false;
  }
  // La réception est dans le modèle pendant que le ballon est encore en l'air.
  if (ballCarried(game) && now >= flightUntil) {
    flightUntil = 0;
    thrownTo = null;
    return false;
  }
  if (to && from && (from[0] !== to[0] || from[1] !== to[1])) {
    if (thrownTo && now < flightUntil) return true;
    thrownTo = null;
    const squares = Math.hypot(to[0] - from[0], to[1] - from[1]);
    flightUntil = now + (squares / BALL_SPEED) * 1000;
    return true;
  }
  if (now >= flightUntil) thrownTo = null;
  return now < flightUntil;
}

function scoringPlayerId(command: ReplayCommand | null): string | null {
  if (!command) return null;
  for (const report of reportsOf(command)) {
    if (report.reportId !== 'turnEnd') continue;
    const id = report.playerIdTouchdown;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

function actingId(game: GameJson): string | null {
  const id = game.actingPlayer?.playerId;
  return typeof id === 'string' && id ? id : null;
}

function onPitch(game: GameJson, playerId: string | null | undefined): boolean {
  if (!playerId) return false;
  const coordinate = game.fieldModel?.playerDataArray?.find((player) => player.playerId === playerId)?.playerCoordinate;
  return !!coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
}

function ballSquare(game: GameJson): [number, number] | null {
  const coordinate = game.fieldModel?.ballCoordinate;
  if (!game.fieldModel?.ballInPlay || !coordinate) return null;
  if (coordinate[0] < 0 || coordinate[0] > 25 || coordinate[1] < 0 || coordinate[1] > 14) return null;
  return [coordinate[0], coordinate[1]];
}

function ballCarried(game: GameJson): boolean {
  if (game.fieldModel?.ballMoving === true) return false;
  return carrierId(game) != null;
}

function carrierId(game: GameJson): string | null {
  const coordinate = game.fieldModel?.ballCoordinate;
  if (!coordinate) return null;
  for (const player of game.fieldModel?.playerDataArray ?? []) {
    const at = player.playerCoordinate;
    if (!at || at[0] !== coordinate[0] || at[1] !== coordinate[1]) continue;
    const base = Number(player.playerState) & 0xff;
    if (base === STANDING || base === MOVING) return player.playerId;
  }
  return null;
}

function reportsOf(command: ReplayCommand): Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
