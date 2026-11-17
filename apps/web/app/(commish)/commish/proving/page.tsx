import { redirect } from "next/navigation";
import { CommishTitle } from "../../../../components/commish/commish-title";
import { ProvingChoicesPanel } from "../../../../components/commish/proving-choices";
import { ProvingRuns } from "../../../../components/commish/proving-runs";
import { formatReadTime } from "../../../../components/requests/format";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Shell } from "../../../../components/shell/shell";
import { Surface } from "../../../../components/shell/site-shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../lib/server/auth";
import { loadAutomation } from "../../../../lib/server/commish-alerts";
import { loadProvingPage, type ProvingPage } from "../../../../lib/server/proving";
import { loadShell } from "../../../../lib/server/shell";
import { renderCommissionerStatus } from "../status-messages";

// The proving request on team 1 (S9, S18-S20): file one, approve it, watch its writes, and close
// it, until proving is marked done.
export default async function ProvingRequestsPage(props: {
  searchParams: Promise<{ starter?: string; status?: string }>;
}) {
  const params = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    redirect(signInLocation("/commish/proving", { starter: params.starter }));
  }
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);
  const zone = deviceZoneOf(session);
  const starterId = /^\d{1,12}$/.test(params.starter ?? "") ? Number(params.starter) : null;
  const page = await loadProvingPage({ starterId });

  const automation = await loadAutomation();
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="settings">
      <div className="page-shell">
        <div className="page-inner flex flex-col gap-6">
          <Surface className="rounded-[2rem] p-6 sm:p-8">
            <CommishTitle
              title="Proving on team 1"
              automation={automation}
              from="/commish/proving"
              zone={zone}
              now={new Date()}
            />
            <StatusNotice status={renderCommissionerStatus(params.status ?? null)} />
            {page.status === "found" ? (
              <ProvingBody page={page} zone={zone} />
            ) : (
              <p className="mt-6 text-sm text-[color:var(--muted)]">
                The proving page can’t be shown right now. Try again in a moment.
              </p>
            )}
          </Surface>
        </div>
      </div>
    </Shell>
  );
}

function ProvingBody({
  page,
  zone,
}: {
  page: Extract<ProvingPage, { status: "found" }>;
  zone: string;
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">File a proving request</h2>
        {page.choices === null ? (
          <p className="text-sm">
            Proving was marked done{" "}
            {page.provingDoneAt === null
              ? ""
              : formatReadTime(page.provingDoneAt.toISOString(), zone)}
            . No more proving requests can be filed.
          </p>
        ) : (
          <ProvingChoicesPanel choices={page.choices} />
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Proving requests</h2>
        <ProvingRuns requests={page.requests} zone={zone} />
      </section>
    </div>
  );
}
