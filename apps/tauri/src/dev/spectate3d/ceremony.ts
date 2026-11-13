import type { GameJson, TeamResultJson } from '@fumbbl40k/ffb-protocol';
import { teamSentOff } from '../../game/gameStatRows';
import { postGamePublic } from '../../game/postGameProjection';
import { t } from '../../i18n';

/**
 * Cartes plein écran qui suivent le même fond que domicile / extérieur :
 * touchdown, mi-temps, et fin de match avec les chiffres du résultat 2D.
 */

export const TOUCHDOWN_DWELL_MS = 4800;
export const HALFTIME_DWELL_MS = 5600;
export const FINAL_DWELL_MS = 11000;

export interface CeremonyCommand {
  reportList?: unknown;
  modelChangeList?: unknown;
  [key: string]: unknown;
}

export interface CeremonySide {
  teamName: string;
  coach: string;
  race: string;
  score: string;
  /** Sous le coach : le marqueur, seulement sur l'écran Touchdown. */
  meta: string;
  /** Gains, fans, JMV. Seulement sur la fin de match. */
  lines: string[];
  highlight: 'scoring' | 'winner' | null;
}

export interface CeremonyStat {
  label: string;
  home: string;
  away: string;
  homeLead: boolean;
  awayLead: boolean;
}

export interface CeremonyCard {
  kind: 'touchdown' | 'halftime' | 'final';
  titleKey: 'spectate3d.ceremony.touchdown' | 'spectate3d.ceremony.halfTime' | 'spectate3d.ceremony.fullTime';
  dwellMs: number;
  home: CeremonySide;
  away: CeremonySide;
  verdict: string;
  stats: CeremonyStat[];
  defectors: string;
}

export function ceremoniesForStep(input: {
  game: GameJson;
  command: CeremonyCommand | null;
  commands: readonly CeremonyCommand[];
  /** Commandes déjà appliquées. 0 = avant la première. */
  index: number;
  jumped: boolean;
  finalAlreadyShown: boolean;
  halfAlreadyShown: boolean;
}): { cards: CeremonyCard[]; finalShown: boolean; halfShown: boolean } {
  const over = gameIsOver(input.game);
  let finalShown = input.finalAlreadyShown && over;
  const cards: CeremonyCard[] = [];
  const scorerId = input.command ? scoringPlayerId(input.command) : null;
  if (scorerId) {
    const card = scoreCard(input.game, 'touchdown', TOUCHDOWN_DWELL_MS);
    if (card) {
      const side = playerSide(input.game, scorerId);
      const name = playerName(input.game, scorerId);
      if (side && name) {
        card[side].meta = t('spectate3d.ceremony.scorer', { name });
        card[side].highlight = 'scoring';
      }
      cards.push(card);
    }
  }
  if (halfTimeCommand(input.command) && !input.halfAlreadyShown && !over) {
    const card = scoreCard(input.game, 'halftime', HALFTIME_DWELL_MS);
    if (card) cards.push(card);
  }
  if (shouldShowFinal(input, over)) {
    const card = finalCard(input.game, input.commands, input.index);
    if (card) {
      cards.push(card);
      finalShown = true;
    }
  }
  const stillInSecondHalf = Math.floor(Number(input.game.half) || 0) >= 2;
  const halfShown = cards.some((card) => card.kind === 'halftime') || (input.halfAlreadyShown && stillInSecondHalf);
  return { cards, finalShown, halfShown };
}

export function gameIsOver(game: GameJson): boolean {
  if (game.finished != null && String(game.finished) !== '') return true;
  return String(game.turnMode ?? '') === 'endGame';
}

function shouldShowFinal(input: {
  game: GameJson;
  command: CeremonyCommand | null;
  commands: readonly CeremonyCommand[];
  index: number;
  jumped: boolean;
  finalAlreadyShown: boolean;
}, over: boolean): boolean {
  if (input.finalAlreadyShown || !over) return false;
  if (input.jumped) return true;
  if (!input.command) return false;
  // Les gains et le jet de fans précèdent le dialogue de statistiques et la fin officielle.
  if (commandSetsFinished(input.command) || dialogId(input.command) === 'gameStatistics') return true;
  return commandSetsTurnMode(input.command, 'endGame') && input.index >= input.commands.length;
}

function scoreCard(game: GameJson, kind: 'touchdown' | 'halftime', dwellMs: number): CeremonyCard | null {
  const sides = sidesOf(game);
  if (!sides) return null;
  return {
    kind,
    titleKey: kind === 'touchdown' ? 'spectate3d.ceremony.touchdown' : 'spectate3d.ceremony.halfTime',
    dwellMs,
    home: { ...sides.home, meta: '', lines: [], highlight: null },
    away: { ...sides.away, meta: '', lines: [], highlight: null },
    verdict: '',
    stats: [],
    defectors: '',
  };
}

