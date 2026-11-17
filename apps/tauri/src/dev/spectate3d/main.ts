import { d6FaceUrl, isD6FaceValue } from '@fumbbl40k/ffb-pitch/src/d6';
import { Pitch3D, type PitchDiagnostics } from '@fumbbl40k/ffb-pitch3d';
import type { GameJson, TeamJson, TurnDataJson } from '@fumbbl40k/ffb-protocol';
import { terms } from '../../i18n/terms';
import { crestDataUrl } from '../../game/teamCrests';
import {
  buildInducementChips,
  cheeringFansChip,
  CHEERING_FANS_CHIP_ICON,
  type InducementChip,
} from '../../game/logic/coachPanelChips';
import { blockDiceColor, blockRollAt } from './blockRoll';
import { numberRollAt } from './numberRoll';
import { describeState } from './describeState';
import { mountPlayerCards } from './playerCard';
import { CoachChat, type CoachChatLine } from './coachChat';
import { MatchLog } from './matchLog';
import { renderChatEmoji } from '../../game/chatEmoji';
import { t } from '../../i18n';
import { SPECTATE3D_RETURN_MESSAGE } from '../../game/spectate3dSession';
import { applyClientLanguage, applySpectate3dCopy } from './locale';
import { activationCursors, activationSkipTarget, type ReplayCommand } from '../../game/replay/replayController';
import { LiveSpectator } from './liveSpectator';
import { fetchReplay, loadReplayText, ReplayTimeline } from './replayTimeline';
import { SKILL_BADGE_MODES, skillBadgeUrls, type SkillBadgeMode } from './skillBadges';
import { ceremoniesForStep, type CeremonyCard, type CeremonySide } from './ceremony';
import { MATCHUP_DWELL_MS, matchupView, tvThousands, type MatchupSideView } from './matchup';
import { weatherBannersForStep, type WeatherBanner, type WeatherBannerKey } from './weatherBanner';
import { turnSideIsHome } from '../../game/blastinSecondBeat';
import { formatTurnRemaining, gameClockStopped, readElapsedMs, resolveTurnElapsed, turnLimitMs } from './turnClock';

applyClientLanguage();
applySpectate3dCopy();

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
const diag = document.querySelector<HTMLElement>('#diag');
const log = document.querySelector<HTMLElement>('#log');
if (!stage || !status || !diag || !log) throw new Error('page incomplète');
const stageEl: HTMLElement = stage;
const statusEl: HTMLElement = status;
const diagEl: HTMLElement = diag;
const logEl: HTMLElement = log;
const boot = document.querySelector<HTMLElement>('#boot');
const bootLabel = document.querySelector<HTMLElement>('#boot-label');

function noteLoading(text: string): void {
  if (!boot || !bootLabel || boot.hidden || boot.classList.contains('is-out')) return;
  bootLabel.textContent = text;
}

function revealStage(): void {
  if (!boot || boot.hidden || boot.classList.contains('is-out')) return;
  const overlay = boot;
  const finish = (): void => { overlay.hidden = true; };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }
  overlay.classList.add('is-out');
  overlay.addEventListener('transitionend', (event) => {
    if (event.target === overlay) finish();
  }, { once: true });
  window.setTimeout(finish, 450);
}

const pitch = new Pitch3D();
mountConsole();
const playerPanel = document.querySelector<HTMLElement>('#player');
if (playerPanel) mountFloating(playerPanel, document.querySelector<HTMLButtonElement>('#player-collapse'), t('spectate3d.player.name'));
try {
  await pitch.init(stageEl);
} catch (error) {
  statusEl.textContent = error instanceof Error ? error.message : String(error);
  revealStage();
  throw error;
}

const FULLSCREEN_ENTER_ICON = new URL('./fullscreen-enter.svg', import.meta.url).href;
const FULLSCREEN_EXIT_ICON = new URL('./fullscreen-exit.svg', import.meta.url).href;

function mountFullscreen(): void {
  const button = document.querySelector<HTMLButtonElement>('#fullscreen');
  const icon = document.querySelector<HTMLImageElement>('#fullscreen-icon');
  const label = button?.querySelector('span');
  if (!button || !icon || !label) return;

  const sync = (): void => {
    const active = document.fullscreenElement !== null;
    const text = active ? t('spectate3d.fullscreen.leave') : t('spectate3d.fullscreen.enter');
    icon.src = active ? FULLSCREEN_EXIT_ICON : FULLSCREEN_ENTER_ICON;
    label.textContent = text;
    button.title = text;
    button.setAttribute('aria-label', text);
  };

  button.addEventListener('click', () => {
    const toggle = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    toggle.then(sync).catch(() => {});
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}

function mountFloating(panel: HTMLElement, collapse: HTMLButtonElement | null, name: string): void {
  const handle = panel.querySelector<HTMLElement>('.float-titlebar');
  if (!handle) return;

  const paintCollapse = (collapsed: boolean): void => {
    if (!collapse) return;
    const label = t(collapsed ? 'spectate3d.unfold' : 'spectate3d.fold', { name });
    collapse.textContent = collapsed ? '+' : '−';
    collapse.title = label;
    collapse.setAttribute('aria-label', label);
  };
  paintCollapse(panel.classList.contains('collapsed'));
  collapse?.addEventListener('click', (event) => {
    event.stopPropagation();
    paintCollapse(panel.classList.toggle('collapsed'));
  });

  let pointerId: number | null = null;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (collapse?.contains(event.target as Node)) return;
    const rect = panel.getBoundingClientRect();
    pointerId = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.min(Math.max(event.clientX - offsetX, 0), Math.max(0, window.innerWidth - rect.width));
    const top = Math.min(Math.max(event.clientY - offsetY, 0), Math.max(0, window.innerHeight - rect.height));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  const stopDrag = (): void => {
    if (pointerId === null) return;
    pointerId = null;
    panel.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

function mountConsole(): void {
  const panel = document.querySelector<HTMLElement>('#console');
  const toggle = document.querySelector<HTMLButtonElement>('#console-toggle');
  if (!panel) return;
  mountFloating(panel, document.querySelector<HTMLButtonElement>('#console-collapse'), t('spectate3d.console.name'));

  toggle?.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    const open = !panel.hidden;
    toggle.classList.toggle('hud-btn--active', open);
    toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
  });

  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('.console-tabs [role="tab"]'));
  for (const tab of tabs) {
    tab.addEventListener('click', () => showConsoleTab(tab));
  }
  renderCoachChat([]);
}

function showConsoleTab(tab: HTMLButtonElement): void {
  const panel = document.querySelector<HTMLElement>('#console');
  if (!panel) return;
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('.console-tabs [role="tab"]'));
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute('aria-selected', selected ? 'true' : 'false');
    const pane = panel.querySelector<HTMLElement>(`#${other.getAttribute('aria-controls')}`);
    if (pane) pane.hidden = !selected;
  }
  if (tab.id === 'console-tab-chat') {
    const pane = document.querySelector<HTMLElement>('#console-chat');
    if (pane) pane.scrollTop = pane.scrollHeight;
  }
}

