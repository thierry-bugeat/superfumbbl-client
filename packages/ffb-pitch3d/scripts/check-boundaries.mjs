#!/usr/bin/env node
/**
 * Garde-fou du package 3D.
 * 1. Aucun import interdit dans packages/ffb-pitch3d/src, ni aucun chemin relatif qui en sort.
 *    Vus : from / import / export from / require, import(), import.meta.glob (chaîne ou tableau,
 *    y compris un .glob<…>() après un transtypage) et new URL('…', import.meta.url).
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
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
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

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.vue']);

export function forbiddenImport(specifier) {
  return FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier));
}

/**
 * Spécificateur relatif qui, résolu depuis le fichier, sort du package.
 * Les spécificateurs nus (`vue`, `three`) restent jugés par {@link forbiddenImport}.
 */
export function leavesPackage(file, specifier, packageDir = PACKAGE_DIR) {
  const bare = specifier.split(/[?#]/, 1)[0];
  if (!bare.startsWith('.')) return false;
  const resolved = resolve(dirname(file), bare);
  const root = packageDir.endsWith(sep) ? packageDir : packageDir + sep;
  return resolved !== packageDir && !resolved.startsWith(root);
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
    else if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

function skipSpace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

/** Après `.glob`, saute un éventuel `<…>` (y compris `Record<string, string>`). */
function skipTypeArgs(text, index) {
  if (text[index] !== '<') return index;
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === '<') depth += 1;
    else if (text[i] === '>') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return index;
}

function quoted(text, index) {
  const quote = text[index];
  if (quote !== "'" && quote !== '"') return null;
  const end = text.indexOf(quote, index + 1);
  if (end < 0) return null;
  return { value: text.slice(index + 1, end), next: end + 1 };
}

/** `import.meta.glob('…')`, `.glob<T>('…')` et `import.meta.glob(['…', '…'])`. */
function globSpecifiers(text) {
  const specs = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('.glob', from);
    if (at < 0) break;
    let index = skipTypeArgs(text, skipSpace(text, at + '.glob'.length));
    index = skipSpace(text, index);
    if (text[index] !== '(') {
      from = at + '.glob'.length;
      continue;
    }
    index = skipSpace(text, index + 1);
    if (text[index] === '[') {
      const close = text.indexOf(']', index + 1);
      if (close < 0) break;
      for (const match of text.slice(index, close).matchAll(/['"]([^'"]+)['"]/g)) specs.push(match[1]);
      from = close + 1;
    } else {
      const one = quoted(text, index);
      if (one) specs.push(one.value);
      from = one ? one.next : index + 1;
    }
  }
  return specs;
}

/**
 * Tous les spécificateurs d'un fichier source. Les commentaires ne sont pas retirés :
 * une forme d'import dans un commentaire est traitée comme une vraie, comme avant.
 */
export function extractSpecifiers(text) {
  const specs = [];
  const patterns = [
    /(?:from\s+|import\s+|require\(\s*)['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specs.push(match[1]);
  }
  specs.push(...globSpecifiers(text));
  return specs;
}

export function scanImports(srcDir, packageDir = PACKAGE_DIR) {
  const hits = [];
  for (const file of walk(srcDir)) {
    const rel = relative(srcDir, file);
    for (const specifier of extractSpecifiers(readFileSync(file, 'utf8'))) {
      if (forbiddenImport(specifier)) hits.push(`${rel} importe « ${specifier} »`);
      else if (leavesPackage(file, specifier, packageDir)) hits.push(`${rel} sort du package par « ${specifier} »`);
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
    const pkg = join(dir, 'pkg');
    // Les quatre sondes relatives ne sont vues que par la règle de sortie. La commenter fait échouer ici.
    const probes = [
      ['import statique vue', 'src/a.ts', "import { ref } from 'vue';"],
      ['export depuis le barrel', 'src/a.ts', "export { x } from '@fumbbl40k/ffb-pitch';"],
      ['import dynamique', 'src/a.ts', "const p = await import('pixi.js');"],
      ['relatif vers ffb-pitch', 'src/a.ts', "import { d6FaceUrl } from '../../../ffb-pitch/src/d6';"],
      ['relatif vers apps', 'src/a.ts', "import { t } from '../../../../apps/tauri/src/i18n';"],
      ['import.meta.glob', 'src/a.ts', "const u = import.meta.glob('../../../ffb-pitch/assets/walk/*/*.png');"],
      ['glob tableau', 'src/a.ts', "const u = import.meta.glob(['../../../ffb-pitch/a.png', '../../../ffb-pitch/b.png']);"],
      ['glob typé', 'src/a.ts', "const u = (import.meta as unknown as { glob: UrlGlob }).glob<string>('../../../ffb-pitch/assets/walk/*/*.png');"],
      ['new URL hors package', 'src/a.ts', "const u = new URL('../../../ffb-pitch/assets/x.png', import.meta.url);"],
      ['import vue dans un .js', 'src/a.js', "import 'vue';"],
      ['import vue dans un .tsx', 'src/a.tsx', "import 'vue';"],
      ['import vue dans un .vue', 'src/a.vue', "import 'vue';"],
    ];
    for (const [name, relPath, code] of probes) {
      const file = join(pkg, relPath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${code}\n`);
      const hits = scanImports(join(pkg, 'src'), pkg);
      rmSync(join(pkg, 'src'), { recursive: true, force: true });
      if (!hits.length) failures.push(`sonde « ${name} » non vue`);
    }

    const kept = join(pkg, 'src/nested/ok.ts');
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, "const u = new URL('../../assets/x.png', import.meta.url);\n");
    const keptHits = scanImports(join(pkg, 'src'), pkg);
    if (keptHits.length) failures.push(`sonde négative signalée à tort : ${keptHits.join(', ')}`);

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

function runGuard() {
  const exceptions = readExceptions();
  const changed = changedFiles();
  const importHits = scanImports(join(PACKAGE_DIR, 'src'));
  const protectedHits = unjustifiedChanges(changed, exceptions)
    .map((file) => `${file} est modifié sans dérogation`);
  const hits = [...importHits, ...protectedHits];
  if (hits.length) {
    const lines = ['Garde-fou ffb-pitch3d :', ...hits.map((hit) => `  - ${hit}`), ''];
    if (importHits.length) {
      lines.push("Le package 3D n'importe ni Vue, ni Pixi, ni Tauri, ni le rendu 2D,");
      lines.push('et aucun chemin relatif ne doit en sortir.');
    }
    if (protectedHits.length) {
      lines.push('Une modification du client 2D part chez son auteur. Si elle est minime et nécessaire,');
      lines.push(`inscris le chemin et sa raison dans ${relative(REPO_ROOT, EXCEPTIONS_FILE)}.`);
    }
    fail(lines);
  } else {
    for (const file of changed.map((f) => f.replaceAll('\\', '/')).filter((f) => exceptions.has(f))) {
      console.log(`dérogation : ${file} — ${exceptions.get(file)}`);
    }
    console.log('garde-fou ok');
  }
}

// argv[1] est le chemin tel qu'il a été écrit, souvent relatif ; import.meta.url est absolu.
const isDirectRun = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  if (process.argv.includes('--self-test')) selfTest();
  else runGuard();
}
