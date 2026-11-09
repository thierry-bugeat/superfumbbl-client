import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';

const BASE_STATE: Record<number, string> = {
  0: 'inconnu', 1: 'debout', 2: 'en mouvement', 3: 'à terre', 4: 'sonné',
  5: 'KO', 6: 'blessé', 7: 'blessure grave', 8: 'mort', 9: 'réserve',
  10: 'absent', 11: 'en chute', 12: 'bloqué', 13: 'exclu', 14: 'épuisé',
  15: 'traîné', 16: 'ramassé',
};

function playerName(game: GameJson, playerId: string): string {
  const players = [...(game.teamHome?.playerArray ?? []), ...(game.teamAway?.playerArray ?? [])] as PlayerJson[];
  const player = players.find((entry) => String(entry.playerId) === playerId);
  const number = player?.playerNr ?? '?';
  const name = player?.playerName || playerId;
  const side = (game.teamHome?.playerArray ?? []).some((entry) => String(entry.playerId) === playerId) ? 'domicile' : 'extérieur';
  return `${number} ${name} (${side})`;
}

/** Joueurs encore sur les 26 × 15 cases, plus le ballon. Les autres sont seulement comptés. */
export function describeState(game: GameJson): string {
  const field = game.fieldModel;
  const lines: string[] = [`météo : ${field?.weather || 'inconnue'}`];
  const ball = field?.ballCoordinate;
  lines.push(ball ? `ballon : ${ball[0]},${ball[1]}  en jeu : ${field?.ballInPlay ? 'oui' : 'non'}` : 'ballon : hors jeu');
  const onPitch: string[] = [];
  let offPitch = 0;
  for (const data of field?.playerDataArray ?? []) {
    const coordinate = data.playerCoordinate;
    if (!coordinate || coordinate[0] < 0 || coordinate[0] > 25 || coordinate[1] < 0 || coordinate[1] > 14) {
      offPitch += 1;
      continue;
    }
    const state = BASE_STATE[Number(data.playerState) & 0xff] ?? `état ${Number(data.playerState) & 0xff}`;
    onPitch.push(`${playerName(game, String(data.playerId))}  ${state}  @ ${coordinate[0]},${coordinate[1]}`);
  }
  lines.push('', `sur le terrain (${onPitch.length}) :`, ...onPitch, '', `hors terrain : ${offPitch}`);
  return lines.join('\n');
}