function renderCoachChat(lines: readonly CoachChatLine[]): void {
  const host = document.querySelector<HTMLElement>('#chat');
  const scroller = host?.parentElement ?? null;
  if (!host) return;
  const stick = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
  host.replaceChildren();
  if (lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = t('spectate3d.console.chatEmpty');
    host.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const row = document.createElement('p');
    row.className = 'chat-line';
    row.dataset.side = line.side;
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = line.coach;
    row.append(name, document.createTextNode(': '));
    for (const part of renderChatEmoji(line.text)) {
      if (part.emoji) {
        const emoji = document.createElement('span');
        emoji.className = 'chat-emoji';
        emoji.textContent = part.t;
        emoji.title = part.code;
        row.appendChild(emoji);
      } else {
        row.appendChild(document.createTextNode(part.t));
      }
    }
    host.appendChild(row);
  }
  if (stick && scroller) scroller.scrollTop = scroller.scrollHeight;
}

const logsIcon = document.querySelector<HTMLImageElement>('#logs-icon');
const resetIcon = document.querySelector<HTMLImageElement>('#reset-camera-icon');
const playerCardIcon = document.querySelector<HTMLImageElement>('#player-card-icon');
const tackleZonesIcon = document.querySelector<HTMLImageElement>('#tackle-zones-icon');
const skillsIcon = document.querySelector<HTMLImageElement>('#skills-icon');
const consoleIcon = document.querySelector<HTMLImageElement>('#console-icon');
if (logsIcon) logsIcon.src = new URL('./logs.svg', import.meta.url).href;
if (resetIcon) resetIcon.src = new URL('./reset-camera.svg', import.meta.url).href;
if (playerCardIcon) playerCardIcon.src = new URL('./cards/player-card.svg', import.meta.url).href;
if (tackleZonesIcon) tackleZonesIcon.src = new URL('./tackle-zones.svg', import.meta.url).href;
if (skillsIcon) skillsIcon.src = new URL('./skills.svg', import.meta.url).href;
if (consoleIcon) consoleIcon.src = new URL('./console.svg', import.meta.url).href;
mountFullscreen();

document.querySelector<HTMLButtonElement>('#tackle-zones')?.addEventListener('click', () => {
  const button = document.querySelector<HTMLButtonElement>('#tackle-zones');
  if (!button) return;
  const next = button.getAttribute('aria-pressed') !== 'true';
  pitch.setTackleZones(next);
  button.classList.toggle('hud-btn--active', next);
  button.setAttribute('aria-pressed', next ? 'true' : 'false');
});

let skillMode: SkillBadgeMode = 'none';

function paintSkillButton(): void {
  const button = document.querySelector<HTMLButtonElement>('#skills');
  const label = button?.querySelector('span');
  if (!button || !label) return;
  const text = t(`spectate3d.skills.${skillMode}`);
  button.dataset.mode = skillMode;
  button.title = text;
  button.setAttribute('aria-label', text);
  button.setAttribute('aria-pressed', skillMode === 'none' ? 'false' : 'true');
  button.classList.toggle('hud-btn--active', skillMode !== 'none');
  label.textContent = text;
}

function applySkillBadges(game: GameJson | null): void {
  pitch.setSkillBadges(game && skillMode !== 'none' ? skillBadgeUrls(game, skillMode) : new Map());
}

paintSkillButton();
document.querySelector<HTMLButtonElement>('#skills')?.addEventListener('click', () => {
  const index = SKILL_BADGE_MODES.indexOf(skillMode);
  skillMode = SKILL_BADGE_MODES[(index + 1) % SKILL_BADGE_MODES.length] ?? 'none';
  paintSkillButton();
  applySkillBadges(shownGame);
});

const playerCards = mountPlayerCards();
let shownGame: GameJson | null = null;
/** Dernière commande affichée. Sert à la pendule hors direct, quand elle porte `turnTime`. */
let shownCommand: ReplayCommand | null = null;
/** Millisecondes déjà passées, dernier `serverGameTime`. Le direct seul s'en sert. */
let liveElapsed: number | null = null;
document.querySelector<HTMLButtonElement>('#player-card')?.addEventListener('click', () => {
  const button = document.querySelector<HTMLButtonElement>('#player-card');
  if (!button) return;
  const next = !playerCards.isVisible();
  playerCards.setVisible(next);
  button.classList.toggle('hud-btn--active', next);
  button.setAttribute('aria-pressed', next ? 'true' : 'false');
});
stageEl.addEventListener('pointermove', (event) => {
  if (!playerCards.isVisible() || !shownGame) return;
  const playerId = pitch.pickPlayer(event.clientX, event.clientY);
  if (playerId) playerCards.hover(playerId, shownGame);
});

const matchLog = new MatchLog();
const coachChat = new CoachChat();
let loggedTimeline: ReplayTimeline | null = null;
let logExpanded = false;
let logStickToBottom = true;

document.querySelector<HTMLButtonElement>('#reset-camera')?.addEventListener('click', () => {
  pitch.resetCamera();
});

const logsButton = document.querySelector<HTMLButtonElement>('#logs');
const logBar = document.querySelector<HTMLElement>('#logbar');
logsButton?.addEventListener('click', () => {
  if (!logBar || !logsButton) return;
  const visible = logBar.hidden;
  logBar.hidden = !visible;
  logsButton.classList.toggle('hud-btn--active', visible);
  logsButton.setAttribute('aria-pressed', visible ? 'true' : 'false');
});

const logInner = document.querySelector<HTMLElement>('#logbar-inner');
const matchLogEl = document.querySelector<HTMLElement>('#match-log');
let logPointerX = 0;
let logPointerY = 0;
logInner?.addEventListener('pointerdown', (event) => {
  logPointerX = event.clientX;
  logPointerY = event.clientY;
});
logInner?.addEventListener('click', (event) => {
  if (Math.abs(event.clientX - logPointerX) > 4 || Math.abs(event.clientY - logPointerY) > 4) return;
  if (window.getSelection()?.toString()) return;
  setLogExpanded(!logExpanded);
});
logInner?.addEventListener('scroll', () => {
  if (!logExpanded || !logInner) return;
  logStickToBottom = logInner.scrollHeight - logInner.scrollTop - logInner.clientHeight < 4;
});

function setLogExpanded(next: boolean): void {
  logExpanded = next;
  logInner?.classList.toggle('logbar-inner--expanded', next);
  logInner?.setAttribute('aria-expanded', next ? 'true' : 'false');
  if (logInner) {
    logInner.title = next ? t('spectate3d.logs.collapse') : t('spectate3d.logs.expand');
  }
  renderMatchLog();
  if (next) requestAnimationFrame(() => {
    if (!logInner) return;
    logInner.scrollTop = logInner.scrollHeight;
    logStickToBottom = true;
  });
}

let shownLog: readonly string[] = [];

