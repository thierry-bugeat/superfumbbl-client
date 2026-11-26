import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { settings } from '../../game/settings';

const SOUND_URLS = import.meta.glob('../../assets/sounds/blitz-*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const thunderSrc = SOUND_URLS['../../assets/sounds/blitz-thunder.ogg'];
const crackleSrc = SOUND_URLS['../../assets/sounds/blitz-crackle.ogg'];

/** Même durée que la fermeture de l'éclair (BlitzAura, FADE_MS). */
const FADE_MS = 160;
/** Le fichier de tonnerre est très fort : on le joue bien en dessous du volume général. */
const THUNDER_LEVEL = 0.4;
const CRACKLE_LEVEL = 0.55;

let heardId = '';
let thunder: HTMLAudioElement | null = null;
let crackle: HTMLAudioElement | null = null;
let fadeTimer = 0;

/**
 * Tonnerre au départ du blitz, le même coup proche que l'orage.
 * Les crépitements tournent tant que l'éclair est là, puis s'éteignent avec lui.
 * Un saut reste silencieux.
 */
export function playBlitzSound(game: GameJson | null, jumped: boolean): void {
  const id = blitzPlayerId(game);
  if (jumped || !game) {
    heardId = id;
    stopThunder();
    stopCrackle(true);
    return;
  }
  if (id && id !== heardId) {
    startThunder();
    startCrackle();
  } else if (!id && heardId) {
    stopCrackle(false);
  }
  heardId = id;
}

function blitzPlayerId(game: GameJson | null): string {
  const acting = game?.actingPlayer;
  if (!acting) return '';
  const action = String(acting.playerAction ?? '').toLowerCase();
  if (!action.includes('blitz')) return '';
  const id = acting.playerId;
  if (id == null || id === '') return '';
  return String(id);
}

function userVolume(): number {
  return Math.max(0, Math.min(100, settings.soundVolume)) / 100;
}

function startThunder(): void {
  const volume = userVolume();
  if (!thunderSrc || volume === 0 || typeof Audio === 'undefined') return;
  if (!thunder) thunder = new Audio(thunderSrc);
  thunder.volume = volume * THUNDER_LEVEL;
  thunder.currentTime = 0;
  void thunder.play().catch(() => {});
}

function stopThunder(): void {
  if (!thunder) return;
  thunder.pause();
  thunder.currentTime = 0;
}

function startCrackle(): void {
  const volume = userVolume();
  if (!crackleSrc || volume === 0 || typeof Audio === 'undefined') return;
  window.clearInterval(fadeTimer);
  fadeTimer = 0;
  if (!crackle) {
    crackle = new Audio(crackleSrc);
    crackle.loop = true;
  }
  crackle.volume = volume * CRACKLE_LEVEL;
  if (crackle.paused) {
    crackle.currentTime = 0;
    void crackle.play().catch(() => {});
  }
}

function stopCrackle(immediate: boolean): void {
  window.clearInterval(fadeTimer);
  fadeTimer = 0;
  if (!crackle || crackle.paused) return;
  if (immediate) {
    crackle.pause();
    crackle.currentTime = 0;
    return;
  }
  const from = crackle.volume;
  const steps = 8;
  let step = 0;
  fadeTimer = window.setInterval(() => {
    step += 1;
    if (!crackle || step >= steps) {
      crackle?.pause();
      if (crackle) crackle.currentTime = 0;
      window.clearInterval(fadeTimer);
      fadeTimer = 0;
      return;
    }
    crackle.volume = from * (1 - step / steps);
  }, FADE_MS / steps);
}
