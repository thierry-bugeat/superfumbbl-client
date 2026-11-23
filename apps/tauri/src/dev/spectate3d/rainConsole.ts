import { currentLocale, t } from '../../i18n';
import {
  clampRainSettings,
  DEFAULT_RAIN_SETTINGS,
  RAIN_RANGE,
  type Pitch3D,
  type RainSettings,
} from '@fumbbl40k/ffb-pitch3d';

const STORAGE_KEY = 'fumbbl40k.spectate3d.rain';

/** Onglet Pluie : les curseurs de la simulation, plus le forçage, mémorisés sur cet appareil. */
export function mountRainConsole(pitch: Pitch3D): void {
  const settings = readRainSettings();
  pitch.setRainSettings(settings);

  const drops = document.querySelector<HTMLInputElement>('#rain-drops');
  const wind = document.querySelector<HTMLInputElement>('#rain-wind');
  const splash = document.querySelector<HTMLInputElement>('#rain-splash');
  const auto = document.querySelector<HTMLInputElement>('#rain-auto');
  const force = document.querySelector<HTMLInputElement>('#rain-force');
  const bolt = document.querySelector<HTMLButtonElement>('#rain-bolt');
  const dropsVal = document.querySelector<HTMLElement>('#rain-drops-val');
  const windVal = document.querySelector<HTMLElement>('#rain-wind-val');
  const splashVal = document.querySelector<HTMLElement>('#rain-splash-val');
  const impacts = document.querySelector<HTMLElement>('#rain-impacts');
  if (!drops || !wind || !splash || !auto || !force || !bolt || !dropsVal || !windVal || !splashVal) return;

  drops.min = String(RAIN_RANGE.drops.min);
  drops.max = String(RAIN_RANGE.drops.max);
  drops.step = String(RAIN_RANGE.drops.step);
  wind.min = String(RAIN_RANGE.wind.min);
  wind.max = String(RAIN_RANGE.wind.max);
  wind.step = String(RAIN_RANGE.wind.step);
  splash.min = String(RAIN_RANGE.splash.min);
  splash.max = String(RAIN_RANGE.splash.max);
  splash.step = String(RAIN_RANGE.splash.step);

  const paint = (next: RainSettings): void => {
    drops.value = String(next.drops);
    wind.value = String(next.wind);
    splash.value = String(next.splash);
    auto.checked = next.autoLightning;
    force.checked = next.force;
    dropsVal.textContent = t('spectate3d.console.rain.dropsValue', { n: formatInt(next.drops) });
    windVal.textContent = t('spectate3d.console.rain.windValue', { n: formatInt(Math.abs(Math.round(next.wind * 3))) });
    splashVal.textContent = t('spectate3d.console.rain.splashValue', { n: formatTenths(next.splash) });
  };

  const push = (): void => {
    const next = clampRainSettings({
      drops: Number(drops.value),
      wind: Number(wind.value),
      splash: Number(splash.value),
      autoLightning: auto.checked,
      force: force.checked,
    });
    paint(next);
    writeRainSettings(next);
    pitch.setRainSettings(next);
  };

  paint(settings);
  drops.addEventListener('input', push);
  wind.addEventListener('input', push);
  splash.addEventListener('input', push);
  auto.addEventListener('change', push);
  force.addEventListener('change', push);
  bolt.addEventListener('click', () => pitch.triggerRainLightning());

  const paintImpacts = (): void => {
    if (!impacts) return;
    impacts.textContent = t('spectate3d.console.rain.impacts', { n: formatInt(pitch.rainImpacts()) });
  };
  paintImpacts();
  window.setInterval(paintImpacts, 500);
}

function readRainSettings(): RainSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RAIN_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RainSettings>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_RAIN_SETTINGS };
    return clampRainSettings(parsed);
  } catch {
    return { ...DEFAULT_RAIN_SETTINGS };
  }
}

function writeRainSettings(settings: RainSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* navigation privée ou quota */
  }
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString(currentLocale.value);
}

function formatTenths(value: number): string {
  return value.toLocaleString(currentLocale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
