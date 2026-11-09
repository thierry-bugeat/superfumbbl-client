#!/usr/bin/env node
/**
 * Garde-fou du package 3D.
 * 1. Aucun import interdit dans packages/ffb-pitch3d/src.
 * 2. Aucun fichier protégé (protocole, rendu 2D, vue spectateur, replay) modifié
 *    par rapport à upstream/main, arbre de travail compris.
 *    apps/tauri/package.json et pnpm-lock.yaml sont les deux exceptions prévues.
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

  const dir = mkdtempSync(join(tmpdir(), 'pitch3d-probe-'));
  try {
    const src = join(dir, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'bad.ts'), "import { ref } from 'vue';\nexport const x = ref(0);\n");
    const hits = scanImports(src);
    if (hits.length !== 1) failures.push(`sonde d'import : ${hits.length} résultat(s), 1 attendu`);
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
  const importHits = scanImports(join(PACKAGE_DIR, 'src'));
  const protectedHits = changedFiles().filter(isProtectedPath).map((file) => `${file} est modifié`);
  const hits = [...importHits, ...protectedHits];
  if (hits.length) fail(['Garde-fou ffb-pitch3d :', ...hits.map((hit) => `  - ${hit}`)]);
  else console.log('garde-fou ok');
}
