import { Pitch3D, type CameraPreset, type PitchDiagnostics } from '@fumbbl40k/ffb-pitch3d';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { describeState } from './describeState';
import { buildReplayTimeline, type ReplayTimeline } from './replayTimeline';

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
await pitch.init(stageEl);

let timeline: ReplayTimeline | null = null;
let index = 0;

function show(): void {
  if (!timeline) {
    statusEl.textContent = 'Aucun replay chargé. Le stade s\'affiche quand même.';
    logEl.textContent = '';
    return;
  }
  const state = timeline.states[index];
  const command = index === 0 ? null : timeline.commands[index - 1];
  statusEl.textContent = command
    ? `commande ${index} / ${timeline.commands.length} — ${command.netCommandId}`
    : `départ — 0 / ${timeline.commands.length}`;
  if (state) {
    pitch.present(state);
    logEl.textContent = describeState(state);
  }
}

document.querySelector<HTMLInputElement>('#file')?.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  statusEl.textContent = 'Lecture du replay…';
  try {
    timeline = buildReplayTimeline(await file.text());
    index = 0;
    show();
  } catch (error) {
    timeline = null;
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    logEl.textContent = '';
  }
});

function step(next: number): void {
  if (!timeline) return;
  index = Math.max(0, Math.min(timeline.states.length - 1, next));
  show();
}

document.querySelector('#first')?.addEventListener('click', () => step(0));
document.querySelector('#prev')?.addEventListener('click', () => step(index - 1));
document.querySelector('#next')?.addEventListener('click', () => step(index + 1));
document.querySelector('#last')?.addEventListener('click', () => step((timeline?.states.length ?? 1) - 1));

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preset]'))) {
  button.addEventListener('click', () => pitch.setPreset(button.dataset.preset as CameraPreset));
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-weather]'))) {
  button.addEventListener('click', () => {
    pitch.present({ fieldModel: { weather: button.dataset.weather } } as GameJson);
  });
}

document.querySelector('#leak')?.addEventListener('click', async () => {
  const before = pitch.diagnostics();
  statusEl.textContent = 'Rechargement…';
  for (let i = 0; i < 10; i += 1) {
    pitch.destroy();
    await pitch.init(stageEl);
  }
  const after = pitch.diagnostics();
  statusEl.textContent = `10 rechargements : géométries ${before.geometries} → ${after.geometries}, textures ${before.textures} → ${after.textures}`;
  if (timeline) pitch.present(timeline.states[index] as GameJson);
});

setInterval(() => {
  const info: PitchDiagnostics = pitch.diagnostics();
  diagEl.textContent = `${info.fps} i/s — ${info.calls} appels — ${info.triangles} triangles — ${info.geometries} géométries — ${info.textures} textures`;
}, 500);
