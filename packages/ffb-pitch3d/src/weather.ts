/**
 * Les cinq clés de la vue 2D (`pitchWeatherKey` dans ffb-pitch). Recopiées ici pour ne pas
 * importer ce package.
 */
export type WeatherKey = 'nice' | 'sunny' | 'heat' | 'rain' | 'blizzard';

export function pitchWeatherKey(weather: string | undefined | null): WeatherKey {
  const w = (weather ?? '').toLowerCase();
  if (w.includes('blizzard')) return 'blizzard';
  if (w.includes('sweltering') || w.includes('heat')) return 'heat';
  if (w.includes('sunny')) return 'sunny';
  if (w.includes('rain') || w.includes('pour')) return 'rain';
  return 'nice';
}

export interface WeatherMood {
  fog: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiIntensity: number;
  skyTint: number;
  exposure: number;
}

export const WEATHER: Record<WeatherKey, WeatherMood> = {
  nice: { fog: 0x8fafc8, fogDensity: 0.01, sunColor: 0xfff8f0, sunIntensity: 1.35, hemiSky: 0xb6ddff, hemiIntensity: 0.55, skyTint: 0xffffff, exposure: 1 },
  sunny: { fog: 0xb7d4ee, fogDensity: 0.008, sunColor: 0xfff4df, sunIntensity: 2.15, hemiSky: 0xcfe6ff, hemiIntensity: 0.95, skyTint: 0xfff6e8, exposure: 1.25 },
  heat: { fog: 0xc4a574, fogDensity: 0.014, sunColor: 0xffc080, sunIntensity: 2.2, hemiSky: 0xf0c090, hemiIntensity: 0.8, skyTint: 0xffd2a8, exposure: 1.2 },
  rain: { fog: 0x6a7580, fogDensity: 0.028, sunColor: 0xc5ccd4, sunIntensity: 0.65, hemiSky: 0x8ea0b0, hemiIntensity: 0.55, skyTint: 0xb7c0c8, exposure: 0.95 },
  blizzard: { fog: 0xd5dde6, fogDensity: 0.04, sunColor: 0xe7eef6, sunIntensity: 0.9, hemiSky: 0xd5e2ee, hemiIntensity: 0.7, skyTint: 0xe8eef4, exposure: 1.05 },
};
