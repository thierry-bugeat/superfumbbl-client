import {
  decodePlayerSkills,
  normalizeSkillName,
  playerSkillDisplayEntries,
  type GameJson,
  type PlayerJson,
  type TeamJson,
} from '@fumbbl40k/ffb-protocol';
import { portraitCrop, walkPortrait } from '@fumbbl40k/ffb-pitch3d';

type Side = 'home' | 'away';

const ASSETS: Record<Side, { front: string; back: string }> = {
  home: {
    front: new URL('./cards/player-card-home.svg', import.meta.url).href,
    back: new URL('./cards/player-card-home-back.svg', import.meta.url).href,
  },
  away: {
    front: new URL('./cards/player-card-away.svg', import.meta.url).href,
    back: new URL('./cards/player-card-away-back.svg', import.meta.url).href,
  },
};

const FRAME = { x: 41, y: 151, width: 300, height: 328 };

/** Deux cartes, sous les relances de chaque coach. Le dos s'affiche tant qu'aucun joueur n'est survolé. */
export function mountPlayerCards(): {
  setVisible(next: boolean): void;
  isVisible(): boolean;
  hover(playerId: string, game: GameJson): void;
  refresh(game: GameJson): void;
} {
  const homeHost = document.querySelector<HTMLElement>('#coach-home');
  const awayHost = document.querySelector<HTMLElement>('#coach-away');
  if (!homeHost || !awayHost) {
    return { setVisible() {}, isVisible: () => false, hover() {}, refresh() {} };
  }
  const home = createCard(homeHost, 'home');
  const away = createCard(awayHost, 'away');
  let visible = false;
  return {
    setVisible(next: boolean) {
      visible = next;
      home.setVisible(next);
      away.setVisible(next);
    },
    isVisible: () => visible,
    hover(playerId: string, game: GameJson) {
      const side = sideOf(game, playerId);
      if (side === 'home') home.show(playerId, game);
      if (side === 'away') away.show(playerId, game);
    },
    refresh(game: GameJson) {
      home.refresh(game);
      away.refresh(game);
    },
  };
}

function createCard(parent: HTMLElement, side: Side) {
  const card = document.createElement('div');
  card.className = `player-card player-card--${side}`;
  card.hidden = true;
  const figure = document.createElement('div');
  figure.className = 'player-card-figure';
  figure.hidden = true;
  figure.style.left = `${(FRAME.x / 600) * 100}%`;
  figure.style.top = `${(FRAME.y / 850) * 100}%`;
  figure.style.width = `${(FRAME.width / 600) * 100}%`;
  figure.style.height = `${(FRAME.height / 850) * 100}%`;
  const image = document.createElement('img');
  image.alt = '';
  figure.append(image);
  parent.append(card);

  let front: SVGSVGElement | null = null;
  let back: SVGSVGElement | null = null;
  let playerId: string | null = null;
  let showingFront = false;
  let visible = false;
  let request = 0;

  const ready = Promise.all([loadSvg(ASSETS[side].front), loadSvg(ASSETS[side].back)]).then(([frontSvg, backSvg]) => {
    front = frontSvg;
    back = backSvg;
    card.append(backSvg, frontSvg, figure);
    showBack();
  });

  function showBack(): void {
    request += 1;
    showingFront = false;
    if (front) front.style.display = 'none';
    if (back) back.style.display = 'block';
    figure.hidden = true;
    figure.classList.remove('player-card-figure--pixel');
    image.removeAttribute('src');
  }

  function showFront(): void {
    showingFront = true;
    if (back) back.style.display = 'none';
    if (front) front.style.display = 'block';
  }

  async function render(game: GameJson): Promise<void> {
    const current = ++request;
    await ready;
    if (current !== request || !front || !playerId) return;
    const found = findPlayer(game, playerId);
    if (!found || found.side !== side) {
      showBack();
      return;
    }
    showFront();
    const { player, team, positionName } = found;
    const position = rosterPosition(team, player);
    setText(front, side, 'nom-position', label(positionName).toUpperCase());
    setText(front, side, 'restriction-equipe', subtitle(player, team));
    setText(front, side, 'valeur-cout', formatCost(position?.cost));
    setText(front, side, 'stat-ma', formatStat(player.movement, false));
    setText(front, side, 'stat-st', formatStat(player.strength, false));
    setText(front, side, 'stat-ag', formatStat(player.agility, true));
    setText(front, side, 'stat-pa', formatStat(player.passing, true));
    setText(front, side, 'stat-ar', formatStat(player.armour, true));
    const skills = cardSkillLines(team, player);
    setSkills(front, side, skills.native, skills.added);
    const portrait = await cropPortrait(String(team.race ?? ''), positionName, side === 'home');
    if (current !== request || !showingFront) return;
    if (portrait) {
      image.src = portrait.url;
      figure.classList.toggle('player-card-figure--pixel', portrait.pixel);
      figure.hidden = false;
    } else {
      figure.hidden = true;
      figure.classList.remove('player-card-figure--pixel');
      image.removeAttribute('src');
    }
  }

  return {
    setVisible(next: boolean) {
      visible = next;
      card.hidden = !next;
      if (next) showBack();
    },
    show(id: string, game: GameJson) {
      if (!visible) return;
      if (playerId === id && showingFront) return;
      playerId = id;
      void render(game);
    },
    refresh(game: GameJson) {
      if (visible && playerId && showingFront) void render(game);
    },
  };
}

