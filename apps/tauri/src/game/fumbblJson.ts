import { t } from '../i18n';

/** FUMBBL API response is not a valid JSON. Example a maintenance page. */
export class FumbblInvalidJsonError extends Error {
  constructor() {
    super('FUMBBL did not return JSON. The site may be under maintenance.');
    this.name = 'FumbblInvalidJsonError';
  }
}

/** FUMBBL API response JSON body. A maintenance page becomes "FumbblInvalidJsonError". */
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

/** Error message to display: Translated phrase for an invalid JSON. Original message otherwise. */
export function fumbblErrorDetail(error: unknown): string {
  if (error instanceof FumbblInvalidJsonError) return t('site.text.fumbblNotJson');
  return error instanceof Error ? error.message : String(error);
}
