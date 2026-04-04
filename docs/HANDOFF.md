# InjurySub — Handoff

**Last Updated:** April 4, 2026
**Purpose:** Allow a fresh Codex session to resume implementation with near-zero ramp-up.

---

## 1. Where To Start

Read these in order:

1. [docs/HANDOFF.md](/home/lucas/dev/fantasy-autosub/docs/HANDOFF.md)
2. [docs/FOUNDATION.md](/home/lucas/dev/fantasy-autosub/docs/FOUNDATION.md)
3. [docs/TDD.md](/home/lucas/dev/fantasy-autosub/docs/TDD.md)
4. [docs/PRD.md](/home/lucas/dev/fantasy-autosub/docs/PRD.md)

This handoff is the operational summary. FOUNDATION is the codebase baseline. TDD and PRD define the system and product behavior.

---

## 2. Current State

### Repo status

At the time of this handoff, the docs are committed, but the new code scaffold is still uncommitted.

Current `git status --short`:

```text
?? .env.example
?? .gitignore
?? apps/
?? drizzle.config.ts
?? package.json
?? packages/
?? playwright.config.ts
?? pnpm-workspace.yaml
?? tsconfig.base.json
?? vitest.config.ts
```

### Node / package manager

- `node --version` observed in-session: `v24.14.0`
- Root `package.json` declares: `packageManager: pnpm@10.15.1`

Important environment note:

- In this Codex sandbox, invoking `pnpm` triggered Corepack to fetch `pnpm` and failed due cache/network restrictions.
- The user indicated `pnpm` should now be installed on the real machine.
- A fresh session should verify `pnpm` locally before assuming install/build commands will work.

### What exists now

The repo has been reorganized into:

- `docs/`
- `apps/web`
- `apps/worker`
- `packages/config`
- `packages/db`
- `packages/domain`
- `packages/email`
- `packages/espn`
- `packages/ui`

This is a scaffold, not a running product yet.

---

## 3. Locked Decisions

These are already decided and should be treated as baseline unless the user explicitly wants to revisit them:

- Use `docs/` for long-form documentation, not repo root.
- Use a `pnpm` workspace monorepo.
- Use `Next.js` App Router for the web runtime.
- Use a separate Node worker runtime from day one.
- Use `PostgreSQL` + `Drizzle`.
- Use custom magic-link auth with a confirmation landing page before token consumption.
- Use a cinematic, dark-first product shell, but keep the actual substitution flow crisp and utilitarian.
- Precompute replacement option states in the UI:
  - `auto_executable`
  - `valid_requires_review`
  - `invalid`
- Bench-point cutoff is tied to when the replacement first leaves the bench and enters the lineup.
- Auto-executable rearrangements must keep the replacement on the bench until the final planned step.

These decisions are reflected in:

- [docs/PRD.md](/home/lucas/dev/fantasy-autosub/docs/PRD.md)
- [docs/TDD.md](/home/lucas/dev/fantasy-autosub/docs/TDD.md)
- [docs/FOUNDATION.md](/home/lucas/dev/fantasy-autosub/docs/FOUNDATION.md)

---

## 4. Scaffolded Files

### Root

- [package.json](/home/lucas/dev/fantasy-autosub/package.json)
- [pnpm-workspace.yaml](/home/lucas/dev/fantasy-autosub/pnpm-workspace.yaml)
- [tsconfig.base.json](/home/lucas/dev/fantasy-autosub/tsconfig.base.json)
- [drizzle.config.ts](/home/lucas/dev/fantasy-autosub/drizzle.config.ts)
- [vitest.config.ts](/home/lucas/dev/fantasy-autosub/vitest.config.ts)
- [playwright.config.ts](/home/lucas/dev/fantasy-autosub/playwright.config.ts)
- [.env.example](/home/lucas/dev/fantasy-autosub/.env.example)
- [.gitignore](/home/lucas/dev/fantasy-autosub/.gitignore)