function finalCard(game: GameJson, commands: readonly CeremonyCommand[], index: number): CeremonyCard | null {
  const sides = sidesOf(game);
  if (!sides) return null;
  const fans = fanRolls(commands, index);
  const homeResult = game.gameResult?.teamResultHome;
  const awayResult = game.gameResult?.teamResultAway;
  const home: CeremonySide = {
    ...sides.home,
    meta: '',
    lines: resultLines(homeResult, fans?.home ?? null, sides.mvps.home),
    highlight: sides.winner === 'home' ? 'winner' : null,
  };
  const away: CeremonySide = {
    ...sides.away,
    meta: '',
    lines: resultLines(awayResult, fans?.away ?? null, sides.mvps.away),
    highlight: sides.winner === 'away' ? 'winner' : null,
  };
  const names = defectorNames(game);
  return {
    kind: 'final',
    titleKey: 'spectate3d.ceremony.fullTime',
    dwellMs: FINAL_DWELL_MS,
    home,
    away,
    verdict: sides.winner
      ? t('cards.postGamePanel.p0Wins', { p0: (sides.winner === 'home' ? home : away).teamName })
      : t('cards.postGamePanel.draw'),
    stats: statRows(game),
    defectors: names.length
      ? `${names.length} ${t('cards.postGamePanel.playerP0DefectedAfter', { n: names.length })} ${names.join(', ')}`
      : '',
  };
}

interface SideCore { teamName: string; coach: string; race: string; score: string }

function sidesOf(game: GameJson): { home: SideCore; away: SideCore; winner: 'home' | 'away' | null; mvps: { home: string[]; away: string[] } } | null {
  const homeTeam = game.teamHome;
  const awayTeam = game.teamAway;
  if (!homeTeam && !awayTeam) return null;
  let winner: 'home' | 'away' | null = null;
  let mvps = { home: [] as string[], away: [] as string[] };
  try {
    const pub = postGamePublic(game);
    if (pub) {
      winner = pub.draw ? null : pub.winner === pub.home ? 'home' : 'away';
      mvps = {
        home: mvpNames(pub.home.mvps),
        away: mvpNames(pub.away.mvps),
      };
    }
  } catch {
    winner = null;
  }
  return {
    home: sideCore(homeTeam, scoreOf(game, 'home')),
    away: sideCore(awayTeam, scoreOf(game, 'away')),
    winner,
    mvps,
  };
}

function sideCore(team: GameJson['teamHome'] | undefined, score: number): SideCore {
  return {
    teamName: String(team?.teamName ?? '').trim(),
    coach: String(team?.coach ?? '').trim(),
    race: String(team?.race ?? '').trim(),
    score: String(score),
  };
}

function scoreOf(game: GameJson, side: 'home' | 'away'): number {
  const result = side === 'home' ? game.gameResult?.teamResultHome : game.gameResult?.teamResultAway;
  const score = Number(result?.score);
  return Number.isFinite(score) ? score : 0;
}

function mvpNames(mvps: readonly { name: string; awards: number }[]): string[] {
  return mvps.flatMap((mvp) => Array.from({ length: Math.max(1, Math.floor(mvp.awards)) }, () => mvp.name));
}

function resultLines(
  result: TeamResultJson | undefined,
  fans: { roll: number; mod: number } | null,
  mvps: readonly string[],
): string[] {
  const lines: string[] = [];
  const winnings = Number(result?.winnings);
  if (Number.isFinite(winnings)) lines.push(t('cards.postGamePanel.pgTeamBox.p0GWinnings', { p0: winnings.toLocaleString() }));
  if (fans) {
    const mod = fans.mod > 0 ? `+${fans.mod}` : String(fans.mod);
    lines.push(`${t('cards.postGamePanel.pgTeamBox.dedicatedFansRolled')} ${fans.roll} → ${mod}`);
  } else {
    lines.push(t('cards.postGamePanel.pgTeamBox.dedicatedFansUnchanged'));
  }
  if (mvps.length) lines.push(`${t('cards.postGamePanel.mvp')}: ${mvps.join(', ')}`);
  return lines;
}

const STAT_KEYS = ['touchdowns', 'casualties', 'completions', 'passing', 'rushing', 'interceptions', 'blocks', 'fouls', 'spp'] as const;

const STAT_LABEL: Record<(typeof STAT_KEYS)[number], string> = {
  touchdowns: 'cards.postGame.postgameStats.touchdowns',
  casualties: 'cards.postGame.postgameStats.casualties',
  completions: 'cards.postGame.postgameStats.completions',
  passing: 'cards.postGame.postgameStats.passingYards',
  rushing: 'cards.postGame.postgameStats.rushingYards',
  interceptions: 'cards.postGame.postgameStats.interceptions',
  blocks: 'cards.postGame.postgameStats.blocks',
  fouls: 'cards.postGame.postgameStats.fouls',
  spp: 'cards.postGame.postgameStats.sppEarned',
};

