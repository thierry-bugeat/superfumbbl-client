import { FUMBBL_REPLAY_URL } from './replayTimeline';

/**
 * Identifiants de connexion du direct, vus depuis la page 3D.
 *
 * `spectate3d.html` est une entrée Vite distincte, chargée dans une iframe : elle n'a accès ni à
 * l'objet `settings` réactif du client 2D ni au trousseau déjà déchiffré par `game/credentials.ts`.
 * On relit donc les mêmes sources durables que lui, en lecture seule : le blob localStorage, puis
 * le trousseau de l'OS (le mot de passe y est déplacé dès que l'écriture est confirmée, et il ne
 * reste alors plus rien de clair dans le blob).
 *
 * Une source absente n'est pas une erreur : l'appelant retombe sur le re-téléchargement périodique
 * du replay, qui lui est anonyme.
 */

const SETTINGS_KEY = 'fumbbl40k.settings';
/** Compte du trousseau pour FUMBBL officiel, cf. `game/credentials.ts`. */
const KEYCHAIN_FUMBBL = 'fumbbl';

export interface LiveCredentials {
  url: string;
  compression: boolean;
  coach: string;
  password: string;
}

type SettingsBlob = Record<string, unknown>;

function readSettingsBlob(): SettingsBlob {
  for (const key of [SETTINGS_KEY, `${SETTINGS_KEY}.bak`]) {
    try {
      const text = window.localStorage.getItem(key);
      if (!text) continue;
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as SettingsBlob;
    } catch {
      // Blob illisible : on essaie la sauvegarde, puis on repart sur les valeurs par défaut.
    }
  }
  return {};
}

function text(blob: SettingsBlob, key: string): string {
  const value = blob[key];
  return typeof value === 'string' ? value.trim() : '';
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriHost = Window & { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } };

/**
 * L'IPC Tauri est posée par un script d'initialisation qui, selon la plateforme, ne descend pas
 * dans les sous-frames. La page 3D est servie par la même origine que la fenêtre qui la contient :
 * quand la sienne manque, elle emprunte celle du parent plutôt que de se passer du trousseau.
 */
function tauriInvoke(): TauriInvoke | null {
  for (const host of [window as TauriHost, window.parent as TauriHost]) {
    try {
      const invoke = host?.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke === 'function') return invoke;
    } catch {
      // Frame d'une autre origine : inaccessible, on passe à la suivante.
    }
  }
  return null;
}

/** Le mot de passe durable vit dans le trousseau de l'OS. Absent hors Tauri : on renvoie ''. */
async function keychainSecret(account: string): Promise<string> {
  const invoke = tauriInvoke();
  if (!invoke) return '';
  try {
    const secret = await invoke('keychain_get', { account });
    return typeof secret === 'string' ? secret : '';
  } catch {
    return '';
  }
}

/**
 * Le direct se branche sur le même serveur que le replay affiché, c'est-à-dire FUMBBL, et sous le
 * coach reçu dans l'URL. Le mot de passe n'est donc repris que s'il appartient bien à ce compte :
 * le secret du compte Super FUMBBL n'a rien à faire sur le socket de FUMBBL.
 *
 * Le serveur n'est pas lu dans l'URL. Un paramètre permettrait à un lien de faire envoyer le coach
 * et la réponse au challenge de mot de passe vers un serveur tiers.
 */
export async function resolveLiveCredentials(search: URLSearchParams): Promise<LiveCredentials> {
  const url = FUMBBL_REPLAY_URL;
  const blob = readSettingsBlob();
  const compression = typeof blob.compression === 'boolean' ? blob.compression : true;
  const coach = search.get('coach')?.trim() ?? '';
  const stored = text(blob, 'coach');
  if (!coach || stored.toLowerCase() !== coach.toLowerCase()) return { url, compression, coach: '', password: '' };
  // Le blob ne garde le mot de passe en clair que tant que le trousseau n'a pas confirmé sa copie.
  const password = text(blob, 'password') || (await keychainSecret(KEYCHAIN_FUMBBL));
  // Sans mot de passe, FUMBBL refuserait la place de spectateur : autant ne pas ouvrir de socket.
  return password ? { url, compression, coach, password } : { url, compression, coach: '', password: '' };
}
