import { z } from "zod";
import { EspnError } from "./errors";

// The credential check asks for the teams alone, a request no other read makes, since a recording
// keeps one schema per request.
export const CREDENTIAL_VIEWS = ["mTeam"] as const;

// Each team's owners, and the fields only the owner's own cookies reveal, on the owner's team
// alone. The check reads whether one is present, never what it holds, and no recording keeps their
// contents: the scrub empties the two lists and drops draftStrategy.
export const credentialResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.number().int(),
      owners: z.array(z.string()).optional(),
      watchList: z.array(z.unknown()).optional(),
      pendingTransactions: z.array(z.unknown()).optional(),
      draftStrategy: z.object({ draftList: z.array(z.unknown()).optional() }).optional(),
    })
  ),
});

type CredentialResponse = z.infer<typeof credentialResponseSchema>;

// Member ids are compared without braces and case, however ESPN_SWID is written.
const memberIdCore = (memberId: string) => memberId.replace(/[{}]/g, "").toUpperCase();

function rejected(reason: string): EspnError {
  return new EspnError("credentials_rejected", `ESPN credentials need refreshing: ${reason}`);
}

// The cookies are the configured member's if that member's team shows a field only its owner's
// cookies reveal. ESPN drops an emptied list, so a valid cookie may show only one of the three.
// Messages name neither the member id nor a cookie.
export function confirmOwnerCredentials(league: CredentialResponse, ownerSwid: string): void {
  const team = league.teams.find((candidate) =>
    (candidate.owners ?? []).some((owner) => memberIdCore(owner) === memberIdCore(ownerSwid))
  );
  if (!team) throw rejected("no team in this league belongs to the configured member (ESPN_SWID)");
  const showsOwnerFields =
    team.watchList !== undefined ||
    team.pendingTransactions !== undefined ||
    team.draftStrategy?.draftList !== undefined;
  if (!showsOwnerFields) {
    throw rejected(`they read the league, but not as the owner of team ${team.id}`);
  }
}
