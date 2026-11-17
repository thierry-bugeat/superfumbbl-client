import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { pushedPlayerId } from '@fumbbl40k/ffb-protocol';
import type { GroundMark } from '@fumbbl40k/ffb-pitch3d';
import { directionDelta } from '../../game/ballOutPresentation';
import type { ReplayCommand } from '../../game/replay/replayController';

/** La poussée résolue : on garde les cases le temps que la figurine arrive. */
const HOLD_STEPS = 5;
const PUSH_HOLD = new Set([
  'pushback', 'blockChoice', 'skillUse', 'skillUseOtherPlayer',
  'injury', 'apothecaryChoice', 'apothecaryRoll', 'regenerationRoll',
  'pilingOn', 'seriousInjury', 'decayRoll', 'casualtyRoll',
]);
const SCATTER_IDS = new Set(['kickoffScatter', 'passDeviate', 'scatterBall', 'scatterPlayer']);
const SCATTER_HOLD = new Set(['skillUse', 'skillUseOtherPlayer', 'reRoll']);
const SCAN = 15;

/** Sens inverse de la poussée : la case d'où part le joueur. Même table que le protocole. */
const FROM_DELTA: Record<string, [number, number]> = {
  north: [0, 1], northeast: [-1, 1], east: [-1, 0], southeast: [-1, -1],
  south: [0, -1], southwest: [1, -1], west: [1, 0], northwest: [1, 1],
};

interface PushSquare {
  coordinate?: [number, number] | null;
  direction?: string;
  selected?: boolean;
  locked?: boolean;
}

/**
 * Cases offertes pendant une poussée, et flèches de dispersion.
 * Après le choix, les cases restent quelques commandes : c'est là qu'on voit
 * lesquelles étaient possibles, et laquelle a été retenue.
 */
export class GroundMarkTrack {
  private held: GroundMark[] | null = null;
  private until = -1;

  reset(): void {
    this.held = null;
    this.until = -1;
  }

  at(commands: readonly ReplayCommand[], index: number, game: GameJson, jumped: boolean): GroundMark[] {
    const sideStep = sideStepNear(commands, index);
    const live = pushMarks(game, sideStep);
    const scatter = scatterMarks(commands, index, game);
    if (live.length > 0) {
      this.held = live;
      this.until = index + HOLD_STEPS;
      return [...live, ...scatter];
    }
    if (!jumped && this.held && index <= this.until && pushStillShowing(commands, index)) {
      return [...withSideStep(this.held, sideStep), ...scatter];
    }
    this.held = null;
    return scatter;
  }
}

function pushMarks(game: GameJson, sideStep: boolean): GroundMark[] {
  const squares = (game.fieldModel?.pushbackSquareArray ?? []) as PushSquare[];
  const marks: GroundMark[] = [];
  for (const square of squares) {
    const to = onPitch(square.coordinate);
    if (!to) continue;
    const from = pushOrigin(game, square, to);
    marks.push({
      fromX: from[0],
      fromY: from[1],
      toX: to[0],
      toY: to[1],
      plate: sideStep ? 'sidestep' : 'push',
      role: square.selected ? 'chosen' : square.locked ? 'settled' : 'open',
    });
  }
  return marks;
}

function pushOrigin(game: GameJson, square: PushSquare, to: [number, number]): [number, number] {
  const playerId = square.coordinate
    ? pushedPlayerId(game, { coordinate: square.coordinate, direction: square.direction })
    : undefined;
  const standing = playerSquare(game, playerId);
  if (standing) return standing;
  const delta = FROM_DELTA[String(square.direction ?? '').toLowerCase()];
  return delta ? [to[0] + delta[0], to[1] + delta[1]] : to;
}

function withSideStep(marks: readonly GroundMark[], sideStep: boolean): GroundMark[] {
  if (!sideStep) return [...marks];
  return marks.map((mark) => (mark.plate === 'none' ? mark : { ...mark, plate: 'sidestep' }));
}

/** Le dernier rapport de poussée décide la couleur : cyan pour un pas de côté, jaune sinon. */
function sideStepNear(commands: readonly ReplayCommand[], index: number): boolean {
  const stop = Math.max(0, index - 6);
  for (let i = index - 1; i >= stop; i -= 1) {
    const reports = [...reportsOf(commands[i])].reverse();
    for (const report of reports) {
      if (report.reportId !== 'pushback') continue;
      return report.pushbackMode === 'sideStep';
    }
  }
  return false;
}

function pushStillShowing(commands: readonly ReplayCommand[], index: number): boolean {
  const reports = reportsOf(commands[index - 1]);
  if (reports.length === 0) return true;
  return reports.every((report) => PUSH_HOLD.has(String(report.reportId)));
}

