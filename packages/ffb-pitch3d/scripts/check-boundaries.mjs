#!/usr/bin/env node
/**
 * Garde-fou du package 3D.
 * 1. Aucun import interdit dans packages/ffb-pitch3d/src.
 * 2. Aucun fichier protégé (protocole, rendu 2D, vue spectateur, replay) modifié
 *    par rapport à upstream/main, arbre de travail compris.
 *    apps/tauri/package.json et pnpm-lock.yaml sont les deux exceptions prévues.
 *    Les autres se déclarent une par une dans client-2d-exceptions.json, avec leur raison.
 *
 * Importer le client 2D depuis la page 3D est autorisé ; c'est le modifier qui demande
 * une dérogation. La règle 1 reste entière : le package 3D, lui, n'importe pas l'application.
 *
 * Épreuve : `node scripts/check-boundaries.mjs --self-test`
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');

const FORBIDDEN_SPECIFIERS = [
  /^vue($|\/)/,
  /^@tauri-apps\//,
  /^pixi\.js($|\/)/,
  /^@fumbbl40k\/ffb-pitch($|\/)/,
  /^apps\//,
];

const IMPORT_PATTERN = /(?:from\s+|import\s+|require\(\s*)['"]([^'"]+)['"]/g;

export function forbiddenImport(specifier) {
  return FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier));
}

/** pnpm-lock.yaml et apps/tauri/package.json sont les seules modifications hors fichiers neufs autorisées. */
export function isProtectedPath(file) {
  const path = file.replaceAll('\\', '/');
  if (path === 'pnpm-lock.yaml' || path === 'apps/tauri/package.json') return false;
  return path.startsWith('packages/ffb-protocol/')
    || path.startsWith('packages/ffb-pitch/')
    || path === 'apps/tauri/src/views/SpectateView.vue'
    || path === 'apps/tauri/src/game/store.ts'
    || path === 'apps/tauri/src/App.vue'
    || path.startsWith('apps/tauri/src/game/replay/');
}

const EXCEPTIONS_FILE = join(SCRIPT_DIR, 'client-2d-exceptions.json');

/**
 * Chemin du client 2D → raison de la modification. Une entrée sans raison écrite ne vaut pas
 * dérogation : c'est la justification qui est demandée, pas l'inscription sur une liste.
 * Fichier absent = aucune dérogation ; fichier illisible = le garde-fou casse plutôt que de s'ouvrir.
 */
export function readExceptions(file = EXCEPTIONS_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  return new Map(Object.entries(JSON.parse(text))
    .filter(([, reason]) => typeof reason === 'string' && reason.trim().length > 0));
}

/** Fichiers protégés modifiés sans dérogation écrite. */
export function unjustifiedChanges(files, exceptions) {
  return files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((path) => isProtectedPath(path) && !exceptions.has(path));
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) files.push(path);
  }
  return files;
}

export function scanImports(srcDir) {
  const hits = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (forbiddenImport(specifier)) hits.push(`${relative(srcDir, file)} importe « ${specifier} »`);
    }
  }
  return hits;
}

function changedFiles() {
  const args = [
    ['diff', '--name-only', 'upstream/main'],
    ['diff', '--name-only', '--cached', 'upstream/main'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  const names = new Set();
  for (const gitArgs of args) {
    const out = execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
    for (const line of out.split('\n')) if (line) names.add(line);
  }
  return [...names];
}

function fail(lines) {
  console.error(lines.join('\n'));
  process.exitCode = 1;
}

function selfTest() {
  const failures = [];
  if (!forbiddenImport('vue')) failures.push('vue non détecté');
  if (!forbiddenImport('@tauri-apps/api')) failures.push('tauri non détecté');
  if (!forbiddenImport('pixi.js')) failures.push('pixi non détecté');
  if (!forbiddenImport('@fumbbl40k/ffb-pitch/src/renderer')) failures.push('ffb-pitch non détecté');
  if (forbiddenImport('three')) failures.push('three signalé à tort');
  if (forbiddenImport('@fumbbl40k/ffb-protocol')) failures.push('ffb-protocol signalé à tort');
  if (!isProtectedPath('packages/ffb-protocol/src/index.ts')) failures.push('protocole non protégé');
  if (!isProtectedPath('apps/tauri/src/game/replay/replayLoader.ts')) failures.push('replay non protégé');
  if (isProtectedPath('apps/tauri/package.json')) failures.push('package.json de l’app protégé à tort');
  if (isProtectedPath('pnpm-lock.yaml')) failures.push('lockfile protégé à tort');
  if (isProtectedPath('packages/ffb-pitch3d/src/Pitch3D.ts')) failures.push('le package 3D est protégé à tort');

  const granted = new Map([['apps/tauri/src/App.vue', 'montage de la page 3D']]);
  if (unjustifiedChanges(['apps/tauri/src/App.vue'], granted).length) failures.push('dérogation écrite non reconnue');
  if (unjustifiedChanges(['apps/tauri/src/App.vue'], new Map()).length !== 1) failures.push('sans liste, la dérogation ne doit pas être implicite');
  if (unjustifiedChanges(['apps/tauri/src/game/store.ts'], granted).length !== 1) failures.push('modification non dérogée non détectée');
  if (unjustifiedChanges(['apps/tauri/src/dev/spectate3d/main.ts'], new Map()).length) failures.push('la page 3D est protégée à tort');

  const dir = mkdtempSync(join(tmpdir(), 'pitch3d-probe-'));
  try {
    const src = join(dir, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'bad.ts'), "import { ref } from 'vue';\nexport const x = ref(0);\n");
    const hits = scanImports(src);
    if (hits.length !== 1) failures.push(`sonde d'import : ${hits.length} résultat(s), 1 attendu`);

    const list = join(dir, 'exceptions.json');
    writeFileSync(list, JSON.stringify({ 'apps/tauri/src/App.vue': 'raison', 'apps/tauri/src/game/store.ts': '  ' }));
    const read = readExceptions(list);
    if (read.size !== 1) failures.push(`sonde de dérogations : ${read.size} entrée(s), 1 attendue`);
    if (readExceptions(join(dir, 'absent.json')).size !== 0) failures.push('fichier absent : aucune dérogation attendue');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    fail(failures);
    return;
  }
  console.log('self-test ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const exceptions = readExceptions();
  const changed = changedFiles();
  const importHits = scanImports(join(PACKAGE_DIR, 'src'));
  const protectedHits = unjustifiedChanges(changed, exceptions)
    .map((file) => `${file} est modifié sans dérogation`);
  const hits = [...importHits, ...protectedHits];
  if (hits.length) {
    fail([
      'Garde-fou ffb-pitch3d :',
      ...hits.map((hit) => `  - ${hit}`),
      '',
      'Une modification du client 2D part chez son auteur. Si elle est minime et nécessaire,',
      `inscris le chemin et sa raison dans ${relative(REPO_ROOT, EXCEPTIONS_FILE)}.`,
    ]);
  } else {
    for (const file of changed.map((f) => f.replaceAll('\\', '/')).filter((f) => exceptions.has(f))) {
      console.log(`dérogation : ${file} — ${exceptions.get(file)}`);
    }
    console.log('garde-fou ok');
  }
}