### Web app

- [apps/web/package.json](/home/lucas/dev/fantasy-autosub/apps/web/package.json)
- [apps/web/next.config.ts](/home/lucas/dev/fantasy-autosub/apps/web/next.config.ts)
- [apps/web/postcss.config.mjs](/home/lucas/dev/fantasy-autosub/apps/web/postcss.config.mjs)
- [apps/web/app/layout.tsx](/home/lucas/dev/fantasy-autosub/apps/web/app/layout.tsx)
- [apps/web/app/globals.css](/home/lucas/dev/fantasy-autosub/apps/web/app/globals.css)
- [apps/web/app/(marketing)/page.tsx](/home/lucas/dev/fantasy-autosub/apps/web/app/(marketing)/page.tsx)
- [apps/web/app/(auth)/login/page.tsx](/home/lucas/dev/fantasy-autosub/apps/web/app/(auth)/login/page.tsx)
- [apps/web/app/(app)/app/page.tsx](/home/lucas/dev/fantasy-autosub/apps/web/app/(app)/app/page.tsx)
- [apps/web/app/(commish)/commish/requests/page.tsx](/home/lucas/dev/fantasy-autosub/apps/web/app/(commish)/commish/requests/page.tsx)
- [apps/web/app/api/health/route.ts](/home/lucas/dev/fantasy-autosub/apps/web/app/api/health/route.ts)
- [apps/web/components/shell/site-shell.tsx](/home/lucas/dev/fantasy-autosub/apps/web/components/shell/site-shell.tsx)

### Worker

- [apps/worker/package.json](/home/lucas/dev/fantasy-autosub/apps/worker/package.json)
- [apps/worker/src/index.ts](/home/lucas/dev/fantasy-autosub/apps/worker/src/index.ts)
- [apps/worker/src/loops/runtime.ts](/home/lucas/dev/fantasy-autosub/apps/worker/src/loops/runtime.ts)

### Shared packages

- Config: [packages/config/src/index.ts](/home/lucas/dev/fantasy-autosub/packages/config/src/index.ts)
- DB schema: [packages/db/src/schema/auth.ts](/home/lucas/dev/fantasy-autosub/packages/db/src/schema/auth.ts), [packages/db/src/schema/substitutions.ts](/home/lucas/dev/fantasy-autosub/packages/db/src/schema/substitutions.ts), [packages/db/src/schema/index.ts](/home/lucas/dev/fantasy-autosub/packages/db/src/schema/index.ts)
- Domain: [packages/domain/src/index.ts](/home/lucas/dev/fantasy-autosub/packages/domain/src/index.ts)
- Domain test: [packages/domain/src/scoring/formula.test.ts](/home/lucas/dev/fantasy-autosub/packages/domain/src/scoring/formula.test.ts)
- ESPN contracts: [packages/espn/src/index.ts](/home/lucas/dev/fantasy-autosub/packages/espn/src/index.ts)
- Email wrapper: [packages/email/src/index.ts](/home/lucas/dev/fantasy-autosub/packages/email/src/index.ts)
- UI primitives: [packages/ui/src/index.ts](/home/lucas/dev/fantasy-autosub/packages/ui/src/index.ts), [packages/ui/src/components/button.tsx](/home/lucas/dev/fantasy-autosub/packages/ui/src/components/button.tsx)

---

## 5. What Is Implemented Versus Placeholder

### Implemented enough to serve as baseline

- Monorepo layout
- Package manifests
- Shared TypeScript base config
- Initial Next.js route structure
- Cinematic visual baseline in CSS
- Basic reusable `Button` and `Surface` shell components
- Initial domain constants:
  - execution modes
  - replacement option statuses
  - scoring formula
- Initial Drizzle schema skeleton for auth, requests, events, and leases
- Worker entrypoint and loop placeholders

### Still placeholder / not functional yet

