import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { ReplayCommand } from '../../game/replay/replayController';

/**
 * Case du joueur une fois la commande du jet appliquée.
 * Les déplacements des commandes suivantes ne comptent pas :
 * les dés restent où ils ont été lancés, ils ne suivent pas la figurine.
 */
export function playerSquareAt(
  commands: readonly ReplayCommand[],
  commandIndex: number,
  playerId: string,
  game: GameJson,
): [number, number] | null {
  if (!playerId) return squareOnPitch(squareFromGame(game, playerId));
  let square: [number, number] | null = null;
  let known = false;
  const last = Math.min(commandIndex, commands.length - 1);
  for (let i = 0; i <= last; i += 1) {
    for (const change of changesOf(commands[i])) {
      if (change.key !== playerId) continue;
      if (change.id === 'fieldModelRemovePlayer') {
        known = true;
        const left = squareOnPitch(change.value);
        if (left) square = left;
        continue;
      }
      if (change.id !== 'fieldModelSetPlayerCoordinate') continue;
      known = true;
      const next = squareOnPitch(change.value);
      // Une sortie vers le banc, dans la même commande, ne déplace pas le jet.
      if (next) square = next;
    }
  }
  if (known) return square;
  return squareOnPitch(squareFromGame(game, playerId));
}

function squareFromGame(game: GameJson, playerId: string): unknown {
  return game.fieldModel?.playerDataArray?.find((player) => player.playerId === playerId)?.playerCoordinate;
}

function squareOnPitch(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = value[0];
  const y = value[1];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (x < 0 || x > 25 || y < 0 || y > 14) return null;
  return [x, y];
}

function changesOf(command: ReplayCommand | undefined): { id: string; key: string; value: unknown }[] {
  const list = command?.modelChangeList;
  if (!list || typeof list !== 'object') return [];
  const changes = (list as { modelChangeArray?: unknown }).modelChangeArray;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!change || typeof change !== 'object') return [];
    const id = (change as { modelChangeId?: unknown }).modelChangeId;
    const key = (change as { modelChangeKey?: unknown }).modelChangeKey;
    if (typeof id !== 'string' || typeof key !== 'string' || !key) return [];
    return [{ id, key, value: (change as { modelChangeValue?: unknown }).modelChangeValue }];
  });
}
