import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { t } from '../../i18n';
import { parseJnlpXml } from '../../game/jnlpIntake';
import { downloadReplay, parseReplayFile, type ReplayBundle } from '../../game/replay/replayLoader';
import { applyReplayCommand, createReplaySeed, replayCommandIsTurnEnd } from '../../game/replay/replayModel';
import type { ReplayCommand } from '../../game/replay/replayController';

/** Le ticket officiel pointe toujours vers ce socket. Le port déclaré dans le fichier n'est pas utilisé pour se connecter. */
const FUMBBL_REPLAY_URL = 'ws://fumbbl.com:22223/command';

export class ReplayTimeline {
  private readonly commandList: ReplayCommand[];
  private game: GameJson;
  /** Nombre de commandes déjà appliquées. 0 = état de départ. */
  private at = 0;

  private constructor(private readonly finalState: GameJson, commands: readonly ReplayCommand[]) {
    this.commandList = [...commands];
    this.game = createReplaySeed(finalState);
  }

  get commands(): readonly ReplayCommand[] {
    return this.commandList;
  }

  /**
   * Ajoute les commandes nouvelles d'un second téléchargement du même match.
   * Le préfixe déjà connu doit coïncider, sinon on ne touche à rien.
   */
  extend(commands: readonly ReplayCommand[]): number {
    if (commands.length <= this.commandList.length) return 0;
    for (let i = 0; i < this.commandList.length; i += 1) {
      const kept = this.commandList[i];
      const incoming = commands[i];
      if (!kept || !incoming || kept.commandNr !== incoming.commandNr || kept.netCommandId !== incoming.netCommandId) return 0;
    }
    const added = commands.slice(this.commandList.length);
    this.commandList.push(...added);
    return added.length;
  }

  static fromBundle(bundle: ReplayBundle): ReplayTimeline {
    return new ReplayTimeline(bundle.finalState, bundle.commands);
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
      this.game = createReplaySeed(this.finalState);
      this.at = 0;
    }
    while (this.at < target) {
      const command = this.commands[this.at];
      if (!command) break;
      if (command.netCommandId !== NetCommandId.SERVER_TALK) applyReplayCommand(this.game, command);
      this.at += 1;
      if (onProgress && this.at % 100 === 0) {
        onProgress(this.at, target);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return this.game;
  }
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

/** Un match encore en cours : le serveur n'a pas posé d'heure de fin. */
export function replayStillLive(bundle: ReplayBundle): boolean {
  return bundle.finalState.finished == null;
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
