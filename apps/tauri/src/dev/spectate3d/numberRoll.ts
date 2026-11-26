import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { squareToWorld } from '@fumbbl40k/ffb-pitch3d';
import type { NumberDiceSpec } from '@fumbbl40k/ffb-pitch3d';
import type { ReplayCommand } from '../../game/replay/replayController';
import { playerSquareAt } from './rollSquare';

/** Rapports qui suivent un jet sans en être un nouveau. */
const AFTERMATH = new Set([
  'apothecaryChoice',
  'apothecaryRoll',
  'regenerationRoll',
  'pilingOn',
  'seriousInjury',
  'decayRoll',
  'casualtyRoll',
  'skillUse',
  'skillUseOtherPlayer',
  'reRoll',
]);

/** Jets à un dé qui décident une action. Le bloc a ses propres dés. */
const ACTION_ROLLS = new Set([
  'dodgeRoll',
  'goForItRoll',
  'passRoll',
  'catchRoll',
  'interceptionRoll',
  'leapRoll',
]);

const SCAN = 40;

/**
 * Le jet visible à cette position : esquive, rush, passe, réception, interception,
 * saut, ramassage, ou le passage d'armure puis la blessure.
 * On remonte depuis la commande courante, et on garde le jet tant que la suite
 * ne commence pas autre chose.
 */
export function numberRollAt(commands: readonly ReplayCommand[], index: number, game: GameJson): NumberDiceSpec | null {
  const start = Math.max(0, index - 1);
  const stop = Math.max(0, start - SCAN);
  for (let i = start; i >= stop; i -= 1) {
    const reports = reportsOf(commands[i]);
    if (reports.length === 0) continue;
    const injury = reports.find((report) => report.reportId === 'injury' && (pair(report.armorRoll) || pair(report.injuryRoll)));
    if (injury) return injuryView(commands, injury, i, game);
    const actions = reports.filter((report) => ACTION_ROLLS.has(String(report.reportId)) && die(report.roll) !== null);
    if (actions.length > 0) return actionView(commands, actions, i, game);
    const pickup = [...reports].reverse().find((report) => report.reportId === 'pickUpRoll' && die(report.roll) !== null);
    if (pickup) return pickupView(commands, pickup, i, game);
    if (reports.some((report) => !AFTERMATH.has(String(report.reportId)))) return null;
  }
  return null;
}

function actionView(
  commands: readonly ReplayCommand[],
  reports: readonly Record<string, unknown>[],
  commandIndex: number,
  game: GameJson,
): NumberDiceSpec | null {
  const rolls = reports
    .map((report) => die(report.roll))
    .filter((value): value is number => value !== null)
    .map((value) => [value]);
  if (rolls.length === 0) return null;
  const last = reports[reports.length - 1];
  const playerId = typeof last?.playerId === 'string' && last.playerId
    ? last.playerId
    : actingPlayerId(game);
  const point = besidePlayer(commands, commandIndex, game, playerId);
  const ids = reports.map((report) => String(report.reportId)).join('+');
  return {
    key: `${commandIndex}:${ids}:${rolls.map((roll) => roll[0]).join('.')}:${playerId}`,
    x: point.x,
    z: point.z,
    rolls,
  };
}

function pickupView(
  commands: readonly ReplayCommand[],
  report: Record<string, unknown>,
  commandIndex: number,
  game: GameJson,
): NumberDiceSpec | null {
  const value = die(report.roll);
  if (value === null) return null;
  const playerId = typeof report.playerId === 'string' ? report.playerId : '';
  const point = besidePlayer(commands, commandIndex, game, playerId);
  return {
    key: `${commandIndex}:pickup:${value}:${playerId}`,
    x: point.x,
    z: point.z,
    rolls: [[value]],
  };
}

function injuryView(
  commands: readonly ReplayCommand[],
  report: Record<string, unknown>,
  commandIndex: number,
  game: GameJson,
): NumberDiceSpec | null {
  const armour = pair(report.armorRoll);
  const broken = report.armorBroken !== false;
  const wound = broken ? pair(report.injuryRoll) : null;
  const rolls: [number, number][] = [];
  const injury: boolean[] = [];
  if (armour) {
    rolls.push(armour);
    injury.push(false);
  }
  if (wound) {
    rolls.push(wound);
    injury.push(true);
  }
  if (rolls.length === 0) return null;
  const defender = typeof report.defenderId === 'string' ? report.defenderId
    : typeof report.playerId === 'string' ? report.playerId
    : '';
  const square = playerSquareAt(commands, commandIndex, defender, game);
  const point = besidePlayer(commands, commandIndex, game, defender);
  const anchor = square ? squareToWorld(square[0], square[1]) : null;
  return {
    key: `${commandIndex}:${rolls.map((roll) => roll.join('+')).join('|')}:${defender}`,
    x: point.x,
    z: point.z,
    rolls,
    injury,
    playerId: defender,
    ...(anchor ? { anchor: { x: anchor.x, z: anchor.z } } : {}),
  };
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = die(value[0]);
  const second = die(value[1]);
  if (first === null || second === null) return null;
  return [first, second];
}

function die(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}

function actingPlayerId(game: GameJson): string {
  const playerId = game.actingPlayer?.playerId;
  return typeof playerId === 'string' ? playerId : '';
}

/** À côté de la case du jet, pour laisser voir les dés de bloc posés dessus. */
function besidePlayer(
  commands: readonly ReplayCommand[],
  commandIndex: number,
  game: GameJson,
  playerId: string,
): { x: number; z: number } {
  const coordinate = playerSquareAt(commands, commandIndex, playerId, game);
  if (!coordinate) return { x: 0, z: 0 };
  const point = squareToWorld(coordinate[0], coordinate[1]);
  const shift = coordinate[0] >= 22 ? -0.95 : 0.95;
  return { x: point.x + shift, z: point.z };
}

function reportsOf(command: ReplayCommand | undefined): Record<string, unknown>[] {
  const list = command?.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
