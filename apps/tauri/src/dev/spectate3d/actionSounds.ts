import soundEventIds from '../../game/soundEventIds.json';
import type { ReplayCommand } from '../../game/replay/replayController';
import { playSound, setSoundWeather } from '../../game/sounds';
import { throwCue } from './throws';

const KNOWN_SOUNDS = new Set<string>(soundEventIds);

/** Indices du catalogue qui ne viennent jamais du fil : ce sont des sons d'interface. */
const INTERFACE_SOUNDS = new Set([
  'plannerWaypoint',
  'actionCancel',
  'turnClockMinute',
  'turnClockCountdown',
  'chatToast',
  'setupPlace',
  'rollFailed',
]);

let blunderTimer = 0;

/** Un saut dans le replay ne doit pas laisser partir le second temps d'un Trickster. */
export function silencePendingActionSounds(): void {
  window.clearTimeout(blunderTimer);
  blunderTimer = 0;
}

/**
 * Sons d'action du client 2D. Le fil porte l'identifiant (`block`, `ko`, `catch`…).
 * Quelques-uns sont ajoutés par le client, jamais par le serveur : le lancer, le
 * coup d'envoi, l'explosion, le touchdown. Un saut n'en joue aucun.
 */
export function playActionSounds(command: ReplayCommand | null, weather: string | null | undefined, jumped: boolean): void {
  setSoundWeather(weather);
  silencePendingActionSounds();
  if (jumped || !command) return;
  const played = new Set<string>();
  const wire = typeof command.sound === 'string' ? command.sound : '';
  if (wire && KNOWN_SOUNDS.has(wire) && !INTERFACE_SOUNDS.has(wire)) hear(wire, played);
  for (const id of clientSounds(command)) hear(id, played);
}

/** Le même sting que la bannière de turnover du client 2D. */
export function playTurnoverSound(): void {
  playSound('sad_trombone');
}

function hear(id: string, played: Set<string>): void {
  if (played.has(id) || !KNOWN_SOUNDS.has(id)) return;
  played.add(id);
  playSound(id);
}

function clientSounds(command: ReplayCommand): string[] {
  const sounds: string[] = [];
  const cue = throwCue(command);
  if (cue?.kind === 'mate') sounds.push('woooaaah');
  else if (cue) sounds.push('throw');

  const animation = command.animation as { animationType?: unknown } | null | undefined;
  const type = String(animation?.animationType ?? '');
  if (type === 'bombExplosion') sounds.push('explode');
  if (type === 'spellFireball') sounds.push('fireball');
  if (type === 'spellZap' || type === 'spellLightning') sounds.push('zap');
  if (type === 'thenIStartedBlastin') sounds.push('blunder');
  if (type === 'kick') sounds.push('kick');
  if (type === 'trickster') {
    sounds.push('hypno');
    blunderTimer = window.setTimeout(() => playSound('blunder'), 600);
  }

  for (const report of reportsOf(command)) {
    const id = String(report.reportId ?? '');
    if (id === 'turnEnd' && typeof report.playerIdTouchdown === 'string' && report.playerIdTouchdown) sounds.push('touchdown');
    if (id === 'leapRoll') sounds.push('boing');
    if (id === 'steadyFootingRoll' && report.successful === true) sounds.push('angel');
  }
  return sounds;
}

function reportsOf(command: ReplayCommand): Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