/** Une seule file, de gauche à droite, calée sur le bord droit. « // » sépare les rapports. */
function renderMatchLog(lines?: readonly string[]): void {
  if (lines) shownLog = lines;
  if (!matchLogEl) return;
  const fragment = document.createDocumentFragment();
  let first = true;
  for (const line of shownLog) {
    const text = line.trim();
    if (!text) continue;
    if (!first) {
      const sep = document.createElement('span');
      sep.className = 'log-sep';
      sep.textContent = '//';
      sep.setAttribute('aria-hidden', 'true');
      fragment.appendChild(sep);
    }
    first = false;
    const entry = document.createElement('span');
    entry.className = 'log-entry';
    entry.textContent = text;
    fragment.appendChild(entry);
  }
  matchLogEl.replaceChildren(fragment);
  if (!logExpanded) {
    matchLogEl.scrollLeft = matchLogEl.scrollWidth;
    return;
  }
  if (logStickToBottom && logInner) logInner.scrollTop = logInner.scrollHeight;
}

/**
 * L'animation annonce la case d'arrivée avant que le modèle n'y pose le joueur.
 * La parabole part à cette annonce et continue si l'état change en plein vol.
 */
function thrownMate(command: { animation?: unknown; [key: string]: unknown } | null): { id: string; x: number; y: number; withBall: boolean } | null {
  const animation = command?.animation as {
    animationType?: unknown;
    thrownPlayerId?: unknown;
    endCoordinate?: unknown;
    withBall?: unknown;
  } | null | undefined;
  if (!animation) return null;
  const type = String(animation.animationType ?? '');
  if (type !== 'throwTeamMate' && type !== 'kickTeamMate') return null;
  if (animation.thrownPlayerId == null || !Array.isArray(animation.endCoordinate)) return null;
  const [x, y] = animation.endCoordinate as number[];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { id: String(animation.thrownPlayerId), x, y, withBall: animation.withBall === true };
}

function lobThrownMate(command: { animation?: unknown; [key: string]: unknown } | null): void {
  const thrown = thrownMate(command);
  if (!thrown) return;
  pitch.throwMate(thrown.id, thrown.x, thrown.y, thrown.withBall);
}

let timeline: ReplayTimeline | null = null;
let index = 0;
let seekGeneration = 0;
let announcedWeather: WeatherBannerKey | null = null;
let shownIndex = -1;
let bannerRelease: (() => void) | null = null;
let matchupRelease: (() => void) | null = null;
/** Vrai pour le premier affichage d'un replay ou d'un direct : la carte domicile / extérieur précède le jeu. */
let openingMatchup = false;
let finalCeremonyShown = false;
let halfCeremonyShown = false;

function dismissWeatherBanner(): void {
  const release = bannerRelease;
  bannerRelease = null;
  release?.();
  const root = document.querySelector<HTMLElement>('#weather-banner');
  if (root) root.hidden = true;
}

function dismissMatchup(): void {
  const release = matchupRelease;
  matchupRelease = null;
  release?.();
}

function paintMatchupSide(side: 'home' | 'away', view: MatchupSideView): void {
  const column = document.querySelector<HTMLElement>(`#matchup .matchup-side--${side}`);
  column?.classList.remove('is-scoring', 'is-winner');
  const scoreEl = document.querySelector<HTMLElement>(`#matchup-${side}-score`);
  const extraEl = document.querySelector<HTMLElement>(`#matchup-${side}-extra`);
  if (scoreEl) scoreEl.textContent = '';
  if (extraEl) extraEl.replaceChildren();
  const teamEl = document.querySelector<HTMLElement>(`#matchup-${side}-team`);
  const coachEl = document.querySelector<HTMLElement>(`#matchup-${side}-coach`);
  const metaEl = document.querySelector<HTMLElement>(`#matchup-${side}-meta`);
  const crestEl = document.querySelector<HTMLImageElement>(`#matchup-${side}-crest`);
  if (teamEl) teamEl.textContent = view.teamName || t(side === 'home' ? 'hud.uiPanel.home' : 'hud.uiPanel.away');
  if (coachEl) {
    coachEl.textContent = view.coach;
    coachEl.hidden = !view.coach;
  }
  if (metaEl) {
    const race = view.race ? terms(view.race) : '';
    const thousands = tvThousands(view.tvGold);
    const tv = thousands == null ? '' : t('play.text.tvP0K', { p0: thousands.toLocaleString('en-US') });
    metaEl.textContent = [race, tv].filter(Boolean).join(' · ');
    metaEl.hidden = metaEl.textContent.length === 0;
  }
  if (!crestEl) return;
  const url = crestDataUrl(view.race, side);
  crestEl.hidden = !url;
  crestEl.alt = '';
  if (!url) return;
  crestEl.onerror = () => { crestEl.hidden = true; };
  crestEl.src = url;
}

/** Carte plein écran domicile contre extérieur. Rien si la partie a déjà commencé. */
function presentMatchup(game: GameJson, generation: number): Promise<void> {
  const view = matchupView(game);
  const root = document.querySelector<HTMLElement>('#matchup');
  if (!view || !root || generation !== seekGeneration) return Promise.resolve();
  paintMatchupSide('home', view.home);
  paintMatchupSide('away', view.away);
  root.dataset.kind = 'matchup';
  const title = document.querySelector<HTMLElement>('#matchup-title');
  if (title) title.textContent = 'VS';
  root.setAttribute('aria-label', t('spectate3d.matchup.aria', {
    home: view.home.teamName || t('hud.uiPanel.home'),
    away: view.away.teamName || t('hud.uiPanel.away'),
  }));
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      root.removeEventListener('click', finish);
      window.removeEventListener('keydown', onKey);
      if (matchupRelease === finish) matchupRelease = null;
      root.classList.remove('is-in');
      root.hidden = true;
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      finish();
    };
    matchupRelease = finish;
    if (generation !== seekGeneration) {
      finish();
      return;
    }
    root.hidden = false;
    root.classList.remove('is-in');
    void root.offsetWidth;
    root.classList.add('is-in');
    root.addEventListener('click', finish);
    window.addEventListener('keydown', onKey);
    timer = window.setTimeout(finish, MATCHUP_DWELL_MS);
  });
}

function paintCeremonySide(side: 'home' | 'away', view: CeremonySide): void {
  const column = document.querySelector<HTMLElement>(`#matchup .matchup-side--${side}`);
  column?.classList.toggle('is-scoring', view.highlight === 'scoring');
  column?.classList.toggle('is-winner', view.highlight === 'winner');
  const teamEl = document.querySelector<HTMLElement>(`#matchup-${side}-team`);
  const coachEl = document.querySelector<HTMLElement>(`#matchup-${side}-coach`);
  const metaEl = document.querySelector<HTMLElement>(`#matchup-${side}-meta`);
  const scoreEl = document.querySelector<HTMLElement>(`#matchup-${side}-score`);
  const extraEl = document.querySelector<HTMLElement>(`#matchup-${side}-extra`);
  const crestEl = document.querySelector<HTMLImageElement>(`#matchup-${side}-crest`);
  if (teamEl) teamEl.textContent = view.teamName || t(side === 'home' ? 'hud.uiPanel.home' : 'hud.uiPanel.away');
  if (coachEl) {
    coachEl.textContent = view.coach;
    coachEl.hidden = !view.coach;
  }
  if (scoreEl) scoreEl.textContent = view.score;
  if (metaEl) {
    metaEl.textContent = view.meta;
    metaEl.hidden = !view.meta;
  }
  if (extraEl) {
    extraEl.replaceChildren();
    for (const line of view.lines) {
      const row = document.createElement('p');
      row.textContent = line;
      extraEl.appendChild(row);
    }
  }
  if (!crestEl) return;
  const url = crestDataUrl(view.race, side);
  crestEl.hidden = !url;
  crestEl.alt = '';
  if (!url) return;
  crestEl.onerror = () => { crestEl.hidden = true; };
  crestEl.src = url;
}

