import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';
import { t } from '../../i18n';

const STATE_KEYS = [
  'unknown', 'standing', 'moving', 'prone', 'stunned', 'ko', 'injured', 'seriousInjury', 'dead', 'reserves',
  'absent', 'falling', 'blocked', 'banned', 'exhausted', 'dragged', 'pickedUp',
] as const;

function playerState(value: number): string {
  const key = STATE_KEYS[value];
  return key ? t(`spectate3d.playerState.${key}`) : t('spectate3d.playerState.other', { state: value });
}

function playerName(game: GameJson, playerId: string): string {
  const players = [...(game.teamHome?.playerArray ?? []), ...(game.teamAway?.playerArray ?? [])] as PlayerJson[];
  const player = players.find((entry) => String(entry.playerId) === playerId);
  const number = player?.playerNr ?? '?';
  const name = player?.playerName || playerId;
  const side = (game.teamHome?.playerArray ?? []).some((entry) => String(entry.playerId) === playerId)
    ? t('spectate3d.state.home')
    : t('spectate3d.state.away');
  return `${number} ${name} (${side})`;
}

/** Players still on the 26 × 15 squares, plus the ball. The others are only counted. */
export function describeState(game: GameJson): string {
  const field = game.fieldModel;
  const lines: string[] = [t('spectate3d.state.weather', { weather: field?.weather || t('spectate3d.state.weatherUnknown') })];
  const ball = field?.ballCoordinate;
  lines.push(ball
    ? t('spectate3d.state.ball', { x: ball[0], y: ball[1], inPlay: field?.ballInPlay ? t('spectate3d.state.yes') : t('spectate3d.state.no') })
    : t('spectate3d.state.ballOut'));
  const onPitch: string[] = [];
  let offPitch = 0;
  for (const data of field?.playerDataArray ?? []) {
    const coordinate = data.playerCoordinate;
    if (!coordinate || coordinate[0] < 0 || coordinate[0] > 25 || coordinate[1] < 0 || coordinate[1] > 14) {
      offPitch += 1;
      continue;
    }
    const state = playerState(Number(data.playerState) & 0xff);
    onPitch.push(`${playerName(game, String(data.playerId))}  ${state}  @ ${coordinate[0]},${coordinate[1]}`);
  }
  lines.push('', t('spectate3d.state.onPitch', { count: onPitch.length }), ...onPitch, '', t('spectate3d.state.offPitch', { count: offPitch }));
  return lines.join('\n');
}
