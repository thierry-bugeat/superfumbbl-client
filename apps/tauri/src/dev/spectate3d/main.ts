import { Pitch3D, type PitchDiagnostics } from '@fumbbl40k/ffb-pitch3d';
import type { GameJson, TeamJson, TurnDataJson } from '@fumbbl40k/ffb-protocol';
import { crestDataUrl } from '../../game/teamCrests';
import {
  buildInducementChips,
  cheeringFansChip,
  CHEERING_FANS_CHIP_ICON,
  type InducementChip,
} from '../../game/logic/coachPanelChips';
import { blockDiceColor, blockRollAt } from './blockRoll';
import { describeState } from './describeState';
import { mountPlayerCards } from './playerCard';
import { MatchLog } from './matchLog';
import { t } from '../../i18n';
import { SPECTATE3D_RETURN_MESSAGE } from '../../game/spectate3dSession';
import { applyClientLanguage, applySpectate3dCopy } from './locale';
import { fetchReplay, loadReplayText, ReplayTimeline, replayStillLive } from './replayTimeline';

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

const pitch = new Pitch3D();
mountConsole();
const playerPanel = document.querySelector<HTMLElement>('#player');
if (playerPanel) mountFloating(playerPanel, document.querySelector<HTMLButtonElement>('#player-collapse'), t('spectate3d.player.name'));
await pitch.init(stageEl);

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
}

const logsIcon = document.querySelector<HTMLImageElement>('#logs-icon');
const resetIcon = document.querySelector<HTMLImageElement>('#reset-camera-icon');
const playerCardIcon = document.querySelector<HTMLImageElement>('#player-card-icon');
const tackleZonesIcon = document.querySelector<HTMLImageElement>('#tackle-zones-icon');
const consoleIcon = document.querySelector<HTMLImageElement>('#console-icon');
if (logsIcon) logsIcon.src = new URL('./logs.svg', import.meta.url).href;
if (resetIcon) resetIcon.src = new URL('./reset-camera.svg', import.meta.url).href;
if (playerCardIcon) playerCardIcon.src = new URL('./cards/player-card.svg', import.meta.url).href;
if (tackleZonesIcon) tackleZonesIcon.src = new URL('./tackle-zones.svg', import.meta.url).href;
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

const playerCards = mountPlayerCards();
let shownGame: GameJson | null = null;
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

function renderMatchLog(lines?: readonly string[]): void {
  if (lines) shownLog = lines;
  if (!matchLogEl) return;
  if (shownLog.length === 0) {
    matchLogEl.textContent = '';
    return;
  }
  matchLogEl.textContent = logExpanded ? shownLog.join('\n') : shownLog[shownLog.length - 1] ?? '';
  if (logExpanded && logStickToBottom && logInner) logInner.scrollTop = logInner.scrollHeight;
}

/**
 * L'animation annonce la case d'arrivée avant que le modèle n'y pose le joueur.
 * La parabole part à cette annonce et continue si l'état change en plein vol.
 */
function thrownMate(command: { animation?: unknown } | null): { id: string; x: number; y: number; withBall: boolean } | null {
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
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { id: String(animation.thrownPlayerId), x, y, withBall: animation.withBall === true };
}

function lobThrownMate(command: { animation?: unknown } | null): void {
  const thrown = thrownMate(command);
  if (!thrown) return;
  pitch.throwMate(thrown.id, thrown.x, thrown.y, thrown.withBall);
}

let timeline: ReplayTimeline | null = null;
let index = 0;
let seekGeneration = 0;

async function show(): Promise<void> {
  const generation = ++seekGeneration;
  if (!timeline) {
    statusEl.textContent = t('spectate3d.status.empty');
    logEl.textContent = '';
    matchLog.reset();
    loggedTimeline = null;
    renderMatchLog([]);
    pitch.clearBlockDice();
    shownGame = null;
    showCoaches(null);
    paintLiveButton();
    return;
  }
  const current = timeline;
  const state = await current.seek(index, (done, target) => {
    if (generation !== seekGeneration) return;
    statusEl.textContent = t('spectate3d.status.computing', { done, target });
  });
  if (generation !== seekGeneration) return;
  const command = index === 0 ? null : current.commands[index - 1];
  statusEl.textContent = command
    ? t('spectate3d.status.command', { index, total: current.commands.length, id: command.netCommandId })
    : t('spectate3d.status.start', { total: current.commands.length });
  pitch.present(state);
  lobThrownMate(command);
  shownGame = state;
  playerCards.refresh(state);
  showBlockDice(current.commands, index, state);
  logEl.textContent = describeState(state);
  showTurns(state);
  showScore(state);
  showCoaches(state);
  if (timeline !== loggedTimeline) {
    matchLog.reset();
    loggedTimeline = timeline;
  }
  renderMatchLog(matchLog.sync(current.commands, index, state));
  paintLiveButton();
}

