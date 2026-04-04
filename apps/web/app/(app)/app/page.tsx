import {
  executionModes,
  replacementOptionLabelMap,
  replacementOptionStatuses
} from "@injurysub/domain";
import { Surface } from "../../../components/shell/site-shell";

const mockOptions = [
  {
    player: "Cam Thomas",
    status: "auto_executable",
    detail: "Valid via rearrangement: Cam Thomas -> UTIL, Jalen Williams -> F",
    nextGame: "Wed vs BOS"
  },
  {
    player: "Walker Kessler",
    status: "valid_requires_review",
    detail: "League-valid, but current live roster state needs commissioner review",
    nextGame: "Thu @ DEN"
  },
  {
    player: "Dereck Lively II",
    status: "invalid",
    detail: "No legal lineup arrangement",
    nextGame: "Fri vs PHX"
  }
] as const;

export default function ManagerDashboardPage() {
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Surface className="rounded-[2rem] p-6 sm:p-8">
            <p className="display-kicker">Manager Preview</p>
            <div className="mt-3 flex flex-col gap-3">
              <h1 className="text-4xl font-medium tracking-[-0.04em] sm:text-5xl">
                Anthony Davis is OUT.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
                This page is the first manager dashboard scaffold. The final
                version will hydrate live ESPN data, but the shape already
                reflects the option-status model from the docs.
              </p>
            </div>
          </Surface>

          <Surface className="rounded-[2rem] p-6">
            <p className="display-kicker">Execution Profile</p>
            <div className="mt-5 grid gap-4">
              <div>
                <p className="metric-label">Default Mode</p>
                <p className="metric-value">
                  {executionModes[0].replace("_", "-")}
                </p>
              </div>
              <div>
                <p className="metric-label">Option Statuses</p>
                <p className="text-sm text-[color:var(--muted)]">
                  {replacementOptionStatuses.join(" • ")}
                </p>
              </div>
            </div>
          </Surface>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Surface className="rounded-[2rem] p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="display-kicker">Replacement Options</p>
                <h2 className="mt-2 text-2xl font-medium">Bench evaluation</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[color:var(--muted)]">
                Precomputed
              </span>
            </div>

            <div className="grid gap-3">
              {mockOptions.map((option) => (
                <div
                  key={option.player}
                  className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-medium">{option.player}</h3>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
                        {option.detail}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-3 py-1 text-xs"
                      style={{
                        backgroundColor:
                          option.status === "auto_executable"
                            ? "rgba(136, 228, 159, 0.14)"
                            : option.status === "valid_requires_review"
                              ? "rgba(255, 202, 107, 0.14)"
                              : "rgba(255, 134, 125, 0.14)",
                        color:
                          option.status === "auto_executable"
                            ? "var(--success)"
                            : option.status === "valid_requires_review"
                              ? "var(--warning)"
                              : "var(--danger)"
                      }}
                    >
                      {replacementOptionLabelMap[option.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    {option.nextGame}
                  </p>
                </div>
              ))}
            </div>
          </Surface>

          <Surface className="rounded-[2rem] p-6">
            <p className="display-kicker">Flow Notes</p>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-[color:var(--muted)]">
              <li>Selection UI should keep actionable options first.</li>
              <li>Review-required paths stay visible instead of disappearing.</li>
              <li>Confirmation remains a single decisive action.</li>
            </ul>
          </Surface>
        </section>
      </div>
    </main>
  );
}

