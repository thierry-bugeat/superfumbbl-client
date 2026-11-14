import { GameSession, NetCommandId, type GameJson, type ServerCommand } from '@fumbbl40k/ffb-protocol';
import { installMouseEntropy, withEntropy } from '../../game/mouseEntropy';
import { REPLAY_MODEL_COMMANDS } from '../../game/replay/replayModel';
import type { ReplayCommand } from '../../game/replay/replayController';
import { resolveLiveCredentials, type LiveCredentials } from './liveCredentials';

/**
 * Direct par socket, exactement comme le client 2D : une `GameSession` en mode spectateur, un
 * `SERVER_GAME_STATE` qui donne l'état courant, puis le flux `SERVER_MODEL_SYNC` que le serveur
 * pousse à chaque action.
 *
 * L'instantané sert de base et le flux écrit la suite, donc tout vient de la même session. C'est
 * ce qui évite d'avoir à raccorder deux sources : le serveur renumérote le flux d'un replay en
 * 1..N tandis que le direct vient d'un autre générateur, et les deux numérotations ne se bornent
 * pas (cf. `game/replay/liveSpectateHistory.ts`, qui recolle par contenu pour cette raison).
 */

/** Attentes successives entre deux tentatives. La dernière est répétée jusqu'à `MAX_ATTEMPTS`. */
const RECONNECT_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
const MAX_ATTEMPTS = 12;

export interface LiveSpectatorHandlers {
  /**
   * État courant du match, à la connexion puis à chaque reprise. C'est la base de tout ce qui
   * suit : l'appelant repart de là, car le serveur ne rejoue pas ce qu'on a manqué entre-temps.
   */
  onSnapshot(game: GameJson): void;
  /** Nouvelles commandes à appliquer sur cette base, dans l'ordre d'arrivée. */
  onCommands(commands: readonly ReplayCommand[]): void;
  /** Le socket est tombé. `permanent` : il ne reviendra pas, l'appelant doit couper le direct. */
  onDown(permanent: boolean): void;
}

/** Ce qu'une timeline sait rejouer. Le reste du flux (pong, join, statut) ne l'intéresse pas. */
function isTimelineCommand(command: ServerCommand): command is ReplayCommand {
  if (!Number.isInteger(command.commandNr)) return false;
  return REPLAY_MODEL_COMMANDS.has(command.netCommandId) || command.netCommandId === NetCommandId.SERVER_TALK;
}

export class LiveSpectator {
  private session: GameSession | null = null;
  private detachEntropy: (() => void) | null = null;
  /** Arrivé entre l'instantané et la timeline bâtie dessus : gardé, puis livré dans l'ordre. */
  private pending: ReplayCommand[] = [];
  private flowing = false;
  private stopped = false;
  private joined = false;
  private attempts = 0;
  private retryTimer = 0;

  constructor(private readonly gameId: number, private readonly handlers: LiveSpectatorHandlers) {}

  get live(): boolean {
    return this.joined;
  }

  /**
   * Ouvre le socket. Renvoie `false` quand aucun compte n'est lisible : la page 3D est servie dans
   * une iframe et ne peut pas demander d'identifiants, l'appelant se rabat alors sur le replay.
   */
  async start(search: URLSearchParams): Promise<boolean> {
    const credentials = await resolveLiveCredentials(search);
    if (this.stopped || !credentials.coach) return false;
    this.detachEntropy = installMouseEntropy();
    this.connect(credentials);
    return true;
  }

  /** La timeline bâtie sur l'instantané est prête : on vide le tampon, puis on diffuse au fil de l'eau. */
  open(): void {
    this.flowing = true;
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.detachEntropy?.();
    this.detachEntropy = null;
    this.closeSession();
  }

  private connect(credentials: LiveCredentials): void {
    const session = new GameSession({
      url: credentials.url,
      compression: credentials.compression,
      decorateOutgoing: withEntropy,
    });
    this.session = session;
    session.on('join', () => {
      if (this.session !== session) return;
      this.attempts = 0;
      this.joined = true;
    });
    session.on('gameState', (command) => {
      if (this.session !== session) return;
      // L'instantané contient déjà tout ce qui précède : ce qui attendait dans le tampon ferait double emploi.
      this.pending = [];
      this.flowing = false;
      this.handlers.onSnapshot(structuredClone(command.game) as GameJson);
    });
    session.on('command', (command) => {
      if (this.session !== session || !isTimelineCommand(command)) return;
      this.pending.push(structuredClone(command) as ReplayCommand);
      this.flush();
    });
    // Un refus du serveur (compte inconnu, mot de passe faux, partie fermée) arrive en SERVER_STATUS
    // et ferme la session : le réessayer douze fois ne ferait que rejouer le même refus.
    session.on('status', () => { if (this.session === session) this.attempts = MAX_ATTEMPTS; });
    session.on('refused', () => { if (this.session === session) this.attempts = MAX_ATTEMPTS; });
    session.on('close', () => { if (this.session === session) this.retry(credentials); });
    session.on('error', () => { if (this.session === session) this.retry(credentials); });
    session
      .join({ coach: credentials.coach, password: credentials.password, gameId: this.gameId, mode: 'spectator' })
      .catch(() => this.retry(credentials));
  }

  private flush(): void {
    if (!this.flowing || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.handlers.onCommands(batch);
  }

  private retry(credentials: LiveCredentials): void {
    if (this.stopped) return;
    this.joined = false;
    // Rien ne sort tant que la reprise n'a pas livré son instantané : la base d'avant est périmée.
    this.flowing = false;
    this.pending = [];
    this.closeSession();
    this.attempts += 1;
    const permanent = this.attempts >= MAX_ATTEMPTS;
    this.handlers.onDown(permanent);
    if (permanent) { this.stop(); return; }
    const wait = RECONNECT_MS[Math.min(this.attempts - 1, RECONNECT_MS.length - 1)]!;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => { if (!this.stopped) this.connect(credentials); }, wait);
  }

  private closeSession(): void {
    const session = this.session;
    this.session = null;
    this.joined = false;
    try { session?.close(); } catch { /* le socket est déjà parti */ }
  }
}