function paintCeremonyStats(card: CeremonyCard): void {
  const verdict = document.querySelector<HTMLElement>('#matchup-verdict');
  const table = document.querySelector<HTMLTableElement>('#matchup-stats');
  const defectors = document.querySelector<HTMLElement>('#matchup-defectors');
  if (verdict) {
    verdict.textContent = card.verdict;
    verdict.hidden = !card.verdict;
  }
  if (defectors) {
    defectors.textContent = card.defectors;
    defectors.hidden = !card.defectors;
  }
  if (!table) return;
  table.replaceChildren();
  for (const stat of card.stats) {
    const row = document.createElement('tr');
    if (stat.homeLead) row.classList.add('is-home');
    if (stat.awayLead) row.classList.add('is-away');
    const home = document.createElement('td');
    const label = document.createElement('td');
    const away = document.createElement('td');
    home.textContent = stat.home;
    label.textContent = stat.label;
    away.textContent = stat.away;
    row.append(home, label, away);
    table.appendChild(row);
  }
}

/** Touchdown, mi-temps ou fin de match. Même carte que domicile contre extérieur. */
function presentCeremony(card: CeremonyCard, generation: number): Promise<void> {
  const root = document.querySelector<HTMLElement>('#matchup');
  const title = document.querySelector<HTMLElement>('#matchup-title');
  if (!root || !title || generation !== seekGeneration) return Promise.resolve();
  paintCeremonySide('home', card.home);
  paintCeremonySide('away', card.away);
  paintCeremonyStats(card);
  root.dataset.kind = card.kind;
  const heading = t(card.titleKey);
  title.textContent = heading;
  root.setAttribute('aria-label', t('spectate3d.ceremony.aria', {
    title: heading,
    home: card.home.teamName || t('hud.uiPanel.home'),
    away: card.away.teamName || t('hud.uiPanel.away'),
    homeScore: card.home.score,
    awayScore: card.away.score,
  }));
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      root.removeEventListener('click', finish);
      window.removeEventListener('keydown', onKey);
      if (matchupRelease === finish) matchupRelease = null;
      root.classList.remove('is-in');
      root.hidden = true;
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      finish();
    };
    matchupRelease = finish;
    if (generation !== seekGeneration) {
      finish();
      return;
    }
    root.hidden = false;
    root.classList.remove('is-in');
    void root.offsetWidth;
    root.classList.add('is-in');
    root.addEventListener('click', finish);
    window.addEventListener('keydown', onKey);
    timer = window.setTimeout(finish, card.dwellMs);
  });
}

/** Le jet de météo, ou la météo déjà connue quand on saute par-dessus le jet. */
async function presentWeatherBanners(banners: readonly WeatherBanner[], generation: number): Promise<void> {
  for (const banner of banners) {
    if (generation !== seekGeneration) return;
    await holdWeatherBanner(banner, generation);
  }
}

function holdWeatherBanner(banner: WeatherBanner, generation: number): Promise<void> {
  const root = document.querySelector<HTMLElement>('#weather-banner');
  const title = document.querySelector<HTMLElement>('#weather-banner-title');
  const dice = document.querySelector<HTMLElement>('#weather-banner-dice');
  const art = document.querySelector<HTMLImageElement>('#weather-banner-art');
  const caption = document.querySelector<HTMLElement>('#weather-banner-caption');
  if (!root || !title || !dice || !art || !caption || generation !== seekGeneration) return Promise.resolve();
  const label = t(banner.titleKey);
  const name = banner.term ? terms(banner.term) : '';
  title.textContent = label;
  title.hidden = false;
  caption.textContent = name;
  caption.hidden = !name || name === banner.term;
  dice.replaceChildren();
  for (const value of banner.roll) {
    if (!isD6FaceValue(value)) continue;
    const face = document.createElement('img');
    face.src = d6FaceUrl(value);
    face.alt = t('hud.weatherDieP0', { p0: value });
    dice.appendChild(face);
  }
  dice.hidden = dice.childElementCount === 0;
  art.alt = name || label;
  root.setAttribute('aria-label', name ? `${label}. ${name}` : label);
  art.src = banner.src;

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      art.removeEventListener('load', reveal);
      art.removeEventListener('error', reveal);
      root.removeEventListener('click', finish);
      window.removeEventListener('keydown', onKey);
      if (bannerRelease === finish) {
        bannerRelease = null;
        root.hidden = true;
      }
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        finish();
      }
    };
    const reveal = (): void => {
      art.removeEventListener('load', reveal);
      art.removeEventListener('error', reveal);
      if (settled || generation !== seekGeneration) {
        finish();
        return;
      }
      timer = window.setTimeout(finish, banner.dwellMs);
      root.hidden = false;
      root.classList.remove('is-in');
      void root.offsetWidth;
      root.classList.add('is-in');
      root.addEventListener('click', finish);
      window.addEventListener('keydown', onKey);
    };
    bannerRelease = finish;
    if (art.complete && art.naturalWidth > 0) reveal();
    else {
      art.addEventListener('load', reveal);
      art.addEventListener('error', reveal);
    }
  });
}

