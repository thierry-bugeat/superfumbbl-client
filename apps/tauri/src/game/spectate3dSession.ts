import { ref } from 'vue';

/** The 3D page posts this to its parent when Return to Menu is confirmed. */
export const SPECTATE3D_RETURN_MESSAGE = 'superfumbbl:spectate3d-return-to-menu';

/** Full-screen 3D replay kept over the shell, so leaving it does not relaunch the client. */
export const spectate3dUrl = ref<string | null>(null);

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

export function closeSpectate3d(): void {
  spectate3dUrl.value = null;
}
