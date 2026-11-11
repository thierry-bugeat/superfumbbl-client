import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { ReplayCommand } from '../../game/replay/replayController';
import { upstreamLogLines } from '../../game/upstreamLog';

/** Journal du match, dans l'ordre des commandes déjà jouées. */
export class MatchLog {
  private lines: string[] = [];
  private builtTo = 0;
  private key: object = {};

  reset(): void {
    this.lines = [];
    this.builtTo = 0;
    this.key = {};
  }

  /** Ajoute les rapports jusqu'à `index`. Un retour en arrière recommence le journal. */
  sync(commands: readonly ReplayCommand[], index: number, game: GameJson): readonly string[] {
    if (index < this.builtTo) this.reset();
    while (this.builtTo < index) {
      const command = commands[this.builtTo];
      this.builtTo += 1;
      if (!command) continue;
      for (const report of reportsOf(command)) {
        for (const line of upstreamLogLines(report, game, this.key)) {
          const text = `${'  '.repeat(line.indent)}${line.text}`.trim();
          if (text) this.lines.push(text);
        }
      }
    }
    return this.lines;
  }
}

function reportsOf(command: ReplayCommand): Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