function scatterMarks(commands: readonly ReplayCommand[], index: number, game: GameJson): GroundMark[] {
  const start = Math.max(0, index - 1);
  const stop = Math.max(0, start - SCAN);
  for (let i = start; i >= stop; i -= 1) {
    const reports = reportsOf(commands[i]);
    if (reports.length === 0) continue;
    const scatter = [...reports].reverse().find((report) => SCATTER_IDS.has(String(report.reportId)));
    if (scatter) return marksOfScatter(scatter, game);
    if (reports.some((report) => !SCATTER_HOLD.has(String(report.reportId)))) return [];
  }
  return [];
}

function marksOfScatter(report: Record<string, unknown>, game: GameJson): GroundMark[] {
  const id = String(report.reportId);
  if (id === 'kickoffScatter' || id === 'passDeviate') return straightScatter(report, game);
  if (id === 'scatterBall') return walkedScatter(report, onPitch(game.fieldModel?.ballCoordinate), game.fieldModel?.outOfBounds === true);
  if (id === 'scatterPlayer') return playerScatter(report);
  return [];
}

function straightScatter(report: Record<string, unknown>, game: GameJson): GroundMark[] {
  const delta = directionDelta(report.scatterDirection);
  const distance = whole(report.rollScatterDistance);
  if (!delta || distance === null || distance <= 0) return [];
  const end = grid(report.ballCoordinateEnd) ?? grid(report.endCoordinate);
  if (end) {
    const start: [number, number] = [end[0] - delta[0] * distance, end[1] - delta[1] * distance];
    return hopLine(start, delta, distance);
  }
  const throwerId = typeof report.playerId === 'string' ? report.playerId : game.actingPlayer?.playerId ?? undefined;
  const from = playerSquare(game, throwerId ?? undefined) ?? onPitch(game.fieldModel?.ballCoordinate);
  return from ? hopLine(from, delta, distance) : [];
}

function walkedScatter(report: Record<string, unknown>, ball: [number, number] | null, leftPitch: boolean): GroundMark[] {
  let directions = list(report.directionArray ?? report.directions);
  if (leftPitch) directions = directions.slice(0, -1);
  if (!ball || directions.length === 0) return [];
  const deltas = directions.map((direction) => directionDelta(direction));
  if (deltas.some((delta) => !delta)) return [];
  let [x, y] = ball;
  for (const delta of [...deltas].reverse()) {
    x -= delta![0];
    y -= delta![1];
  }
  const marks: GroundMark[] = [];
  for (const delta of deltas) {
    const next: [number, number] = [x + delta![0], y + delta![1]];
    if (!onPitch(next)) break;
    marks.push(arrow(x, y, next[0], next[1]));
    [x, y] = next;
  }
  return marks;
}

function playerScatter(report: Record<string, unknown>): GroundMark[] {
  const start = onPitch(report.startCoordinate);
  const directions = list(report.directionArray ?? report.directions);
  if (!start || directions.length === 0) return [];
  const marks: GroundMark[] = [];
  let [x, y] = start;
  for (const direction of directions) {
    const delta = directionDelta(direction);
    if (!delta) break;
    const next: [number, number] = [x + delta[0], y + delta[1]];
    if (!onPitch(next)) break;
    marks.push(arrow(x, y, next[0], next[1]));
    [x, y] = next;
  }
  return marks;
}

function hopLine(start: [number, number], delta: readonly [number, number], distance: number): GroundMark[] {
  const marks: GroundMark[] = [];
  let [x, y] = start;
  for (let step = 0; step < distance; step += 1) {
    const next: [number, number] = [x + delta[0], y + delta[1]];
    if (!onPitch(next)) break;
    marks.push(arrow(x, y, next[0], next[1]));
    [x, y] = next;
  }
  return marks;
}

function arrow(fromX: number, fromY: number, toX: number, toY: number): GroundMark {
  return { fromX, fromY, toX, toY, plate: 'none', role: 'open' };
}

function playerSquare(game: GameJson, playerId: string | undefined): [number, number] | null {
  if (!playerId) return null;
  const data = game.fieldModel?.playerDataArray?.find((player) => player.playerId === playerId);
  return onPitch(data?.playerCoordinate);
}

function grid(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = value[0];
  const y = value[1];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return [x, y];
}

function onPitch(value: unknown): [number, number] | null {
  const square = grid(value);
  if (!square || square[0] < 0 || square[0] > 25 || square[1] < 0 || square[1] > 14) return null;
  return square;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function reportsOf(command: ReplayCommand | undefined): Record<string, unknown>[] {
  const listValue = command?.reportList;
  if (!listValue || typeof listValue !== 'object') return [];
  const reports = (listValue as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
