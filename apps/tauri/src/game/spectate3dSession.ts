import { ref } from 'vue';

/** The 3D page posts this to its parent when Return to Menu is confirmed. */
export const SPECTATE3D_RETURN_MESSAGE = 'superfumbbl:spectate3d-return-to-menu';

/** The 3D page posts this so the shell toggles its own (native) fullscreen. */
export const SPECTATE3D_TOGGLE_FULLSCREEN_MESSAGE = 'superfumbbl:spectate3d-toggle-fullscreen';

/** The 3D page asks for the shell fullscreen state once it can receive it. */
export const SPECTATE3D_FULLSCREEN_QUERY_MESSAGE = 'superfumbbl:spectate3d-fullscreen-query';

/** Parent → iframe: keep the 3D fullscreen button in sync with the shell. */
export const SPECTATE3D_FULLSCREEN_STATE_MESSAGE = 'superfumbbl:spectate3d-fullscreen-state';

export type Spectate3dFullscreenStateMessage = {
  type: typeof SPECTATE3D_FULLSCREEN_STATE_MESSAGE;
  active: boolean;
};

export function isSpectate3dFullscreenStateMessage(
  data: unknown,
): data is Spectate3dFullscreenStateMessage {
  if (!data || typeof data !== 'object') return false;
  const message = data as Spectate3dFullscreenStateMessage;
  return message.type === SPECTATE3D_FULLSCREEN_STATE_MESSAGE && typeof message.active === 'boolean';
}

/** Full-screen 3D replay kept over the shell, so leaving it does not relaunch the client. */
export const spectate3dUrl = ref<string | null>(null);

/** Replay JNLP handed to the 3D page. Same origin as the iframe, removed as soon as that page reads it. */
const PENDING_JNLP_KEY = 'superfumbbl.spectate3d.pendingJnlp';

export function openSpectate3d(
  gameId: number,
  coach: string,
  language?: string,
  blockDiceSurface?: string,
  blockDiceFamily?: string,
  spectate = false,
): void {
  const params = new URLSearchParams({ gameId: String(gameId), coach: coach.trim() });
  if (language) params.set('lang', language);
  if (blockDiceSurface) params.set('blockSurface', blockDiceSurface);
  if (blockDiceFamily) params.set('blockFamily', blockDiceFamily);
  if (spectate) params.set('spectate', '1');
  spectate3dUrl.value = `/spectate3d.html?${params}`;
}

/** Open a replay JNLP in the 3D player. The file text stays out of the URL: it can carry an auth token. */
export function openSpectate3dJnlp(
  xml: string,
  language?: string,
  blockDiceSurface?: string,
  blockDiceFamily?: string,
): void {
  const params = new URLSearchParams({ jnlp: '1', opened: String(Date.now()) });
  if (language) params.set('lang', language);
  if (blockDiceSurface) params.set('blockSurface', blockDiceSurface);
  if (blockDiceFamily) params.set('blockFamily', blockDiceFamily);
  sessionStorage.setItem(PENDING_JNLP_KEY, xml);
  spectate3dUrl.value = `/spectate3d.html?${params}`;
}

/** Read and forget the JNLP stashed by {@link openSpectate3dJnlp}. */
export function takePendingSpectate3dJnlp(): string | null {
  try {
    const text = sessionStorage.getItem(PENDING_JNLP_KEY);
    if (text != null) sessionStorage.removeItem(PENDING_JNLP_KEY);
    return text?.trim() ? text : null;
  } catch {
    return null;
  }
}

export function closeSpectate3d(): void {
  spectate3dUrl.value = null;
}
