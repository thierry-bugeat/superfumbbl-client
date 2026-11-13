/**
 * Repli des races sans atlas illustré : case au repos des sprites de marche.
 * Face = ligne 1, colonne 1 (sud). Dos = ligne 5, colonne 1 (nord).
 * Les fichiers restent dans ffb-pitch ; ce module ne l'importe pas.
 */

type UrlGlob = <T>(pattern: string, options: { eager: true; query: '?url'; import: 'default' }) => Record<string, T>;

const COLUMNS = 9;
const ROWS = 8;
const FRONT_ROW = 0;
const BACK_ROW = 4;
/** Hauteur monde d'une case entière. Le personnage rogné est une fraction de ça. */
const FRAME_WORLD = 1.5;

const walkUrls = (import.meta as unknown as { glob: UrlGlob }).glob<string>('../../../ffb-pitch/assets/walk/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const ROLE_ALIASES: Record<string, Record<string, string>> = {
  human: {
    humanlineman: 'lineman',
    humanthrower: 'thrower',
    humancatcher: 'catcher',
    humanblitzer: 'blitzer',
    halflinghopeful: 'halflinghopeful',
    ogre: 'ogre',
    lineman: 'lineman',
    thrower: 'thrower',
    catcher: 'catcher',
    blitzer: 'blitzer',
  },
  necromantichorror: {
    zombielineman: 'zombie',
    ghoulrunner: 'ghoulrunner',
    wraith: 'wraith',
    werewolf: 'werewolf',
    fleshgolem: 'fleshgolem',
  },
  slann: {
    slannlineman: 'lineman',
    slannthrower: 'thrower',
    slanncatcher: 'catcher',
    slannblitzer: 'blitzer',
    lineman: 'lineman',
    thrower: 'thrower',
    catcher: 'catcher',
    blitzer: 'blitzer',
    kroxigor: 'kroxigor',
  },
  orc: {
    orclineman: 'lineman',
    orcthrower: 'thrower',
    orcblitzer: 'blitzer',
    bigunblocker: 'blackorcblocker',
    goblinlineman: 'goblin',
    troll: 'troll',
    lineman: 'lineman',
    thrower: 'thrower',
    blitzer: 'blitzer',
    goblin: 'goblin',
    blackorcblocker: 'blackorcblocker',
  },
};

interface Sheet {
  race: string;
  role: string;
  side: 'home' | 'away';
  url: string;
}

const sheets: Sheet[] = [];
const rolesByRace = new Map<string, Set<string>>();