async function show(): Promise<void> {
  const generation = ++seekGeneration;
  dismissWeatherBanner();
  dismissMatchup();
  const opening = openingMatchup;
  openingMatchup = false;
  if (!timeline) {
    statusEl.textContent = t('spectate3d.status.empty');
    logEl.textContent = '';
    matchLog.reset();
    coachChat.reset();
    loggedTimeline = null;
    renderMatchLog([]);
    renderCoachChat([]);
    pitch.clearBlockDice();
    shownGame = null;
    applySkillBadges(null);
    showCoaches(null);
    shownCommand = null;
    paintTurnClock(null, null, false);
    announcedWeather = null;
    shownIndex = -1;
    finalCeremonyShown = false;
    halfCeremonyShown = false;
    paintLiveButton();
    paintActivationButtons();
    revealStage();
    return;
  }
  const current = timeline;
  const state = await current.seek(index, (done, target) => {
    if (generation !== seekGeneration) return;
    const message = t('spectate3d.status.computing', { done, target });
    statusEl.textContent = message;
    noteLoading(message);
  });
  if (generation !== seekGeneration) return;
  const command = index === 0 ? null : current.commands[index - 1] ?? null;
  const jumped = shownIndex < 0 || index !== shownIndex + 1;
  shownIndex = index;
  const weatherStep = weatherBannersForStep({
    index,
    jumped,
    command,
    commands: current.commands,
    weather: state.fieldModel?.weather,
    announcedKey: announcedWeather,
  });
  announcedWeather = weatherStep.announcedKey;
  statusEl.textContent = command
    ? t('spectate3d.status.command', { index, total: current.commands.length, id: command.netCommandId })
    : t('spectate3d.status.start', { total: current.commands.length });
  applySkillBadges(state);
  pitch.present(state);
  lobThrownMate(command);
  shownGame = state;
  playerCards.refresh(state);
  showBlockDice(current.commands, index, state);
  showNumberDice(current.commands, index, state, jumped);
  logEl.textContent = describeState(state);
  showTurns(state);
  showScore(state);
  showCoaches(state);
  shownCommand = command;
  paintTurnClock(state, command, index === 0);
  if (timeline !== loggedTimeline) {
    matchLog.reset();
    coachChat.reset();
    loggedTimeline = timeline;
  }
  renderMatchLog(matchLog.sync(current.commands, index, state));
  renderCoachChat(coachChat.sync(current.commands, index, state));
  // Le serveur a posé l'heure de fin : plus rien n'arrivera, le socket et le bouton Direct s'en vont.
  if (liveOpen && state.finished != null) {
    liveOpen = false;
    closeLiveSocket();
  }
  paintLiveButton();
  paintActivationButtons();
  if (generation !== seekGeneration) return;
  revealStage();
  if (opening) {
    await presentMatchup(state, generation);
    if (generation !== seekGeneration) return;
  }
  await presentWeatherBanners(weatherStep.banners, generation);
  if (generation !== seekGeneration || !timeline) return;
  const ceremony = ceremoniesForStep({
    game: state,
    command: command,
    commands: current.commands,
    index,
    jumped,
    finalAlreadyShown: finalCeremonyShown,
    halfAlreadyShown: halfCeremonyShown,
  });
  finalCeremonyShown = ceremony.finalShown;
  halfCeremonyShown = ceremony.halfShown;
  for (const card of ceremony.cards) {
    if (generation !== seekGeneration) return;
    await presentCeremony(card, generation);
  }
}

/** Ouverture d'un replay : au coup d'envoi. Le direct, lui, part de l'instantané du socket. */
async function openLoadedReplay(): Promise<void> {
  index = 0;
  await seekFirstLineup();
  openingMatchup = true;
  await show();
  if (!spectateMode) setPlaying(true);
}

document.querySelector<HTMLInputElement>('#file')?.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const jnlp = file.name.endsWith('.jnlp') || file.type.includes('jnlp');
  statusEl.textContent = jnlp ? t('spectate3d.status.downloading') : t('spectate3d.status.reading');
  logEl.textContent = '';
  setPlaying(false);
  try {
    timeline = await loadReplayText(await file.text());
    await openLoadedReplay();
  } catch (error) {
    timeline = null;
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    logEl.textContent = '';
  }
});

function step(next: number): void {
  if (!timeline) return;
  stopFollowingLive();
  setPlaying(false);
  index = Math.max(0, Math.min(timeline.length - 1, next));
  void show();
}

const playButton = document.querySelector<HTMLButtonElement>('#play');
/** Durée d'une commande à l'écran, en lecture comme en direct. Une figurine traverse une case plus
 *  vite que ça (`MOVE_SPEED`), donc chaque pas a le temps d'être rendu avant le suivant. */
const STEP_MS = 220;
let playing = false;
let playTimer = 0;

function setPlaying(next: boolean): void {
  if (next && timeline && index < timeline.length - 1) stopFollowingLive();
  playing = next && !!timeline && index < timeline.length - 1;
  if (playButton) {
    const label = playing ? t('spectate3d.transport.pause') : t('spectate3d.transport.play');
    playButton.title = label;
    playButton.setAttribute('aria-label', label);
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playButton.querySelector<SVGElement>('.icon-play')?.toggleAttribute('hidden', playing);
    playButton.querySelector<SVGElement>('.icon-pause')?.toggleAttribute('hidden', !playing);
  }
  window.clearTimeout(playTimer);
  if (playing) playTimer = window.setTimeout(() => { void advance(); }, STEP_MS);
}

async function advance(): Promise<void> {
  if (!playing || !timeline) return;
  if (index >= timeline.length - 1) {
    setPlaying(false);
    startFollowingLive();
    return;
  }
  index += 1;
  await show();
  if (!playing || !timeline) return;
  if (index >= timeline.length - 1) {
    setPlaying(false);
    startFollowingLive();
    return;
  }
  playTimer = window.setTimeout(() => { void advance(); }, STEP_MS);
}

playButton?.addEventListener('click', () => setPlaying(!playing));

/** Début de chaque activation réellement jouée. Recalculé quand la liste des commandes change. */
let activationSource: readonly ReplayCommand[] | null = null;
let activationLength = -1;
let activationBoundaries: readonly number[] = [];

function boundariesNow(): readonly number[] {
  const commands = timeline?.commands;
  if (!commands) return [];
  if (commands !== activationSource || commands.length !== activationLength) {
    activationSource = commands;
    activationLength = commands.length;
    activationBoundaries = activationCursors(commands);
  }
  return activationBoundaries;
}

/** Précédent : début de l'activation en cours, ou de la précédente si on y est déjà. Suivant : la prochaine. */
function stepActivation(direction: -1 | 1): void {
  const target = activationSkipTarget(boundariesNow(), index, direction);
  if (target == null) return;
  step(target);
}

function paintActivationButtons(): void {
  const boundaries = boundariesNow();
  const back = document.querySelector<HTMLButtonElement>('#prev-player');
  const forward = document.querySelector<HTMLButtonElement>('#next-player');
  if (back) back.disabled = activationSkipTarget(boundaries, index, -1) == null;
  if (forward) forward.disabled = activationSkipTarget(boundaries, index, 1) == null;
}

/** Suivant : début du prochain tour. Précédent : début du tour en cours, ou du précédent si on y est déjà. */
function stepTeamTurn(direction: -1 | 1): void {
  if (!timeline) return;
  const turns = timeline.teamTurnCursors();
  if (direction > 0) {
    step(turns.find((cursor) => cursor > index) ?? timeline.length - 1);
    return;
  }
  const prior = turns.filter((cursor) => cursor < index);
  step(prior[prior.length - 1] ?? 0);
}

const LIVE_CATCHUP_LIMIT = 24;
let liveGameId = 0;
let liveCoach = '';
let liveOpen = false;
let spectateMode = false;
let followingLive = false;
let followGeneration = 0;
/** Socket spectateur : le serveur pousse chaque commande, rien n'est jamais re-téléchargé pour suivre. */
let liveSocket: LiveSpectator | null = null;
/** Un premier instantané a déjà été présenté : une reprise ne rejoue pas la séquence d'ouverture. */
let liveRunning = false;
let catchingUp = false;