async function openLoadedReplay(): Promise<void> {
  index = 0;
  await seekFirstLineup();
  await show();
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
  if (playing) playTimer = window.setTimeout(() => { void advance(); }, 220);
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
  playTimer = window.setTimeout(() => { void advance(); }, 220);
}

playButton?.addEventListener('click', () => setPlaying(!playing));

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

const LIVE_PULL_MS = 5000;
const LIVE_CATCHUP_LIMIT = 24;
let liveGameId = 0;
let liveCoach = '';
let liveOpen = false;
let spectateMode = false;
let followingLive = false;
let followGeneration = 0;
let liveTimer = 0;
let pullChain: Promise<number> = Promise.resolve(0);

function stopFollowingLive(): void {
  followingLive = false;
  followGeneration += 1;
  window.clearTimeout(liveTimer);
  paintLiveButton();
}

function startFollowingLive(): void {
  if (!liveOpen || !liveGameId || !timeline) {
    paintLiveButton();
    return;
  }
  followingLive = true;
  scheduleLivePull();
  paintLiveButton();
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

function scheduleLivePull(): void {
  window.clearTimeout(liveTimer);
  if (!followingLive || !liveOpen) return;
  liveTimer = window.setTimeout(() => { void pullLiveAndAdvance(); }, LIVE_PULL_MS);
}

/** Second téléchargement anonyme du même match. Les commandes déjà vues restent en place. */
function pullReplay(): Promise<number> {
  const run = pullChain.catch(() => 0).then(async () => {
    if (!timeline || !liveGameId || !liveCoach || !liveOpen) return 0;
    const bundle = await fetchReplay(liveGameId, liveCoach);
    if (!timeline) return 0;
    if (!replayStillLive(bundle)) liveOpen = false;
    return timeline.extend(bundle.commands);
  });
  pullChain = run.then(() => 0, () => 0);
  return run;
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
    if (!timeline || index >= timeline.length - 1) return;
    await new Promise((resolve) => window.setTimeout(resolve, 220));
  }
}

async function pullLiveAndAdvance(): Promise<void> {
  if (!followingLive || !timeline) return;
  const generation = followGeneration;
  const wasAtHead = index >= timeline.length - 1;
  try {
    const added = await pullReplay();
    if (generation !== followGeneration || !followingLive) return;
    if (added > 0 && wasAtHead) await catchUp(generation);
  } catch {
    // Le passage suivant réessaie. Le match déjà affiché reste en place.
  }
  if (!liveOpen) {
    followingLive = false;
    window.clearTimeout(liveTimer);
    paintLiveButton();
    return;
  }
  if (followingLive && generation === followGeneration) scheduleLivePull();
}

/** Dernière action connue, puis suivi des commandes qui arrivent ensuite. */
async function goToLatest(): Promise<void> {
  followGeneration += 1;
  const generation = followGeneration;
  followingLive = false;
  window.clearTimeout(liveTimer);
  setPlaying(false);
  if (!timeline) return;
  if (liveGameId && liveCoach && liveOpen) {
    const previous = statusEl.textContent;
    statusEl.textContent = t('spectate3d.status.downloading');
    try {
      await pullReplay();
    } catch {
      if (generation === followGeneration && previous) statusEl.textContent = previous;
    }
  }
  if (generation !== followGeneration || !timeline) return;
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

window.addEventListener('pagehide', () => stopFollowingLive());

document.querySelector('#first')?.addEventListener('click', () => step(0));
document.querySelector('#prev')?.addEventListener('click', () => stepTeamTurn(-1));
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
      statusEl.textContent = t('spectate3d.status.seeking', { index: i, total: current.commands.length });
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
  for (const icon of weather.querySelectorAll<SVGElement>('svg')) {
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
  fillCoach('home', game?.teamHome, game?.turnDataHome, game?.homePlaying === true, game);
  fillCoach('away', game?.teamAway, game?.turnDataAway, game?.homePlaying === false, game);
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
  statusEl.textContent = t('spectate3d.status.downloading');
  try {
    const bundle = await fetchReplay(launchGame, launchCoach);
    timeline = ReplayTimeline.fromBundle(bundle);
    watchLiveGame(launchGame, launchCoach, spectateMode && replayStillLive(bundle));
    await openLoadedReplay();
  } catch (error) {
    timeline = null;
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}