for (const [path, url] of Object.entries(walkUrls)) {
  const match = path.match(/\/walk\/([^/]+)\/([^/]+)-(home|away)\.png$/);
  if (!match || !match[1] || !match[2] || (match[3] !== 'home' && match[3] !== 'away')) continue;
  const race = match[1];
  const role = match[2];
  sheets.push({ race, role, side: match[3], url });
  let roles = rolesByRace.get(race);
  if (!roles) {
    roles = new Set();
    rolesByRace.set(race, roles);
  }
  roles.add(role);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Retire un millésime ou un sigle de règles collé au nom de race. */
function rosterRaceKey(race: string): string {
  const key = normalize(race);
  return key.replace(/^(?:bb\d{4}|bb\d|crp|lrb\d|ffb|20\d{2})+/, '').replace(/(?:bb\d{4}|bb\d|crp|lrb\d|20\d{2})+$/, '') || key;
}

function uniqueRole(roles: Set<string>, name: string): string | undefined {
  if (roles.has(name)) return name;
  const hits = [...roles].filter((role) => role === name || role.endsWith(name) || name.endsWith(role) || name.startsWith(role));
  return hits.length === 1 ? hits[0] : undefined;
}

function roleOf(raceKey: string, positionName: string): string | undefined {
  const roles = rolesByRace.get(raceKey);
  if (!roles) return undefined;
  const name = normalize(positionName);
  const alias = ROLE_ALIASES[raceKey]?.[name];
  if (alias && roles.has(alias)) return alias;
  return uniqueRole(roles, name);
}

function urlOf(race: string, role: string, side: 'home' | 'away'): string | null {
  return sheets.find((sheet) => sheet.race === race && sheet.role === role && sheet.side === side)?.url
    ?? sheets.find((sheet) => sheet.race === race && sheet.role === role)?.url
    ?? null;
}

/** Feuille de marche du poste, kit domicile ou extérieur. */
export function walkSheetUrl(race: string, positionName: string, home: boolean): string | null {
  const side = home ? 'home' : 'away';
  const raceKey = rolesByRace.has(normalize(race)) ? normalize(race) : rosterRaceKey(race);
  const role = roleOf(raceKey, positionName);
  if (role) return urlOf(raceKey, role, side);
  const star = roleOf('stars', positionName);
  return star ? urlOf('stars', star, side) : null;
}

export interface WalkFace {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface WalkStrip {
  /** Neuf cases de la ligne sud, même cadre que la pose immobile. */
  frames: WalkFace[];
  back: WalkFace;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = images.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
  images.set(url, pending);
  return pending;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function cellOf(image: HTMLImageElement, column: number, row: number): HTMLCanvasElement | null {
  const cellW = image.naturalWidth / COLUMNS;
  const cellH = image.naturalHeight / ROWS;
  if (cellW < 1 || cellH < 1) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cellW);
  canvas.height = Math.round(cellH);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, column * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function opaqueBounds(canvas: HTMLCanvasElement): Bounds | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if ((pixels[(y * canvas.width + x) * 4 + 3] ?? 0) <= 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    minX: Math.max(0, minX - 1),
    minY: Math.max(0, minY - 1),
    maxX: Math.min(canvas.width - 1, maxX + 1),
    maxY: Math.min(canvas.height - 1, maxY + 1),
  };
}

function cut(cell: HTMLCanvasElement, bounds: Bounds): WalkFace | null {
  const widthPx = bounds.maxX - bounds.minX + 1;
  const heightPx = bounds.maxY - bounds.minY + 1;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(cell, bounds.minX, bounds.minY, widthPx, heightPx, 0, 0, widthPx, heightPx);
  return {
    canvas,
    width: FRAME_WORLD * (widthPx / cell.width),
    height: FRAME_WORLD * (heightPx / cell.height),
  };
}

function unionBounds(cells: HTMLCanvasElement[]): Bounds | null {
  let box: Bounds | null = null;
  for (const cell of cells) {
    const next = opaqueBounds(cell);
    if (!next) continue;
    box = box
      ? {
        minX: Math.min(box.minX, next.minX),
        minY: Math.min(box.minY, next.minY),
        maxX: Math.max(box.maxX, next.maxX),
        maxY: Math.max(box.maxY, next.maxY),
      }
      : next;
  }
  return box;
}

const portraits = new Map<string, Promise<HTMLCanvasElement | null>>();

/** Pose de face au repos, rognée sur les pixels opaques. Pour la carte joueur. */
export function walkPortrait(race: string, positionName: string, home: boolean): Promise<HTMLCanvasElement | null> {
  const url = walkSheetUrl(race, positionName, home);
  if (!url) return Promise.resolve(null);
  const cached = portraits.get(url);
  if (cached) return cached;
  const pending = loadImage(url).then((image) => {
    if (!image) return null;
    const cell = cellOf(image, 0, FRONT_ROW);
    const bounds = cell ? opaqueBounds(cell) : null;
    return cell && bounds ? cut(cell, bounds)?.canvas ?? null : null;
  });
  portraits.set(url, pending);
  return pending;
}

/** Ligne sud entière, plus le dos au repos. Un seul cadre pour les neuf cases, les pieds ne bougent pas. */
export async function loadWalkStrip(url: string): Promise<WalkStrip | null> {
  const image = await loadImage(url);
  if (!image) return null;
  const cells: HTMLCanvasElement[] = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    const cell = cellOf(image, column, FRONT_ROW);
    if (!cell) return null;
    cells.push(cell);
  }
  const bounds = unionBounds(cells);
  if (!bounds) return null;
  const frames: WalkFace[] = [];
  for (const cell of cells) {
    const face = cut(cell, bounds);
    if (!face) return null;
    frames.push(face);
  }
  const backCell = cellOf(image, 0, BACK_ROW);
  const backBounds = backCell ? opaqueBounds(backCell) : null;
  const back = backCell && backBounds ? cut(backCell, backBounds) : null;
  if (!back) return null;
  return { frames, back };
}