function stopFollowingLive(): void {
  followingLive = false;
  followGeneration += 1;
  paintLiveButton();
}

function startFollowingLive(): void {
  if (!liveOpen || !liveGameId || !timeline) {
    paintLiveButton();
    return;
  }
  followingLive = true;
  paintLiveButton();
  if (shownGame) paintTurnClock(shownGame, shownCommand, index === 0);
  void runCatchUp();
}

function paintLiveButton(): void {
  const button = document.querySelector<HTMLButtonElement>('#live');
  if (!button) return;
  const visible = spectateMode && liveOpen;
  button.hidden = !visible;
  if (!visible) return;
  const onAir = followingLive;
  button.setAttribute('aria-pressed', onAir ? 'true' : 'false');
  const label = t(onAir ? 'spectate3d.transport.live' : 'spectate3d.transport.backToLive');
  button.title = label;
  button.setAttribute('aria-label', label);
  const text = button.querySelector<HTMLElement>('.live-label');
  if (text) text.textContent = label;
}

/** Une seule boucle de rattrapage à la fois : les salves du socket arrivent plus vite qu'elle. */
async function runCatchUp(): Promise<void> {
  if (catchingUp) return;
  catchingUp = true;
  try {
    await catchUp(followGeneration);
  } finally {
    catchingUp = false;
  }
}

async function catchUp(generation: number): Promise<void> {
  while (timeline && generation === followGeneration && followingLive && !playing) {
    const behind = timeline.length - 1 - index;
    if (behind <= 0) return;
    if (behind > LIVE_CATCHUP_LIMIT) {
      index = timeline.length - 1;
      await show();
      return;
    }
    index += 1;
    await show();
    if (generation !== followGeneration || !followingLive || playing) return;
    // Cette attente vaut aussi quand il ne reste rien à rattraper. Le serveur pousse les cases d'un
    // déplacement en rafale : sans elle, la boucle rend la main entre deux commandes de la même
    // rafale, chacune est appliquée à la vitesse du socket, et aucune image n'est rendue entre le
    // départ et l'arrivée — la figurine traverse en ligne droite au lieu de marcher.
    await new Promise((resolve) => window.setTimeout(resolve, STEP_MS));
  }
}

/** Dernière action connue, puis suivi des commandes qui arrivent ensuite. */
async function goToLatest(): Promise<void> {
  followGeneration += 1;
  const generation = followGeneration;
  followingLive = false;
  setPlaying(false);
  // Le socket a déjà poussé tout ce qui s'est joué : il n'y a rien à aller chercher.
  if (!timeline) return;
  index = timeline.length - 1;
  await show();
  if (generation !== followGeneration) return;
  startFollowingLive();
}

function watchLiveGame(gameId: number, coach: string, live: boolean): void {
  liveGameId = gameId;
  liveCoach = coach;
  liveOpen = live;
}

/**
 * Ouvre le socket spectateur. Le match affiché vient alors entièrement de lui : l'instantané de
 * connexion sert de base, le flux écrit la suite. Sans compte FUMBBL lisible, l'appelant se
 * rabat sur le replay téléchargé, qui ne suit pas le direct.
 */
function openLiveSocket(gameId: number, search: URLSearchParams): Promise<boolean> {
  const socket = new LiveSpectator(gameId, {
    onSnapshot: (game) => { void rebaseOnLiveSnapshot(game); },
    onCommands: onLiveCommands,
    onClock: (sample) => {
      liveElapsed = sample.turnTime;
      if (followingLive && shownGame) paintTurnClock(shownGame, shownCommand, index === 0);
    },
    onDown: (permanent) => {
      if (!permanent || !liveSocket) return;
      // Le socket ne reviendra pas : on coupe le direct au lieu de laisser croire qu'il suit.
      liveOpen = false;
      followingLive = false;
      closeLiveSocket();
      paintLiveButton();
      // Mort avant le premier instantané : il n'y a rien à l'écran, le replay prend le relais.
      if (!liveRunning) void showDownloadedReplay();
    },
  });
  liveSocket = socket;
  return socket.start(search).then((started) => {
    if (!started && liveSocket === socket) {
      liveSocket = null;
      console.info('[spectate3d] aucun compte FUMBBL lisible : pas de direct, seul le replay téléchargé est affiché');
    }
    return started;
  });
}

/**
 * Repli quand il n'y a pas de direct : le match est téléchargé et montré tel quel, sans suivre la
 * suite. En mode spectateur on ouvre sur la dernière action connue, qui est ce qu'on venait voir.
 */
async function showDownloadedReplay(): Promise<void> {
  if (liveRunning || !liveGameId || !liveCoach) return;
  const downloading = t('spectate3d.status.downloading');
  statusEl.textContent = downloading;
  noteLoading(downloading);
  try {
    timeline = ReplayTimeline.fromBundle(await fetchReplay(liveGameId, liveCoach));
    if (!spectateMode) { await openLoadedReplay(); return; }
    index = timeline.length - 1;
    openingMatchup = true;
    await show();
  } catch (error) {
    timeline = null;
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    revealStage();
  }
}

/**
 * Nouvelle base : à la connexion, et à chaque reprise après une coupure. Le serveur ne rejoue pas
 * ce qui s'est passé entre-temps, donc on repart de son état courant plutôt que de bricoler un
 * raccord. Ce qui précède la connexion est perdu, et le journal repart de là.
 */
async function rebaseOnLiveSnapshot(game: GameJson): Promise<void> {
  liveElapsed = readElapsedMs(game.turnTime);
  const generation = ++followGeneration;
  timeline = ReplayTimeline.fromLiveSnapshot(game);
  liveOpen = game.finished == null;
  followingLive = liveOpen;
  index = 0;
  shownIndex = -1;
  setPlaying(false);
  openingMatchup = !liveRunning;
  liveRunning = true;
  // La base s'affiche d'abord. Ce qui arrive pendant reste dans le tampon du socket et sera
  // appliqué dessus ensuite, au lieu de courir contre cette première présentation.
  await show();
  if (generation !== followGeneration) return;
  armLiveSocket();
  startFollowingLive();
}

function onLiveCommands(commands: readonly ReplayCommand[]): void {
  if (!timeline) return;
  timeline.appendLive(commands);
  paintActivationButtons();
  if (followingLive) void runCatchUp();
}

/** La timeline bâtie sur l'instantané est prête : le socket peut livrer ce qu'il a gardé. */
function armLiveSocket(): void {
  liveSocket?.open();
}

function closeLiveSocket(): void {
  liveSocket?.stop();
  liveSocket = null;
}

window.addEventListener('pagehide', () => { stopFollowingLive(); closeLiveSocket(); });

