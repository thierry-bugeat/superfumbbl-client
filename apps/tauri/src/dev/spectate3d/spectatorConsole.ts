import {
  SPECTATOR_EMOTES,
  SPECTATOR_STATES,
  type Pitch3D,
  type SpectatorState,
} from '@fumbbl40k/ffb-pitch3d';
import { t } from '../../i18n';

const STORAGE_KEY = 'fumbbl40k.spectate3d.spectator';

/** Onglet Spectator : pose et gestes du coach local, mémorisés sur cet appareil. */
export function mountSpectatorConsole(pitch: Pitch3D): void {
  const states = document.querySelector<HTMLElement>('#spectator-states');
  const emotes = document.querySelector<HTMLElement>('#spectator-emotes');
  if (!states || !emotes) return;

  const saved = readState();
  pitch.setSpectatorState(saved);

  const buttons = new Map<SpectatorState, HTMLButtonElement>();
  for (const state of SPECTATOR_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(`spectate3d.console.spectator.state.${state}`);
    button.addEventListener('click', () => {
      pitch.setSpectatorState(state);
      writeState(state);
      paint(state);
    });
    states.append(button);
    buttons.set(state, button);
  }

  const paint = (state: SpectatorState): void => {
    for (const [name, button] of buttons) button.classList.toggle('active', name === state);
  };
  paint(saved);

  for (const emote of SPECTATOR_EMOTES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(`spectate3d.console.spectator.emote.${emote}`);
    button.addEventListener('click', () => pitch.playSpectatorEmote(emote));
    emotes.append(button);
  }
}

function readState(): SpectatorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (SPECTATOR_STATES as readonly string[]).includes(raw)) return raw as SpectatorState;
  } catch {
    /* navigation privée */
  }
  return 'Idle';
}

function writeState(state: SpectatorState): void {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* navigation privée ou quota */
  }
}
