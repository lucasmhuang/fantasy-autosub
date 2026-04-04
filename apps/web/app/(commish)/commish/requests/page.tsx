import { Surface } from "../../../../components/shell/site-shell";

const requests = [
  {
    team: "Lob City Legends",
    request: "Anthony Davis -> Cam Thomas",
    state: "queued"
  },
  {
    team: "South Bay Variance",
    request: "Paul George -> Walker Kessler",
    state: "pending_review"
  }
];

export default function CommissionerRequestsPage() {
  return (
    <main className="page-shell">
      <div className="page-inner">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Commissioner Queue</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
            Requests that need human eyes stay obvious.
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

