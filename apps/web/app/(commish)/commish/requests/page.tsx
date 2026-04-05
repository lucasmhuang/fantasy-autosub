import { redirect } from "next/navigation";
import { Surface } from "../../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession } from "../../../../lib/server/auth";

const requests = [
  {
    team: "Lob City Legends",
    request: "Anthony Davis -> Cam Thomas",
    state: "queued",
  },
  {
    team: "South Bay Variance",
    request: "Paul George -> Walker Kessler",
    state: "pending_review",
  },
] as const;

export default async function CommissionerRequestsPage() {
  const session = await getCurrentAuthenticatedSession();

  if (!session) {
    redirect("/login?redirect=/commish/requests");
  }

  if (session.user.role !== "commissioner") {
    redirect("/app");
  }

  return (
    <main className="page-shell">
      <div className="page-inner">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Commissioner Queue</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
            Requests that need human eyes stay obvious, {session.user.displayName}.
          </h1>
          <div className="mt-8 grid gap-3">
            {requests.map((item) => (
              <div
                key={`${item.team}-${item.request}`}
                className="flex flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-lg font-medium">{item.team}</p>
                  <p className="text-sm text-[color:var(--muted)]">{item.request}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[color:var(--muted)]">
                  {item.state}
                </span>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </main>
  );
}