function sideOf(game: GameJson, playerId: string): Side | null {
  if (game.teamHome?.playerArray?.some((player) => player.playerId === playerId)) return 'home';
  if (game.teamAway?.playerArray?.some((player) => player.playerId === playerId)) return 'away';
  return null;
}

function findPlayer(game: GameJson, playerId: string): { player: PlayerJson; team: TeamJson; positionName: string; side: Side } | null {
  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? game.teamHome : game.teamAway;
    const player = team?.playerArray?.find((entry) => entry.playerId === playerId);
    if (player && team) {
      const position = rosterPosition(team, player);
      return { player, team, positionName: position?.positionName || player.positionId || player.playerName, side };
    }
  }
  return null;
}

function rosterPosition(team: TeamJson, player: PlayerJson): { positionName?: string; cost?: number } | null {
  const positions = (team.roster as { positionArray?: { positionId?: string; positionName?: string; cost?: number }[] }).positionArray;
  return positions?.find((entry) => String(entry.positionId) === String(player.positionId)) ?? null;
}

function subtitle(player: PlayerJson, team: TeamJson): string {
  const parts = [player.playerName, player.playerNr ? `#${player.playerNr}` : '', team.teamName].filter(Boolean);
  return parts.join(' · ') || '—';
}

function formatStat(value: number | null | undefined, target: boolean): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  return target ? `${numeric}+` : String(numeric);
}

function formatCost(cost: number | undefined): string {
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  const gold = numeric < 1000 ? numeric * 1000 : numeric;
  return String(gold).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function label(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function setText(svg: SVGSVGElement, side: Side, id: string, value: string): void {
  const node = svg.querySelector(`#${side}-${id}`);
  if (node) node.textContent = value;
}

const ROLL_VALUED_SKILLS = new Set(['loner', 'bloodlust', 'hypnoticgaze', 'secretweapon']);
const MODIFIER_VALUED_SKILLS = new Set(['mightyblow', 'dirtyplayer']);

function formatSkillValue(skill: string, value: string): string {
  const numeric = value.trim();
  if (!/^\d+$/.test(numeric)) return numeric;
  const key = normalizeSkillName(skill);
  if (ROLL_VALUED_SKILLS.has(key)) return `${numeric}+`;
  if (MODIFIER_VALUED_SKILLS.has(key)) return `+${numeric}`;
  return numeric;
}

/** Natifs en blanc, ajoutés en or. Sans poste connu, tout reste natif. */
function cardSkillLines(team: TeamJson, player: PlayerJson): { native: string[]; added: string[] } {
  const positions = (team.roster as { positionArray?: { positionId?: string; skillArray?: string[] }[] }).positionArray;
  const position = positions?.find((entry) => String(entry.positionId) === String(player.positionId));
  const baseline = new Set(position?.skillArray ?? []);
  const decoded = decodePlayerSkills(player);
  const native: string[] = [];
  const added: string[] = [];
  for (const entry of playerSkillDisplayEntries(player)) {
    const value = decoded.find((skill) => skill.name === entry.name && skill.value?.trim())?.value?.trim() ?? '';
    const text = entry.label !== entry.name
      ? entry.label
      : value ? `${entry.name} (${formatSkillValue(entry.name, value)})` : entry.name;
    const line = label(text);
    if (position && !baseline.has(entry.name)) added.push(line);
    else native.push(line);
  }
  return { native, added };
}

function setSkills(svg: SVGSVGElement, side: Side, native: readonly string[], added: readonly string[]): void {
  const host = svg.querySelector(`#${side}-liste-competences`);
  const box = host?.querySelector('.player-card-skills');
  if (!box) return;
  box.textContent = '';
  if (native.length || added.length === 0) {
    const base = document.createElement('div');
    base.className = 'player-card-skills-base';
    base.textContent = native.length ? native.join(', ') : '—';
    box.append(base);
  }
  if (added.length === 0) return;
  const extra = document.createElement('div');
  extra.className = 'player-card-skills-additional';
  if (native.length === 0) {
    extra.style.marginTop = '0';
    extra.style.paddingTop = '0';
    extra.style.borderTop = 'none';
  }
  extra.textContent = added.join(', ');
  box.append(extra);
}

const portraits = new Map<string, Promise<{ url: string; pixel: boolean } | null>>();

function cropPortrait(race: string, positionName: string, home: boolean): Promise<{ url: string; pixel: boolean } | null> {
  const crop = portraitCrop(race, positionName);
  const key = crop
    ? `atlas|${crop.url}|${crop.sx}|${crop.sy}|${crop.sw}|${crop.sh}`
    : `walk|${race}|${positionName}|${home ? 1 : 0}`;
  const cached = portraits.get(key);
  if (cached) return cached;
  const pending = crop
    ? loadImage(crop.url).then((atlas) => {
      if (!atlas) return null;
      const canvas = document.createElement('canvas');
      canvas.width = crop.sw;
      canvas.height = crop.sh;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.imageSmoothingEnabled = false;
      context.drawImage(atlas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
      return { url: canvas.toDataURL('image/png'), pixel: false };
    })
    : walkPortrait(race, positionName, home).then((canvas) => (canvas ? { url: canvas.toDataURL('image/png'), pixel: true } : null));
  portraits.set(key, pending);
  return pending;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function loadSvg(url: string): Promise<SVGSVGElement> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`carte joueur introuvable (${response.status})`);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = (await response.text()).trim();
  const svg = wrapper.querySelector('svg');
  if (!svg) throw new Error('carte joueur invalide');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}
