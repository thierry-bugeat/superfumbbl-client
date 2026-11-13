import type { GameJson, TeamJson } from '@fumbbl40k/ffb-protocol';

/**
 * Présentation domicile / extérieur avant le coup d'envoi.
 * L'écran ne s'ouvre que tant que la partie n'a pas commencé : mi-temps 0 ou 1,
 * aucun tour d'équipe entamé, et une phase d'avant-match (départ, placement, solid defence, engagement).
 */

const BEFORE_START = new Set(['startGame', 'setup', 'solidDefence', 'kickoff']);

export const MATCHUP_DWELL_MS = 6500;

export interface MatchupSideView {
  teamName: string;
  coach: string;
  race: string;
  /** Valeur d'équipe en pièces d'or, comme sur le fil. */
  tvGold: number | null;
}

export interface MatchupView {
  home: MatchupSideView;
  away: MatchupSideView;
}

function turnNr(value: unknown): number {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function side(team: TeamJson | undefined): MatchupSideView {
  const tv = Number(team?.teamValue);
  return {
    teamName: String(team?.teamName ?? '').trim(),
    coach: String(team?.coach ?? '').trim(),
    race: String(team?.race ?? '').trim(),
    tvGold: Number.isFinite(tv) && tv > 0 ? tv : null,
  };
}

/** Milliers affichés (« 1,055k »). Au-dessus de 10 000, la valeur est en pièces d'or. */
export function tvThousands(tvGold: number | null): number | null {
  if (!tvGold) return null;
  return tvGold >= 10_000 ? Math.round(tvGold / 1000) : Math.round(tvGold);
}

export function matchupView(game: GameJson): MatchupView | null {
  if (Math.floor(Number(game.half) || 0) > 1) return null;
  if (turnNr(game.turnDataHome?.turnNr) > 0 || turnNr(game.turnDataAway?.turnNr) > 0) return null;
  if (!BEFORE_START.has(String(game.turnMode ?? ''))) return null;
  const home = side(game.teamHome);
  const away = side(game.teamAway);
  if (!home.teamName && !away.teamName && !home.coach && !away.coach) return null;
  return { home, away };
}
