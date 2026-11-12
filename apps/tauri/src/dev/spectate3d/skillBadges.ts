import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import { normalizeSkillName, playerSkillDisplayNames } from '@fumbbl40k/ffb-protocol';

/** Même correspondance que les badges 2D : le fichier n'a pas toujours le nom du skill. */
const ICON_ALIASES: Record<string, string> = {
  foulappearance: 'foulappearence',
  ballandchain: 'ballchain',
  claws: 'claw',
  swarming: 'swarmming',
};

const badgeFiles = import.meta.glob<string>(
  '../../../../../packages/ffb-pitch/assets/skill-badges/*.png',
  { eager: true, query: '?url', import: 'default' },
);

const badgeUrlByKey = new Map<string, string>();
for (const [path, url] of Object.entries(badgeFiles)) {
  const file = path.slice(path.lastIndexOf('/') + 1, -'.png'.length);
  badgeUrlByKey.set(file, url);
}

const STAT_ICON: Record<string, string> = {
  statuppa: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/pa.png', import.meta.url).href,
  statupst: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/st.png', import.meta.url).href,
  statupag: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/ag.png', import.meta.url).href,
  statupav: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/av.png', import.meta.url).href,
  statupma: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/mv.png', import.meta.url).href,
  statupmv: new URL('../../../../../packages/ffb-pitch/assets/status/stat-up/mv.png', import.meta.url).href,
  statdownpa: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/pa.png', import.meta.url).href,
  statdownst: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/st.png', import.meta.url).href,
  statdownag: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/ag.png', import.meta.url).href,
  statdownma: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/mv.png', import.meta.url).href,
  statdownav: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/av.png', import.meta.url).href,
  statdownmv: new URL('../../../../../packages/ffb-pitch/assets/status/stat-down/mv.png', import.meta.url).href,
};

export type SkillBadgeMode = 'none' | 'both' | 'added';

export const SKILL_BADGE_MODES: readonly SkillBadgeMode[] = ['none', 'both', 'added'];

function iconKey(skill: string): string {
  const characteristic = /^([+-])(AG|MA|MV|AV|ST|PA)$/i.exec(skill.trim());
  if (characteristic) return `stat${characteristic[1] === '+' ? 'up' : 'down'}${characteristic[2]!.toLowerCase()}`;
  const normalized = skill.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ICON_ALIASES[normalized] ?? normalized;
}

function iconUrl(skill: string): string | undefined {
  const key = iconKey(skill);
  return STAT_ICON[key] ?? badgeUrlByKey.get(key);
}

function positionSkills(team: TeamJson, positionId: string): string[] {
  const positions = (team.roster as { positionArray?: { positionId?: string; skillArray?: string[] }[] }).positionArray ?? [];
  return positions.find((position) => position.positionId === positionId)?.skillArray ?? [];
}

/** Skills du joueur qui ne sont pas dans la liste du poste. Une entrée du poste absorbe une entrée du joueur. */
export function addedSkillNames(player: PlayerJson, baseline: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const skill of baseline) {
    const key = normalizeSkillName(skill);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return playerSkillDisplayNames(player).filter((skill) => {
    const key = normalizeSkillName(skill);
    const count = left.get(key) ?? 0;
    if (count > 0) {
      left.set(key, count - 1);
      return false;
    }
    return true;
  });
}

/** Jusqu'à huit icônes, comme la rangée 2D. Les skills sans image sont omis. */
export function skillBadgeUrls(game: GameJson, mode: Exclude<SkillBadgeMode, 'none'>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const team of [game.teamHome, game.teamAway]) {
    if (!team) continue;
    for (const player of team.playerArray ?? []) {
      const names = mode === 'both'
        ? playerSkillDisplayNames(player)
        : addedSkillNames(player, positionSkills(team, player.positionId));
      const urls: string[] = [];
      for (const skill of names) {
        const url = iconUrl(skill);
        if (url && urls.length < 8) urls.push(url);
      }
      out.set(String(player.playerId), urls);
    }
  }
  return out;
}
