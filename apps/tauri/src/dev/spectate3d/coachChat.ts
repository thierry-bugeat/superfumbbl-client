import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { NetCommandId } from '@fumbbl40k/ffb-protocol';
import { chatAuthorSide, type ChatAuthorSide } from '../../game/chatAuthor';
import type { ReplayCommand } from '../../game/replay/replayController';

/** Un message de coach, comme le tchat 2D : « nom : texte », couleur selon le siège. */
export interface CoachChatLine {
  coach: string;
  text: string;
  side: ChatAuthorSide;
}

/** Les `serverTalk` déjà joués, dans l'ordre du replay. Un retour en arrière recommence la liste. */
export class CoachChat {
  private lines: CoachChatLine[] = [];
  private builtTo = 0;

  reset(): void {
    this.lines = [];
    this.builtTo = 0;
  }

  sync(commands: readonly ReplayCommand[], index: number, game: GameJson | null): readonly CoachChatLine[] {
    if (index < this.builtTo) this.reset();
    const home = game?.teamHome?.coach;
    const away = game?.teamAway?.coach;
    while (this.builtTo < index) {
      const command = commands[this.builtTo];
      this.builtTo += 1;
      const line = talkLine(command, home, away);
      if (line) this.lines.push(line);
    }
    return this.lines;
  }
}

function talkLine(command: ReplayCommand | undefined, home: unknown, away: unknown): CoachChatLine | null {
  if (!command || command.netCommandId !== NetCommandId.SERVER_TALK) return null;
  const coach = typeof command.coach === 'string' && command.coach.trim() ? command.coach.trim() : '?';
  const talks = Array.isArray(command.talks) ? command.talks.filter((part): part is string => typeof part === 'string') : [];
  const text = talks.join(' ').trim();
  if (!text) return null;
  return { coach, text, side: chatAuthorSide(home, away, coach) };
}
