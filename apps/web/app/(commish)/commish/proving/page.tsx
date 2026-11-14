import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../components/commish/commish-header";
import { ProvingChoicesPanel } from "../../../../components/commish/proving-choices";
import { ProvingRuns } from "../../../../components/commish/proving-runs";
import { formatReadTime } from "../../../../components/requests/format";
import { RehearsalBar } from "../../../../components/requests/rehearsal-bar";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Surface } from "../../../../components/shell/site-shell";
import { commissionerAccess, getCurrentAuthenticatedSession } from "../../../../lib/server/auth";
import { loadProvingPage, type ProvingPage } from "../../../../lib/server/proving";
import { renderCommissionerStatus } from "../status-messages";

// The proving request on team 1 (S9, S18-S20): file one, approve it, watch its writes, and close
// it, until proving is marked done.
export default async function ProvingRequestsPage(props: {
  searchParams: Promise<{ starter?: string; status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect("/login?redirect=/commish/proving");
  if (access === "not_commissioner") redirect("/app");
  const params = await props.searchParams;
  const starterId = /^\d{1,12}$/.test(params.starter ?? "") ? Number(params.starter) : null;
  const page = await loadProvingPage({ starterId });

  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <CommishHeader title="Proving on team 1" hasTeam={session.user.teamId !== null} />
          <StatusNotice status={renderCommissionerStatus(params.status ?? null)} />
          {page.status === "found" ? (
            <ProvingBody page={page} />
          ) : (
            <p className="mt-6 text-sm text-[color:var(--muted)]">
              The proving page can’t be shown right now. Try again in a moment.
            </p>
          )}
        </Surface>
      </div>
    </main>
  );
}

function ProvingBody({ page }: { page: Extract<ProvingPage, { status: "found" }> }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <RehearsalBar rehearsal={page.rehearsal} />
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">File a proving request</h2>
        {page.choices === null ? (
          <p className="text-sm">
            Proving was marked done{" "}
            {page.provingDoneAt === null ? "" : formatReadTime(page.provingDoneAt.toISOString())}.
            No more proving requests can be filed.
          </p>
        ) : (
          <ProvingChoicesPanel choices={page.choices} />
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Proving requests</h2>
        <ProvingRuns requests={page.requests} />
      </section>
    </div>
  );
}
