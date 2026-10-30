import type { UserRole } from "../auth/roles";
import type { AccountRow } from "./accounts-file";

// A stored account, as the seed reads it before planning.
export type ExistingAccount = {
  userId: string;
  email: string;
  teamId: number | null;
  displayName: string;
  role: UserRole;
  isActive: boolean;
};

export type AccountChange = "created" | "updated" | "reactivated" | "unchanged";

export type AccountSyncPlan = {
  teams: { teamId: number; change: AccountChange }[];
  disabledUserIds: string[];
  reactivatedUserIds: string[];
};

// What bringing the store in line with the file changes. A row is matched to the account stored
// under its email, compared exactly as stored. The file's emails are normalized and the seed stores
// only normalized ones, so an account stored any other way (by hand) matches no row and is
// disabled. Disabled and reactivated accounts both lose their sessions when the plan is applied.
export function planAccountSync(existing: ExistingAccount[], rows: AccountRow[]): AccountSyncPlan {
  const storedByEmail = new Map(existing.map((account) => [account.email, account]));
  const fileEmails = new Set(rows.map((row) => row.email));
  const teams = [...rows]
    .sort((a, b) => a.teamId - b.teamId)
    .map((row) => ({ teamId: row.teamId, change: changeFor(row, storedByEmail.get(row.email)) }));
  const disabledUserIds = existing
    .filter((account) => account.isActive && !fileEmails.has(account.email))
    .map((account) => account.userId);
  const reactivatedUserIds = rows.flatMap((row) => {
    const stored = storedByEmail.get(row.email);
    return stored !== undefined && !stored.isActive ? [stored.userId] : [];
  });
  return { teams, disabledUserIds, reactivatedUserIds };
}

function changeFor(row: AccountRow, stored: ExistingAccount | undefined): AccountChange {
  if (stored === undefined) return "created";
  if (!stored.isActive) return "reactivated";
  const same =
    stored.teamId === row.teamId &&
    stored.displayName === row.displayName &&
    stored.role === row.role;
  return same ? "unchanged" : "updated";
}