document.querySelector('#first')?.addEventListener('click', () => step(0));
document.querySelector('#prev')?.addEventListener('click', () => stepTeamTurn(-1));
document.querySelector('#prev-player')?.addEventListener('click', () => stepActivation(-1));
document.querySelector('#next-player')?.addEventListener('click', () => stepActivation(1));
document.querySelector('#next')?.addEventListener('click', () => stepTeamTurn(1));
document.querySelector('#last')?.addEventListener('click', () => step((timeline?.length ?? 1) - 1));
document.querySelector('#live')?.addEventListener('click', () => { void goToLatest(); });
const leavePrompt = document.querySelector<HTMLElement>('#leave-prompt');
let resumeAfterLeavePrompt = false;

function openLeavePrompt(): void {
  if (!leavePrompt) return;
  resumeAfterLeavePrompt = playing;
  setPlaying(false);
  leavePrompt.hidden = false;
  document.querySelector<HTMLButtonElement>('#leave-confirm')?.focus();
}

function closeLeavePrompt(): void {
  if (!leavePrompt || leavePrompt.hidden) return;
  leavePrompt.hidden = true;
  if (resumeAfterLeavePrompt) setPlaying(true);
  resumeAfterLeavePrompt = false;
}

function confirmLeaveToMenu(): void {
  resumeAfterLeavePrompt = false;
  setPlaying(false);
  if (leavePrompt) leavePrompt.hidden = true;
  if (window.parent !== window) {
    window.parent.postMessage(SPECTATE3D_RETURN_MESSAGE, window.location.origin);
    return;
  }
  window.location.assign('/');
}

document.querySelector('#leave')?.addEventListener('click', openLeavePrompt);
document.querySelector('#leave-cancel')?.addEventListener('click', closeLeavePrompt);
document.querySelector('#leave-confirm')?.addEventListener('click', confirmLeaveToMenu);
leavePrompt?.addEventListener('click', (event) => {
  if (event.target === leavePrompt) closeLeavePrompt();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && leavePrompt && !leavePrompt.hidden) {
    event.preventDefault();
    closeLeavePrompt();
  }
});

function blockDieSetting(): { surface: unknown; family: unknown } {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('blockSurface');
  if (fromUrl) return { surface: fromUrl, family: params.get('blockFamily') };
  try {
    const raw = localStorage.getItem('fumbbl40k.settings');
    const saved = raw ? JSON.parse(raw) as { blockDiceSurface?: unknown; blockDiceFamily?: unknown } : {};
    return { surface: saved.blockDiceSurface, family: saved.blockDiceFamily };
  } catch {
    return { surface: 'auto', family: 'default' };
  }
}

function showNumberDice(commands: Parameters<typeof blockRollAt>[0], at: number, game: GameJson, jumped: boolean): void {
  const roll = numberRollAt(commands, at, game);
  if (!roll) {
    pitch.releaseNumberDice(jumped);
    return;
  }
  pitch.showNumberDice(roll);
}

function showBlockDice(commands: Parameters<typeof blockRollAt>[0], at: number, game: GameJson): void {
  const roll = blockRollAt(commands, at, game);
  if (!roll) {
    pitch.clearBlockDice();
    return;
  }
  const setting = blockDieSetting();
  pitch.showBlockDice({ ...roll, color: blockDiceColor(setting.surface, setting.family, roll.choosingTeamId, game) });
}

function playersOnPitch(game: GameJson): number {
  let count = 0;
  for (const data of game.fieldModel?.playerDataArray ?? []) {
    const coordinate = data.playerCoordinate;
    if (coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14) count += 1;
  }
  return count;
}

