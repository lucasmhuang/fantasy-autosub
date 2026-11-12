import { Button } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../components/commish/commish-header";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Surface } from "../../../../components/shell/site-shell";
import { commissionerAccess, getCurrentAuthenticatedSession } from "../../../../lib/server/auth";
import { LEAGUE_TEAM_IDS, loadSettings } from "../../../../lib/server/commish-settings";
import { renderCommissionerStatus } from "../status-messages";

// The execution mode and the teams automation may act for (Q1, Q2, O11). In this step nothing
// writes to ESPN either way; the settings decide where requests go.
export default async function CommissionerSettingsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect("/login?redirect=/commish/settings");
  if (access === "not_commissioner") redirect("/app");
  const { status } = await props.searchParams;
  const view = await loadSettings();

  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <CommishHeader title="Settings" hasTeam={session.user.teamId !== null} />
          <StatusNotice status={renderCommissionerStatus(status ?? null)} />
          {view.status === "found" ? (
            <SettingsForm
              mode={view.settings.executionMode}
              allowlist={view.settings.writeAllowlist}
              shownUpdatedAt={view.settings.updatedAt?.toISOString() ?? ""}
            />
          ) : (
            <p className="mt-6 text-sm text-[color:var(--muted)]">
              The settings can’t be shown right now. Try again in a moment.
            </p>
          )}
        </Surface>
      </div>
    </main>
  );
}

// The form carries when the settings it shows were saved, so an older tab can't overwrite a
// later change.
function SettingsForm(props: { mode: string; allowlist: number[]; shownUpdatedAt: string }) {
  const { mode, allowlist, shownUpdatedAt } = props;
  return (
    <form
      action="/commish/settings/save"
      method="post"
      className="mt-6 flex flex-col gap-6 text-sm"
    >
      <input type="hidden" name="shownUpdatedAt" value={shownUpdatedAt} />
      <ModeFields mode={mode} />
      <TeamFields allowlist={allowlist} />
      <Button type="submit" className="self-start">
        Save settings
      </Button>
    </form>
  );
}

function ModeFields({ mode }: { mode: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-medium">Execution mode</legend>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="executionMode"
          value="approval_required"
          defaultChecked={mode === "approval_required"}
        />
        <span>Approval required: you approve each request before it runs</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="executionMode" value="auto" defaultChecked={mode === "auto"} />
        <span>Auto: valid direct swaps run without you</span>
      </label>
    </fieldset>
  );
}

function TeamFields({ allowlist }: { allowlist: number[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-medium">Automation may act for</legend>
      <p className="text-[color:var(--muted)]">
        No team checked means automation is off: every request comes to you.
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {LEAGUE_TEAM_IDS.map((team) => (
          <label key={team} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="team"
              value={team}
              defaultChecked={allowlist.includes(team)}
            />
            <span>Team {team}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
