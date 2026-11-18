// How InjurySub names teams and people everywhere it writes (FS-APP-14): a team by the first name
// it has for it (the stored copy first), "Team {id}" only while it has none; a person by first name.

export function teamName(teamId: number, ...names: (string | null | undefined)[]): string {
  const known = names.find((name) => name !== null && name !== undefined && name.trim() !== "");
  return known ?? `Team ${teamId}`;
}

export function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? null : first;
}

// A lineup slot as InjurySub writes it: ESPN's bench, "BE", reads "BN" everywhere.
export function slotLabel(slot: string): string {
  return slot === "BE" ? "BN" : slot;
}

// "{team} · {first name}", where the commissioner acts for or about a person (D8-1).
export function teamWithManager(team: string, managerName: string | null): string {
  const manager = firstName(managerName);
  return manager === null ? team : `${team} · ${manager}`;
}