/** Le départ d'un replay laisse souvent tout le monde en réserve, hors des 26 × 15 cases. */
async function seekFirstLineup(): Promise<void> {
  if (!timeline) return;
  const current = timeline;
  for (let i = 0; i < current.length; i += 1) {
    const state = await current.seek(i);
    if (i % 40 === 0) {
      const message = t('spectate3d.status.seeking', { index: i, total: current.commands.length });
      statusEl.textContent = message;
      noteLoading(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (playersOnPitch(state) > 0) {
      index = i;
      return;
    }
  }
  index = 0;
}

const TURNS_PER_HALF = 8;

function showTurns(game: GameJson): void {
  const homeEdge = document.querySelector<HTMLElement>('.turn-edge--home');
  const awayEdge = document.querySelector<HTMLElement>('.turn-edge--away');
  const homeRail = document.querySelector<HTMLElement>('#home-turns');
  const awayRail = document.querySelector<HTMLElement>('#away-turns');
  if (!homeEdge || !awayEdge || !homeRail || !awayRail) return;
  homeEdge.hidden = false;
  awayEdge.hidden = false;
  const homeActive = game.homePlaying === true;
  fillTurnRail(homeRail, Number(game.turnDataHome?.turnNr) || 0, homeActive);
  fillTurnRail(awayRail, Number(game.turnDataAway?.turnNr) || 0, game.homePlaying === false);
}

/** `turnNr` compte les tours commencés dans la mi-temps. Le tour en cours brille. */
function fillTurnRail(rail: HTMLElement, started: number, active: boolean): void {
  const begun = Math.max(0, Math.min(TURNS_PER_HALF, Math.floor(started)));
  const current = active && begun > 0 && begun <= TURNS_PER_HALF ? begun - 1 : -1;
  const done = active ? Math.max(0, begun - 1) : begun;
  rail.replaceChildren();
  for (let i = 0; i < TURNS_PER_HALF; i += 1) {
    const slot = document.createElement('div');
    const used = i < done || i === current;
    slot.className = 'turn-slot' + (used ? ' turn-slot--used' : '') + (i === current ? ' turn-slot--current' : '');
    slot.textContent = String(i + 1);
    rail.appendChild(slot);
  }
}

const scorePlate = document.querySelector<HTMLImageElement>('#score-plate');
if (scorePlate) scorePlate.src = new URL('./score-plate.svg', import.meta.url).href;

function halfLabel(half: number): string {
  if (half <= 0) return t('spectate3d.half.prematch');
  if (half === 1) return t('spectate3d.half.first');
  if (half === 2) return t('spectate3d.half.second');
  return t('spectate3d.half.overtime');
}

function weatherKind(weather: string | undefined): 'sun' | 'heat' | 'rain' | 'snow' {
  const key = (weather ?? '').toLowerCase();
  if (key.includes('blizzard') || key.includes('snow')) return 'snow';
  if (key.includes('rain')) return 'rain';
  if (key.includes('heat') || key.includes('swelter')) return 'heat';
  return 'sun';
}

/** Décompte du tour, collé au coin du coach qui joue. Le direct suit `serverGameTime`. */
function paintTurnClock(game: GameJson | null, command: ReplayCommand | null, atStart: boolean): void {
  const root = document.querySelector<HTMLElement>('#turn-clock');
  const label = root?.querySelector<HTMLElement>('.turn-clock-time');
  if (!root || !label) return;
  const elapsed = game
    ? resolveTurnElapsed({
      finished: gameClockStopped(game),
      followingLive,
      liveElapsed,
      commandElapsed: readElapsedMs(command?.turnTime),
      snapshotElapsed: atStart && liveRunning ? readElapsedMs(game.turnTime) : null,
    })
    : null;
  if (elapsed === null || !game) {
    root.hidden = true;
    return;
  }
  label.textContent = formatTurnRemaining(elapsed, turnLimitMs(game));
  const home = turnSideIsHome(game);
  root.classList.toggle('turn-clock--home', home);
  root.classList.toggle('turn-clock--away', !home);
  root.hidden = false;
}

function showScore(game: GameJson): void {
  const plate = document.querySelector<HTMLElement>('.score');
  const homeNum = document.querySelector<HTMLElement>('#score-home-num');
  const awayNum = document.querySelector<HTMLElement>('#score-away-num');
  const half = document.querySelector<HTMLElement>('#score-half');
  const weather = document.querySelector<HTMLElement>('#score-weather');
  if (!plate || !homeNum || !awayNum || !half || !weather) return;
  plate.hidden = false;
  homeNum.textContent = String(Number(game.gameResult?.teamResultHome?.score) || 0);
  awayNum.textContent = String(Number(game.gameResult?.teamResultAway?.score) || 0);
  half.textContent = halfLabel(Number(game.half) || 0);
  const kind = weatherKind(game.fieldModel?.weather);
  for (const icon of Array.from(weather.querySelectorAll<SVGElement>('svg'))) {
    icon.classList.toggle('is-on', icon.dataset.kind === kind);
  }
}

const RESOURCE_ICONS = import.meta.glob('../../assets/resources/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

function resourceIcon(name: string): string {
  const match = Object.entries(RESOURCE_ICONS).find(([path]) => path.endsWith(`/${name}.png`));
  return match?.[1] ?? '';
}

function chipTitle(chip: InducementChip, turn: TurnDataJson | undefined): string {
  if (chip.icon === 're_roll' && chip.pool === 'base') return t('spectate3d.chip.rerolls');
  if (chip.icon === 'apothecary') return t('spectate3d.chip.apothecary');
  if (chip.icon === 'prayer') {
    const names = (turn?.inducementSet?.prayers ?? []).map((prayer) => String(prayer)).filter(Boolean);
    return names.length ? t('spectate3d.chip.prayersNamed', { names: names.join(', ') }) : t('spectate3d.chip.prayers');
  }
  if (chip.icon === 'card') return t('spectate3d.chip.cards');
  return chip.label;
}

function resourceRow(chips: InducementChip[], turn: TurnDataJson | undefined): HTMLElement {
  const row = document.createElement('div');
  row.className = 'coach-resource-row';
  for (const chip of chips) {
    const item = document.createElement('span');
    item.className = 'coach-resource' + (chip.icon === CHEERING_FANS_CHIP_ICON ? ' coach-resource--fans' : '');
    item.title = chipTitle(chip, turn);
    item.dataset.icon = chip.icon;
    if (chip.icon === CHEERING_FANS_CHIP_ICON) {
      item.textContent = `FANS +${chip.count}`;
    } else {
      const src = resourceIcon(chip.icon);
      if (src) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = src;
        item.append(img);
      }
      if (chip.badge) {
        const badge = document.createElement('small');
        badge.textContent = chip.badge;
        item.append(badge);
      }
      const count = document.createElement('b');
      count.textContent = String(chip.count);
      item.append(count);
    }
    row.append(item);
  }
  return row;
}

/** Relances et apothicaire sur la première ligne, les inducements encore disponibles en dessous. */
function fillResources(host: HTMLElement, turn: TurnDataJson | undefined): void {
  const chips = turn?.inducementSet ? buildInducementChips(turn) : [];
  const fans = cheeringFansChip(turn);
  if (fans) chips.push(fans);
  const rerolls = chips.filter((chip) => chip.icon === 're_roll');
  if (rerolls.length === 0) {
    rerolls.push({
      icon: 're_roll',
      count: Math.max(0, Math.floor(Number(turn?.reRolls) || 0)),
      label: t('spectate3d.chip.rerolls'),
      pool: 'base',
    });
  }
  const apo = chips.find((chip) => chip.icon === 'apothecary') ?? {
    icon: 'apothecary',
    count: Math.max(0, Math.floor(Number(turn?.apothecaries) || 0)),
    label: t('spectate3d.chip.apothecary'),
  };
  const rest = chips.filter((chip) => chip.icon !== 're_roll' && chip.icon !== 'apothecary');
  host.append(resourceRow([...rerolls, apo], turn));
  if (rest.length > 0) host.append(resourceRow(rest, turn));
}

function showCoaches(game: GameJson | null): void {
  const home = game ? turnSideIsHome(game) : false;
  fillCoach('home', game?.teamHome, game?.turnDataHome, home, game);
  fillCoach('away', game?.teamAway, game?.turnDataAway, game ? !home : false, game);
}

function fillCoach(
  side: 'home' | 'away',
  team: TeamJson | undefined,
  turn: TurnDataJson | undefined,
  playing: boolean,
  game: GameJson | null,
): void {
  const root = document.querySelector<HTMLElement>(`#coach-${side}`);
  const name = root?.querySelector<HTMLElement>('.coach-name');
  const teamName = root?.querySelector<HTMLElement>('.coach-team');
  const logo = root?.querySelector<HTMLImageElement>('.coach-logo');
  const resources = root?.querySelector<HTMLElement>('.coach-resources');
  if (!root || !name || !teamName || !logo || !resources) return;
  root.hidden = !game;
  resources.replaceChildren();
  if (!game) return;
  root.classList.toggle('coach--playing', playing);
  name.textContent = team?.coach || (side === 'home' ? t('hud.uiPanel.home') : t('hud.uiPanel.away'));
  teamName.textContent = team?.teamName || '';
  fillResources(resources, turn);
  const crest = crestDataUrl(team?.race, side);
  logo.hidden = !crest;
  if (crest) logo.src = crest;
}

setInterval(() => {
  const info: PitchDiagnostics = pitch.diagnostics();
  diagEl.textContent = t('spectate3d.diag', {
    fps: info.fps,
    calls: info.calls,
    triangles: info.triangles,
    geometries: info.geometries,
    textures: info.textures,
  });
}, 500);

// Après l'initialisation du module : un await ici, plus haut, appelait show()
// avant des const encore en zone morte (TURNS_PER_HALF, les icônes). Le replay
// était alors jeté et Lecture ne pouvait plus avancer.
const launch = new URLSearchParams(location.search);
const launchGame = Number(launch.get('gameId'));
const launchCoach = launch.get('coach')?.trim() ?? '';
spectateMode = launch.get('spectate') === '1';
if (Number.isInteger(launchGame) && launchGame > 0 && launchCoach) {
  watchLiveGame(launchGame, launchCoach, false);
  // En direct, le socket est la seule source : son instantané de connexion bâtit la timeline et son
  // flux l'allonge. Le replay ne sert qu'à montrer le match quand même, sans le suivre.
  if (!spectateMode || !(await openLiveSocket(launchGame, launch))) await showDownloadedReplay();
} else {
  revealStage();
}