function statRows(game: GameJson): CeremonyStat[] {
  let totals: { home: Record<string, number>; away: Record<string, number> } | null = null;
  try {
    const pub = postGamePublic(game);
    if (pub) totals = { home: pub.home.totals, away: pub.away.totals };
  } catch {
    totals = null;
  }
  if (!totals) return [];
  const rows: CeremonyStat[] = [];
  for (const key of STAT_KEYS) {
    const home = totals.home[key] ?? 0;
    const away = totals.away[key] ?? 0;
    rows.push(statRow(t(STAT_LABEL[key]), home, away));
    if (key === 'fouls') {
      let sentHome = 0;
      let sentAway = 0;
      try {
        sentHome = teamSentOff(game, 'home');
        sentAway = teamSentOff(game, 'away');
      } catch {
        sentHome = 0;
        sentAway = 0;
      }
      rows.push(statRow(t('cards.postGame.text.sentOff'), sentHome, sentAway));
    }
  }
  return rows;
}

function statRow(label: string, home: number, away: number): CeremonyStat {
  return { label, home: String(home), away: String(away), homeLead: home > away, awayLead: away > home };
}

function fanRolls(
  commands: readonly CeremonyCommand[],
  index: number,
): { home: { roll: number; mod: number }; away: { roll: number; mod: number } } | null {
  let found: { home: { roll: number; mod: number }; away: { roll: number; mod: number } } | null = null;
  const end = Math.min(index, commands.length);
  for (let i = 0; i < end; i += 1) {
    const command = commands[i];
    if (!command) continue;
    for (const report of reportsOf(command)) {
      if (String(report.reportId ?? '') !== 'dedicatedFans') continue;
      if (report.rollHome == null && report.rollAway == null) continue;
      found = {
        home: { roll: Number(report.rollHome ?? 0), mod: Number(report.dedicatedFansModifierHome ?? 0) },
        away: { roll: Number(report.rollAway ?? 0), mod: Number(report.dedicatedFansModifierAway ?? 0) },
      };
    }
  }
  return found;
}

function defectorNames(game: GameJson): string[] {
  const names: string[] = [];
  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? game.teamHome : game.teamAway;
    const results = side === 'home' ? game.gameResult?.teamResultHome?.playerResults : game.gameResult?.teamResultAway?.playerResults;
    for (const result of results ?? []) {
      if (!result || result.defecting !== true) continue;
      const name = playerName(game, String(result.playerId ?? '')) || String(team?.teamName ?? '');
      if (name) names.push(name);
    }
  }
  return names;
}

function scoringPlayerId(command: CeremonyCommand): string | null {
  for (const report of reportsOf(command)) {
    if (String(report.reportId ?? '') !== 'turnEnd') continue;
    const id = report.playerIdTouchdown;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

function halfTimeCommand(command: CeremonyCommand | null): boolean {
  if (!command) return false;
  return changesOf(command).some((change) => change.id === 'gameSetHalf' && Number(change.value) === 2);
}

function commandSetsFinished(command: CeremonyCommand): boolean {
  return changesOf(command).some((change) => change.id === 'gameSetFinished' && change.value != null && String(change.value) !== '');
}

function commandSetsTurnMode(command: CeremonyCommand, mode: string): boolean {
  return changesOf(command).some((change) => change.id === 'gameSetTurnMode' && String(change.value ?? '') === mode);
}

function dialogId(command: CeremonyCommand): string {
  for (const change of changesOf(command)) {
    if (change.id !== 'gameSetDialogParameter' || !change.value || typeof change.value !== 'object') continue;
    const id = (change.value as { dialogId?: unknown }).dialogId;
    if (typeof id === 'string') return id;
  }
  return '';
}

function playerSide(game: GameJson, playerId: string): 'home' | 'away' | null {
  if (game.teamHome?.playerArray?.some((player) => player.playerId === playerId)) return 'home';
  if (game.teamAway?.playerArray?.some((player) => player.playerId === playerId)) return 'away';
  return null;
}

function playerName(game: GameJson, playerId: string): string {
  for (const team of [game.teamHome, game.teamAway]) {
    const player = team?.playerArray?.find((entry) => entry.playerId === playerId);
    if (player?.playerName) return String(player.playerName);
  }
  return '';
}

function reportsOf(command: CeremonyCommand): Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}

function changesOf(command: CeremonyCommand): { id: string; value: unknown }[] {
  const list = command.modelChangeList;
  if (!list || typeof list !== 'object') return [];
  const changes = (list as { modelChangeArray?: unknown }).modelChangeArray;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!change || typeof change !== 'object') return [];
    const id = (change as { modelChangeId?: unknown }).modelChangeId;
    if (typeof id !== 'string' || !id) return [];
    return [{ id, value: (change as { modelChangeValue?: unknown }).modelChangeValue }];
  });
}
