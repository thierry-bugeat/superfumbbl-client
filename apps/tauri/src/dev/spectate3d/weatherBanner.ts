/**
 * Bandeau météo de la vue 2D (`kick-off_<météo>.png`), au jet et quand on arrive
 * sur un match dont le jet a déjà été passé.
 */

export type WeatherBannerKey = 'nice' | 'sunny' | 'heat' | 'rain' | 'blizzard' | 'changing';

export interface WeatherBanner {
  key: WeatherBannerKey;
  src: string;
  /** Dés du jet. Vide : pas de dés (météo changeante, ou résultat déjà connu). */
  roll: number[];
  titleKey: 'hud.weatherRoll' | 'hud.changingWeather';
  /** Terme anglais du serveur, pour l'accessibilité et la traduction. */
  term: string;
  dwellMs: number;
}

export interface WeatherBannerStep {
  banners: WeatherBanner[];
  announcedKey: WeatherBannerKey | null;
}

const STEM: Record<WeatherBannerKey, string> = {
  nice: 'nice',
  sunny: 'very_sunny',
  heat: 'sweltering_heat',
  rain: 'pouring_rain',
  blizzard: 'blizzard',
  changing: 'changing_weather',
};

const ROLL_DWELL_MS = 3400;
const BANNER_DWELL_MS = 2400;

interface ReportCommand {
  reportList?: unknown;
}

export function weatherBannersForStep(input: {
  index: number;
  jumped: boolean;
  command: ReportCommand | null;
  commands: readonly ReportCommand[];
  weather: string | null | undefined;
  announcedKey: WeatherBannerKey | null;
}): WeatherBannerStep {
  if (input.index <= 0) return { banners: [], announcedKey: null };
  const fromCommand = input.command ? bannersFromCommand(input.command) : [];
  if (fromCommand.length > 0) {
    const banners = followsChangingWeather(input.commands, input.index, fromCommand)
      ? fromCommand.map(asWeatherChange)
      : fromCommand;
    const result = [...banners].reverse().find((banner) => banner.key !== 'changing');
    return { banners, announcedKey: result?.key ?? input.announcedKey };
  }
  if (!input.jumped) return { banners: [], announcedKey: input.announcedKey };
  const prior = latestWeatherResult(input.commands, input.index);
  const stateKey = weatherBannerKey(input.weather);
  if (!prior || !stateKey || prior.key !== stateKey || stateKey === input.announcedKey) {
    return { banners: [], announcedKey: input.announcedKey };
  }
  return { banners: [prior], announcedKey: stateKey };
}

export function weatherBannerKey(weather: string | null | undefined): Exclude<WeatherBannerKey, 'changing'> | null {
  const w = (weather ?? '').toLowerCase();
  if (w.includes('blizzard')) return 'blizzard';
  if (w.includes('rain') || w.includes('pour')) return 'rain';
  if (w.includes('swelter') || w.includes('heat')) return 'heat';
  if (w.includes('sunny')) return 'sunny';
  if (w.includes('nice') || w.includes('perfect')) return 'nice';
  return null;
}

/** Le rapport météo qui suit le coup d'envoi Météo changeante n'a pas de second jet. */
function followsChangingWeather(
  commands: readonly ReportCommand[],
  index: number,
  banners: readonly WeatherBanner[],
): boolean {
  if (banners.some((banner) => banner.key === 'changing') || index < 2) return false;
  const previous = commands[index - 2];
  return !!previous && bannersFromCommand(previous).some((banner) => banner.key === 'changing');
}

function asWeatherChange(banner: WeatherBanner): WeatherBanner {
  if (banner.key === 'changing') return banner;
  return { ...banner, roll: [], titleKey: 'hud.changingWeather', dwellMs: BANNER_DWELL_MS };
}

function latestWeatherResult(commands: readonly ReportCommand[], index: number): WeatherBanner | null {
  for (let i = Math.min(index, commands.length) - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if (!command) continue;
    const result = bannersFromCommand(command).find((banner) => banner.key !== 'changing');
    if (result) return result;
  }
  return null;
}

function bannersFromCommand(command: ReportCommand): WeatherBanner[] {
  const reports = reportsOf(command);
  let changingRoll: number[] | null = null;
  let result: { term: string; roll: number[] } | null = null;
  let mageRoll: number[] = [];
  for (const report of reports) {
    const id = String(report.reportId ?? '');
    if (id === 'kickoffResult' && isChangingWeather(report.kickoffResult)) {
      changingRoll = dice(report.kickoffRoll);
    } else if (id === 'weatherMageRoll') {
      mageRoll = dice(report.weatherRoll);
    } else if (id === 'weather') {
      result = { term: String(report.weather ?? ''), roll: dice(report.weatherRoll) };
    } else if (id === 'weatherMageResult') {
      const roll = mageRoll.length > 0 ? mageRoll : dice(report.weatherRoll);
      result = { term: String(report.weather ?? ''), roll };
      mageRoll = [];
    }
  }
  const banners: WeatherBanner[] = [];
  if (changingRoll) banners.push(banner('changing', 'Changing Weather', changingRoll));
  if (result) {
    const key = weatherBannerKey(result.term);
    if (key) banners.push(banner(key, result.term, changingRoll ? [] : result.roll));
  }
  return banners;
}

function banner(key: WeatherBannerKey, term: string, roll: number[]): WeatherBanner {
  return {
    key,
    src: `/super-fumbbl-assets/kickoff/kick-off_${STEM[key]}.png`,
    roll,
    titleKey: roll.length === 0 || key === 'changing' ? 'hud.changingWeather' : 'hud.weatherRoll',
    term,
    dwellMs: roll.length > 0 ? ROLL_DWELL_MS : BANNER_DWELL_MS,
  };
}

function isChangingWeather(value: unknown): boolean {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return key === 'changingweather' || key === 'weatherchange';
}

function dice(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(Number)
    .filter((face) => Number.isInteger(face) && face >= 1 && face <= 6)
    .slice(0, 2);
}

function reportsOf(command: ReportCommand): Record<string, unknown>[] {
  const list = command.reportList;
  if (!list || typeof list !== 'object') return [];
  const reports = (list as { reports?: unknown }).reports;
  if (!Array.isArray(reports)) return [];
  return reports.filter((report): report is Record<string, unknown> => !!report && typeof report === 'object');
}
