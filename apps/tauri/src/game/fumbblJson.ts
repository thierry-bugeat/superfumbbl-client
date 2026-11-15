import { t } from '../i18n';

/** L'API FUMBBL a répondu autre chose que du JSON : en pratique, la page de maintenance. */
export class FumbblInvalidJsonError extends Error {
  constructor() {
    super('FUMBBL did not return JSON. The site may be under maintenance.');
    this.name = 'FumbblInvalidJsonError';
  }
}

/** Corps JSON d'une réponse FUMBBL. Un HTML de maintenance devient `FumbblInvalidJsonError`, pas l'erreur brute du navigateur. */
export async function readFumbblJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FumbblInvalidJsonError();
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsed;
}

/** Détail à afficher : phrase traduite pour un JSON invalide, message d'origine sinon. */
export function fumbblErrorDetail(error: unknown): string {
  if (error instanceof FumbblInvalidJsonError) return t('site.text.fumbblNotJson');
  return error instanceof Error ? error.message : String(error);
}
