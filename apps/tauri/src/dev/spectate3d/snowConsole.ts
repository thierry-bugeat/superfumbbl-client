import { currentLocale, t } from '../../i18n';
import {
  clampSnowSettings,
  DEFAULT_SNOW_SETTINGS,
  SNOW_RANGE,
  type Pitch3D,
  type SnowSettings,
} from '@fumbbl40k/ffb-pitch3d';

const STORAGE_KEY = 'fumbbl40k.spectate3d.snow';

/** Onglet Neige : flocons, vent, taille, temps de fonte, et le forçage. Mémorisé sur cet appareil. */
export function mountSnowConsole(pitch: Pitch3D): void {
  const settings = readSnowSettings();
  pitch.setSnowSettings(settings);

  const flakes = document.querySelector<HTMLInputElement>('#snow-flakes');
  const wind = document.querySelector<HTMLInputElement>('#snow-wind');
  const size = document.querySelector<HTMLInputElement>('#snow-size');
  const melt = document.querySelector<HTMLInputElement>('#snow-melt');
  const force = document.querySelector<HTMLInputElement>('#snow-force');
  const flakesVal = document.querySelector<HTMLElement>('#snow-flakes-val');
  const windVal = document.querySelector<HTMLElement>('#snow-wind-val');
  const sizeVal = document.querySelector<HTMLElement>('#snow-size-val');
  const meltVal = document.querySelector<HTMLElement>('#snow-melt-val');
  const cover = document.querySelector<HTMLElement>('#snow-cover');
  if (!flakes || !wind || !size || !melt || !force || !flakesVal || !windVal || !sizeVal || !meltVal) return;

  flakes.min = String(SNOW_RANGE.flakes.min);
  flakes.max = String(SNOW_RANGE.flakes.max);
  flakes.step = String(SNOW_RANGE.flakes.step);
  wind.min = String(SNOW_RANGE.wind.min);
  wind.max = String(SNOW_RANGE.wind.max);
  wind.step = String(SNOW_RANGE.wind.step);
  size.min = String(SNOW_RANGE.size.min);
  size.max = String(SNOW_RANGE.size.max);
  size.step = String(SNOW_RANGE.size.step);
  melt.min = String(SNOW_RANGE.melt.min);
  melt.max = String(SNOW_RANGE.melt.max);
  melt.step = String(SNOW_RANGE.melt.step);

  const paint = (next: SnowSettings): void => {
    flakes.value = String(next.flakes);
    wind.value = String(next.wind);
    size.value = String(next.size);
    melt.value = String(next.melt);
    force.checked = next.force;
    flakesVal.textContent = t('spectate3d.console.snow.flakesValue', { n: formatInt(next.flakes) });
    windVal.textContent = t('spectate3d.console.snow.windValue', { n: formatInt(Math.abs(Math.round(next.wind * 3))) });
    sizeVal.textContent = t('spectate3d.console.snow.sizeValue', { n: formatTenths(next.size) });
    meltVal.textContent = t('spectate3d.console.snow.meltValue', { n: formatInt(next.melt) });
  };

  const push = (): void => {
    const next = clampSnowSettings({
      flakes: Number(flakes.value),
      wind: Number(wind.value),
      size: Number(size.value),
      melt: Number(melt.value),
      force: force.checked,
    });
    paint(next);
    writeSnowSettings(next);
    pitch.setSnowSettings(next);
  };

  paint(settings);
  flakes.addEventListener('input', push);
  wind.addEventListener('input', push);
  size.addEventListener('input', push);
  melt.addEventListener('input', push);
  force.addEventListener('change', push);

  const paintCover = (): void => {
    if (!cover) return;
    cover.textContent = t('spectate3d.console.snow.cover', { n: formatInt(Math.round(pitch.snowCover() * 100)) });
  };
  paintCover();
  window.setInterval(paintCover, 500);
}

function readSnowSettings(): SnowSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SNOW_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SnowSettings>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SNOW_SETTINGS };
    return clampSnowSettings(parsed);
  } catch {
    return { ...DEFAULT_SNOW_SETTINGS };
  }
}

function writeSnowSettings(settings: SnowSettings): void {
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
