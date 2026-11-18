import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { t } from '../../i18n';
import { parseJnlpXml } from '../../game/jnlpIntake';
import { downloadReplay, parseReplayFile, type ReplayBundle } from '../../game/replay/replayLoader';
import { applyReplayCommand, createReplaySeed, replayCommandIsTurnEnd } from '../../game/replay/replayModel';
import type { ReplayCommand } from '../../game/replay/replayController';
import {
  captureTurnPresentationBefore,
  createTurnPresentationContext,
  turnPresentation,
  type TurnPresentationContext,
} from '../../game/turnPresentation';

/** L'équipe qui vient de perdre son tour. FFB n'a pas de drapeau turnover : c'est la lecture 2D. */
export interface TurnoverBannerCue {
  side: 'home' | 'away';
  coach: string;
  teamName: string;
  race: string;
}

/** Le ticket officiel pointe toujours vers ce socket. Le port déclaré dans le fichier n'est pas utilisé pour se connecter. */
export const FUMBBL_REPLAY_URL = 'ws://fumbbl.com:22223/command';

export class ReplayTimeline {
  private readonly commandList: ReplayCommand[];
  private game: GameJson;
  /** Nombre de commandes déjà appliquées. 0 = état de départ. */
  private at = 0;

  /** `rewind` : la base est l'état FINAL d'un replay, à remonter au coup d'envoi avant de rejouer. */
  private constructor(private readonly base: GameJson, commands: readonly ReplayCommand[], private readonly rewind: boolean) {
    this.commandList = [...commands];
    this.game = this.seed();
  }

  /** Suit les échecs d'un tour à l'autre : le turnover peut n'être scellé que plusieurs commandes plus tard. */
  private turnContext: TurnPresentationContext = createTurnPresentationContext();
  /** Turnover de la dernière commande appliquée, jusqu'à la lecture. Un seek qui n'avance pas le conserve. */
  private landedTurnover: TurnoverBannerCue | null = null;

  private seed(): GameJson {
    return this.rewind ? createReplaySeed(this.base) : structuredClone(this.base);
  }

  get commands(): readonly ReplayCommand[] {
    return this.commandList;
  }

  /**
   * Ajoute la suite reçue par le socket du direct, dans l'ordre d'arrivée.
   *
   * Pas de dédoublonnage sur `commandNr` : le serveur renumérote le flux d'un replay en 1..N
   * (`ServerReplay.orderCommands`) alors que le direct vient d'un autre générateur, donc les deux
   * numérotations ne se bornent pas. Une base issue du socket évite la question : toutes les
   * commandes viennent de la même session et arrivent une seule fois.
   */
  appendLive(commands: readonly ReplayCommand[]): number {
    this.commandList.push(...commands);
    return commands.length;
  }

  static fromBundle(bundle: ReplayBundle): ReplayTimeline {
    return new ReplayTimeline(bundle.finalState, bundle.commands, true);
  }

  /** Direct : l'instantané reçu à la connexion est la base, le flux du socket écrit la suite. */
  static fromLiveSnapshot(game: GameJson): ReplayTimeline {
    return new ReplayTimeline(game, [], false);
  }

  /**
   * Début de chaque tour d'équipe, comme le replayer : le départ, puis l'état
   * juste après chaque rapport `turnEnd`.
   */
  teamTurnCursors(): number[] {
    const cursors = [0];
    this.commands.forEach((command, index) => {
      if (replayCommandIsTurnEnd(command)) cursors.push(index + 1);
    });
    return [...new Set(cursors)];
  }

  /** Positions navigables : départ compris, donc une de plus que les commandes. */
  get length(): number {
    return this.commands.length + 1;
  }

  /**
   * Avance ou recommence depuis le départ. On ne garde pas chaque état :
   * un match entier cloné à chaque commande saturerait la mémoire.
   */
  async seek(index: number, onProgress?: (done: number, target: number) => void): Promise<GameJson> {
    const target = Math.max(0, Math.min(this.commands.length, index));
    if (target < this.at) {
      this.game = this.seed();
      this.at = 0;
      this.turnContext = createTurnPresentationContext();
      this.landedTurnover = null;
    }
    while (this.at < target) {
      const command = this.commands[this.at];
      if (!command) break;
      this.noteTurnover(command);
      this.at += 1;
      if (onProgress && this.at % 100 === 0) {
        onProgress(this.at, target);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return this.game;
  }

  /**
   * Le turnover de la commande sur laquelle on vient d'arriver, une seule fois.
   * Un saut ne réaffiche pas les turnovers dépassés : seule la commande d'arrivée compte.
   */
  takeTurnoverBanner(): TurnoverBannerCue | null {
    const cue = this.landedTurnover;
    this.landedTurnover = null;
    return cue;
  }

  private noteTurnover(command: ReplayCommand): void {
    const before = captureTurnPresentationBefore(this.game);
    if (command.netCommandId !== NetCommandId.SERVER_TALK) applyReplayCommand(this.game, command);
    const cue = turnPresentation(this.turnContext, before, this.game, commandReports(command));
    this.turnContext = cue.context;
    const splash = cue.splash;
    if (splash?.kind !== 'turnover') {
      this.landedTurnover = null;
      return;
    }
    const team = splash.side === 'home' ? this.game.teamHome : this.game.teamAway;
    this.landedTurnover = {
      side: splash.side,
      coach: splash.coach,
      teamName: splash.teamName,
      race: String(team?.race ?? ''),
    };
  }
}

function commandReports(command: ReplayCommand): readonly Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object' && !Array.isArray(report));
}

/** Replay FUMBBL déjà connu par son numéro de partie, sans fichier .jnlp. */
export async function fetchReplay(gameId: number, coach: string): Promise<ReplayBundle> {
  return downloadReplay({
    url: FUMBBL_REPLAY_URL,
    compression: true,
    gameId,
    coach,
    timeoutMs: 120_000,
  });
}

export async function loadReplayFromServer(gameId: number, coach: string): Promise<ReplayTimeline> {
  return ReplayTimeline.fromBundle(await fetchReplay(gameId, coach));
}

/** JSON déjà téléchargé, ou fichier .jnlp (le match est alors demandé à FUMBBL). */
export async function loadReplayText(text: string): Promise<ReplayTimeline> {
  const start = text.trimStart();
  if (start.startsWith('<?xml') || start.startsWith('<jnlp')) return loadJnlp(text);
  return ReplayTimeline.fromBundle(parseReplayFile(text));
}

async function loadJnlp(xml: string): Promise<ReplayTimeline> {
  const request = parseJnlpXml(xml);
  if (request.mode !== 'replay' || !request.gameId) throw new Error(t('spectate3d.jnlp.notReplay'));
  if (!request.coach) throw new Error(t('spectate3d.jnlp.noCoach'));
  const bundle = await downloadReplay({
    url: FUMBBL_REPLAY_URL,
    compression: true,
    gameId: request.gameId,
    coach: request.coach,
    auth: request.auth,
    timeoutMs: 120_000,
  });
  return ReplayTimeline.fromBundle(bundle);
}