- Dependency installation has not been run in-session.
- No `pnpm install` has been run in-session.
- No `typecheck`, `build`, `test`, or `dev` command has been successfully run in-session.
- No real DB client or migrations are wired up.
- No real auth/session implementation exists beyond config/constants.
- No real Next API mutations exist yet besides `/api/health`.
- No actual ESPN integration exists yet.
- No real worker queue/lease behavior exists yet.
- No commissioner workflow implementation exists yet.
- No Playwright tests exist yet despite config being scaffolded.

Treat the current state as a shaped skeleton, not a verified application.

---

## 6. Likely First Breakpoints

The next session should assume there may be compile/runtime issues once dependencies are installed. The most likely areas:

- Next.js + Tailwind v4 config compatibility
- cross-workspace TS path resolution / package transpilation
- React 19 typings with the `asChild` helper in the UI package
- Next route-group file resolution after first boot
- Drizzle CLI config path behavior from the workspace root
- `pnpm` availability / Corepack behavior on the local machine

Nothing here looked obviously fatal from static review, but none of it has been verified by install/build.

---

## 7. First Commands For A Fresh Session

Run these first from repo root:

```bash
git status --short
node --version
pnpm --version
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @injurysub/web build
```

Then, if the install/build works:

```bash
pnpm dev:web
pnpm dev:worker
```

If `pnpm` fails because Corepack tries to fetch into a bad cache path, the next session should diagnose package manager setup first before touching app code.

---

## 8. Recommended Immediate Next Goal

The best next vertical slice is:

1. get dependencies installed
2. fix any scaffold compile issues
3. make the web app boot successfully
4. make the worker boot successfully
5. commit the scaffold

Do **not** start ESPN integration before the scaffold is verified to run.

### Concrete next implementation order

After the scaffold is running, implement in this order:

1. Auth/session data model and helpers
2. Drizzle schema cleanup and DB client wiring
3. Login request route
4. Magic-link landing + consume flow
5. Mocked manager dashboard driven by typed server data
6. Real domain models for substitution requests and statuses
7. Worker reconciliation / sweep skeleton with DB reads

That preserves momentum while keeping the product shape visible.

---

## 9. Visual / Product Guidance For The Next Session

Do not let the web app drift into generic utility-dashboard styling.

Maintain:

- dark-first cinematic shell
- large type hierarchy
- restrained but intentional surface layering
- mobile-first spacing
- minimal, high-confidence controls

The visual references the user liked:

- `superwhisper.com`
- `addy-ade.com`

Interpretation to preserve:

- premium product energy
- strong typography
- considered motion
- clean information density

Avoid:

- shadcn-default visual language
- generic admin tables as the app identity
- purple-on-black AI-product defaults
- over-animated confirm flows

---

## 10. Important Product Rules To Preserve

These are easy to accidentally erode during implementation:

- Magic links must land on a confirmation page before consumption.
- Replacement options shown in the UI are advisory until confirmation-time recomputation.
- A substitution can be league-valid but still require commissioner review.
- Auto-executable rearrangements must keep the replacement on the bench until the final step.
- Bench-point cutoff is when the replacement enters the lineup, not when the full reshuffle began.
- Root should stay shallow; long-form design docs stay under `docs/`.

---

## 11. Suggested First Commit Boundary

Once install/build issues are resolved, the next session should create a commit roughly equivalent to:

`chore: scaffold monorepo foundation`

That commit should include:

- workspace config
- app/package layout
- visual shell
- shared package skeleton
- worker skeleton

Do not bundle real auth or DB implementation into that same commit if it can be avoided.

---

## 12. If The Next Session Needs To Reorient Fast

Short summary:

- Docs are settled enough; stop re-litigating architecture.
- The repo now matches the chosen monorepo structure from FOUNDATION.
- The current task is not design anymore; it is validation and hardening of the scaffold.
- First priority is getting `pnpm install`, `typecheck`, `test`, and `build` green.
- Then commit the scaffold.
- Then begin auth + DB as the first real product slice.
