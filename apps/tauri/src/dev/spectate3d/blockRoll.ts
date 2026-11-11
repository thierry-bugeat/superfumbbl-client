import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { BLOCK_DIE_SURFACE_COLOURS, resolveBlockDieSurface } from '@fumbbl40k/ffb-pitch/src/blockDieSurface';
import { squareToWorld } from '@fumbbl40k/ffb-pitch3d';
import type { ReplayCommand } from '../../game/replay/replayController';

export interface BlockRollView {
  key: string;
  x: number;
  z: number;
  faces: number[];
  chosen: number | null;
  choosingTeamId: string | null;
}

/** Rapports qui prolongent le blocage en cours, après le jet. */
const CONTINUES = new Set([
  'blockChoice',
  'pushback',
  'armourRoll',
  'injury',
  'seriousInjury',
  'apothecaryChoice',
  'apothecaryRoll',
  'regenerationRoll',
  'pilingOn',
  'decayRoll',
  'casualtyRoll',
]);

const SCAN = 80;

/**
 * Le jet visible à cette position du replay. On remonte depuis la commande
 * courante jusqu'au `blockRoll` (ou sa relance), sans dépasser le début du bloc.
 */
export function blockRollAt(commands: readonly ReplayCommand[], index: number, game: GameJson): BlockRollView | null {
  let chosen: number | null = null;
  const start = Math.max(0, index - 1);
  const stop = Math.max(0, start - SCAN);
  for (let i = start; i >= stop; i -= 1) {
    const reports = reportsOf(commands[i]);
    if (reports.length === 0) continue;
    const roll = reports.find((report) => report.reportId === 'blockReRoll')
      ?? reports.find((report) => report.reportId === 'blockRoll');
    if (roll) {
      const same = reports.find((report) => report.reportId === 'blockChoice');
      const picked = chosen ?? diceIndex(same);
      return viewOf(roll, i, picked, defenderId(roll) || defenderBehind(commands, i, stop), game);
    }
    const choice = reports.find((report) => report.reportId === 'blockChoice');
    if (choice && chosen === null) chosen = diceIndex(choice);
    if (reports.some((report) => report.reportId === 'block')) return null;
    if (reports.some((report) => !CONTINUES.has(String(report.reportId)))) return null;
  }
  return null;
}

/** Settings → Art → Block die surface. `auto` follows the face set; `team` uses the chooser's side. */
export function blockDiceColor(setting: unknown, family: unknown, choosingTeamId: string | null, game: GameJson): number {
  const side = choosingTeamId && choosingTeamId === game.teamHome?.teamId ? 'home'
    : choosingTeamId && choosingTeamId === game.teamAway?.teamId ? 'away'
    : null;
  const surface = resolveBlockDieSurface(typeof family === 'string' ? family : 'default', setting, side);
  return Number.parseInt(BLOCK_DIE_SURFACE_COLOURS[surface].fill.slice(1), 16);
}

function viewOf(report: Record<string, unknown>, commandIndex: number, chosen: number | null, defender: string, game: GameJson): BlockRollView | null {
  const faces = facesOf(report.blockRoll);
  if (!faces) return null;
  const point = defenderPoint(game, defender);
  const picked = chosen !== null && chosen >= 0 && chosen < faces.length ? chosen : null;
  return {
    key: `${commandIndex}:${faces.join(',')}:${defender}`,
    x: point.x,
    z: point.z,
    faces,
    chosen: picked,
    choosingTeamId: typeof report.choosingTeamId === 'string' ? report.choosingTeamId : null,
  };
}

function diceIndex(report: Record<string, unknown> | undefined): number | null {
  const index = report?.diceIndex;
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

function defenderId(report: Record<string, unknown>): string {
  return typeof report.defenderId === 'string' ? report.defenderId : '';
}

/** Le rapport `block` qui ouvre le jet porte le défenseur quand le jet lui-même l'omet. */
function defenderBehind(commands: readonly ReplayCommand[], from: number, stop: number): string {
  for (let i = from; i >= stop; i -= 1) {
    for (const report of reportsOf(commands[i])) {
      if (report.reportId === 'block') return defenderId(report);
    }
  }
  return '';
}

function facesOf(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const faces = value.filter((face): face is number => typeof face === 'number' && face >= 1 && face <= 6).slice(0, 3);
  return faces.length > 0 ? faces : null;
}

function defenderPoint(game: GameJson, playerId: string): { x: number; z: number } {
  const data = game.fieldModel?.playerDataArray?.find((player) => player.playerId === playerId);
  const coordinate = data?.playerCoordinate;
  if (coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14) {
    return squareToWorld(coordinate[0], coordinate[1]);
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
