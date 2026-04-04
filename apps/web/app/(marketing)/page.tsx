import { scoringWeights } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import { SiteHeader, Surface } from "../../components/shell/site-shell";

const pillars = [
  {
    title: "Immediate clarity",
    body: "Managers see every valid replacement path before they commit, with the automation boundary made explicit.",
  },
  {
    title: "Operational confidence",
    body: "Queueing, verification, and audit trails are part of the product from day one, not rescue work later.",
  },
  {
    title: "Premium presentation",
    body: "The shell is cinematic, but every critical decision remains obvious on a phone in the middle of a game.",
  },
];

const formula = Object.entries(scoringWeights).map(([stat, weight]) => ({
  stat,
  weight,
}));

export default function MarketingPage() {
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-8">
        <SiteHeader />

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <Surface className="rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-col gap-6">
              <p className="display-kicker">Fantasy Basketball Workflow</p>
              <h1 className="display-title text-5xl sm:text-7xl lg:text-[6rem]">
                Injury subs that feel like a product, not a patch.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[color:var(--muted)] sm:text-lg">
                InjurySub turns a league rule into a polished manager experience: precomputed
                replacement paths, safe execution boundaries, and a commissioner workflow that only
                appears when it should.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/login">Open Sign-In Flow</Link>
              </Button>
              <Button asChild intent="ghost" size="lg">
                <Link href="/app">Preview Manager Dashboard</Link>
              </Button>
            </div>
          </Surface>

          <Surface className="rounded-[2rem] p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="display-kicker">Scoring Profile</p>
                <h2 className="mt-2 text-2xl font-medium">League Formula</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[color:var(--muted)]">
                H2H points
              </span>
            </div>
            <div className="grid gap-3">
              {formula.map((entry) => (
                <div
                  key={entry.stat}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/10 px-4 py-3"
                >
                  <span className="metric-label">{entry.stat}</span>
                  <span className="text-sm font-medium sm:text-base">
                    {entry.weight >= 0 ? "+" : ""}
                    {entry.weight.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </Surface>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {pillars.map((pillar) => (
            <Surface key={pillar.title} className="rounded-[1.75rem] p-6">
              <p className="display-kicker mb-3">Foundation</p>
              <h2 className="mb-3 text-2xl font-medium">{pillar.title}</h2>
              <p className="text-sm leading-7 text-[color:var(--muted)]">{pillar.body}</p>
            </Surface>
          ))}
        </section>
      </div>
    </main>
  );
}
