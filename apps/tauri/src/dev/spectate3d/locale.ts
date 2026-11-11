import { normalizeLocale, setLocale, t, type Locale } from '../../i18n';

const SETTINGS_KEY = 'fumbbl40k.settings';

function languageFromStorage(): unknown {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { language?: unknown };
    return parsed.language ?? null;
  } catch {
    return null;
  }
}

/** Settings → Language, from the launch URL when the shell opened this page, otherwise the saved settings. */
export function applyClientLanguage(): Locale {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const locale = normalizeLocale(fromUrl || languageFromStorage());
  setLocale(locale);
  return locale;
}

/** Static copy marked in the page. `title` sets title and aria-label; `text` replaces the text; `aria` sets aria-label. */
export function applySpectate3dCopy(): void {
  document.title = t('spectate3d.title');
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (!key) continue;
    const text = t(key);
    const mode = el.dataset.i18nMode ?? 'text';
    if (mode === 'text') el.textContent = text;
    if (mode === 'title') {
      el.title = text;
      el.setAttribute('aria-label', text);
    }
    if (mode === 'aria') el.setAttribute('aria-label', text);
  }
}
