import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { parseReplayFile } from '../../game/replay/replayLoader';
import { applyReplayCommand, createReplaySeed } from '../../game/replay/replayModel';
import type { ReplayCommand } from '../../game/replay/replayController';

export interface ReplayTimeline {
  commands: readonly ReplayCommand[];
  /** states[0] est le départ, states[i] est l'état après commands[i - 1]. */
  states: GameJson[];
}

export function buildReplayTimeline(text: string): ReplayTimeline {
  const bundle = parseReplayFile(text);
  const seed = createReplaySeed(bundle.finalState);
  const states: GameJson[] = [structuredClone(seed)];
  for (const command of bundle.commands) {
    applyReplayCommand(seed, command);
    states.push(structuredClone(seed));
  }
  return { commands: bundle.commands, states };
}
