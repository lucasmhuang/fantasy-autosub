import type { CSSProperties } from "react";

// The NBA teams the design system has a colour for (tokens.css, --team-*), by ESPN's
// abbreviation.
const TEAMS = new Set([
  "atl",
  "bos",
  "bkn",
  "cha",
  "chi",
  "cle",
  "dal",
  "den",
  "det",
  "gs",
  "hou",
  "ind",
  "lac",
  "lal",
  "mem",
  "mia",
  "mil",
  "min",
  "no",
  "ny",
  "okc",
  "orl",
  "phi",
  "phx",
  "por",
  "sac",
  "sa",
  "tor",
  "utah",
  "wsh",
]);

export type TeamStyle = CSSProperties & { "--team": string };

// ESPN's abbreviation, lowercased, for an NBA team; null for a free agent or an unknown team.
export function nbaTeamKey(team?: string | null): string | null {
  const key = team?.toLowerCase();
  return key && TEAMS.has(key) ? key : null;
}

// A card's ground and a row's fade take the team colour through --team. A free agent, or a
// team the system has no colour for, gets none, so its ground stays neutral.
export function teamStyle(team?: string | null): TeamStyle | undefined {
  const key = nbaTeamKey(team);
  return key ? { "--team": `var(--team-${key})` } : undefined;
}
