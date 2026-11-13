import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { squareToWorld } from '@fumbbl40k/ffb-pitch3d';
import type { NumberDiceSpec } from '@fumbbl40k/ffb-pitch3d';
import type { ReplayCommand } from '../../game/replay/replayController';

/** Rapports qui suivent la blessure sans être un nouveau jet. */
const AFTERMATH = new Set([
  'apothecaryChoice',
  'apothecaryRoll',
  'regenerationRoll',
  'pilingOn',
  'seriousInjury',
  'decayRoll',
  'casualtyRoll',
]);

const SCAN = 40;

/**
 * Le jet visible à cette position : le ramassage (un dé), ou le passage
 * d'armure puis la blessure. On remonte depuis la commande courante.
 */
export function numberRollAt(commands: readonly ReplayCommand[], index: number, game: GameJson): NumberDiceSpec | null {
  const start = Math.max(0, index - 1);
  const stop = Math.max(0, start - SCAN);
  for (let i = start; i >= stop; i -= 1) {
    const reports = reportsOf(commands[i]);
    if (reports.length === 0) continue;
    const injury = reports.find((report) => report.reportId === 'injury' && (pair(report.armorRoll) || pair(report.injuryRoll)));
    if (injury) return injuryView(injury, i, game);
    const pickup = [...reports].reverse().find((report) => report.reportId === 'pickUpRoll' && die(report.roll) !== null);
    if (pickup) return pickupView(pickup, i, game);
    if (reports.some((report) => !AFTERMATH.has(String(report.reportId)))) return null;
  }
  return null;
}

function pickupView(report: Record<string, unknown>, commandIndex: number, game: GameJson): NumberDiceSpec | null {
  const value = die(report.roll);
  if (value === null) return null;
  const playerId = typeof report.playerId === 'string' ? report.playerId : '';
  const point = besidePlayer(game, playerId);
  return {
    key: `${commandIndex}:pickup:${value}:${playerId}`,
    x: point.x,
    z: point.z,
    rolls: [[value]],
  };
}

function injuryView(report: Record<string, unknown>, commandIndex: number, game: GameJson): NumberDiceSpec | null {
  const armour = pair(report.armorRoll);
  const broken = report.armorBroken !== false;
  const injury = broken ? pair(report.injuryRoll) : null;
  const rolls = [armour, injury].filter((roll): roll is [number, number] => roll !== null);
  if (rolls.length === 0) return null;
  const defender = typeof report.defenderId === 'string' ? report.defenderId
    : typeof report.playerId === 'string' ? report.playerId
    : '';
  const point = besidePlayer(game, defender);
  return {
    key: `${commandIndex}:${rolls.map((roll) => roll.join('+')).join('|')}:${defender}`,
    x: point.x,
    z: point.z,
    rolls,
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

/** À côté du joueur, pour laisser voir les dés de bloc posés sur sa case. */
function besidePlayer(game: GameJson, playerId: string): { x: number; z: number } {
  const data = game.fieldModel?.playerDataArray?.find((player) => player.playerId === playerId);
  const coordinate = data?.playerCoordinate;
  if (coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14) {
    const point = squareToWorld(coordinate[0], coordinate[1]);
    const shift = coordinate[0] >= 22 ? -0.95 : 0.95;
    return { x: point.x + shift, z: point.z };
  }
  return { x: 0, z: 0 };
}

function reportsOf(command: ReplayCommand | undefined): Record<string, unknown>[] {
  const list = command?.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
