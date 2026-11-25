#!/usr/bin/env node
/**
 * Les lancés connus du client 2D sont-ils tous rangés côté 3D, montrés ou volontairement pas ?
 * Seul ce contrôle importe le tri du 2D : le jour où il disparaît, ce fichier part avec lui.
 * Vite charge les deux modules : le tri du 2D tire du code qui ne tourne que sous Vite.
 *
 * `node apps/tauri/src/dev/spectate3d/throws.check.mjs` (lancé par `pnpm check`).
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

/** Animations du 2D qui ne sont pas des lancés (sort, coup d'envoi, explosion…). */
const NOT_THROWS = new Set(['kick', 'bombExplosion', 'trickster', 'spellFireball', 'spellZap', 'spellLightning', 'thenIStartedBlastin']);

const root = fileURLToPath(new URL('../../..', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { KNOWN_PROJECTILE_ANIMATION_TYPES } = await server.ssrLoadModule('/src/game/ballProjectilePresentation.ts');
  const { THROW_KIND, UNSHOWN_THROWS } = await server.ssrLoadModule('/src/dev/spectate3d/throws.ts');
  const missing = [...KNOWN_PROJECTILE_ANIMATION_TYPES].filter(
    (type) => !NOT_THROWS.has(type) && !(type in THROW_KIND) && !UNSHOWN_THROWS.has(type),
  );
  if (missing.length) {
    console.error(`lancés du 2D absents de throws.ts : ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`lancés : ${Object.keys(THROW_KIND).length} montrés, ${UNSHOWN_THROWS.size} en attente, rien d'oublié`);
  }
} finally {
  await server.close();
}
