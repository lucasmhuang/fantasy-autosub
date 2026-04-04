# InjurySub — Foundation

**Last Updated:** April 4, 2026
**Status:** Draft
**Related Docs:** InjurySub PRD, InjurySub TDD

---

## 1. Purpose

This document defines the implementation foundation for InjurySub:

- recommended tech stack
- repo structure
- runtime topology
- frontend architecture
- design-system and motion rules
- backend package boundaries
- testing and deployment baseline

The PRD defines what the product does. The TDD defines how the system behaves. This document defines how the codebase should be structured so those requirements can be implemented cleanly.

---

## 2. Product Character

InjurySub should not feel like a generic internal dashboard. It should feel like a polished product demo:

- cinematic shell
- fast, obvious task flow
- dense but clean information
- purposeful motion
- premium visual identity

At the same time, the product handles fairness-sensitive league operations. The core workflow must still feel immediate and trustworthy:

- no ambiguous states
- no decorative delays
- no motion that obscures actionability
- no heavy visual effect on critical form actions

Working principle:

- **Marketing and shell can be expressive**
- **Execution flow must stay surgical**

---

## 3. Design Principles

### 3.1 Cinematic, not noisy

Use large type, strong contrast, layered backgrounds, and a few memorable transitions. Avoid gratuitous animation, clutter, and dashboard boilerplate.

### 3.2 Server-first by default

Prefer server-rendered and server-fetched UI for auth, dashboard data, and commissioner pages. Use client components only where interaction or animation actually needs them.

### 3.3 Durable backend, lightweight infrastructure

The system is small, but correctness matters. Favor a modular monolith with a DB-backed coordinator over a sprawling microservice setup or serverless patchwork.

### 3.4 One design language across marketing and app

Marketing pages can be more dramatic, but they should share typography, surfaces, spacing, and motion DNA with the product app.

### 3.5 Boring where correctness matters

Queueing, leases, request state transitions, auth, and auditability should be conservative and explicit. Novelty belongs in presentation, not in workflow correctness.

---

## 4. Recommended Stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript | Shared types across web, worker, domain, and integration layers. |
| Package Manager | `pnpm` workspaces | Simple monorepo support without extra tool overhead on day one. |
| Web Framework | Next.js App Router | Strong fit for product UI, auth flows, route groups, and server-first rendering. |
| UI Runtime | React | Best ecosystem fit for a polished, animated product UI. |
| Styling | Tailwind CSS + custom CSS-variable tokens | Fast implementation, but with a custom visual system instead of prebuilt dashboard styling. |
| Motion | `motion/react` | High-quality page and component motion without building animation primitives ourselves. |
| Accessible Primitives | Radix UI Primitives | Accessibility and behavior primitives without imposing a generic visual style. |
| Database | PostgreSQL | Best fit for requests, leases, sessions, audit events, and transactional state changes. |
| ORM / Migrations | Drizzle | SQL-forward, explicit, easy to reason about for a small but stateful system. |
| Validation | Zod | Shared request and config validation between apps and packages. |
| Email | Resend or Postmark | Small transactional email footprint, simple API, strong deliverability posture. |
| Auth | Custom magic link + server-side sessions | Product-specific flow; avoids overfitting a generic auth library to a very narrow use case. |
| Worker Runtime | Node.js | Same language and packages as web runtime, easy operational model. |
| Unit / Integration Tests | Vitest | Fast TypeScript-native test runner for domain logic and adapters. |
| Browser / Flow Tests | Playwright | Critical for auth, dashboard, and manager/commissioner flows. |
| Deployment | Render or Railway | Supports persistent web service, worker service, and Postgres without serverless compromises. |

### Recommendation Summary

Use:

- `pnpm` workspace monorepo
- `Next.js` for the web app
- `Node.js` worker process
- `PostgreSQL` + `Drizzle`
- `Tailwind` + CSS tokens
- `motion/react`
- `Radix`
- custom auth/session stack

Do not start with:

- Vercel-only serverless architecture
- Redis or a third queue system
- a generic admin dashboard template
- a large UI kit as the visual foundation
- a headless browser dependency for ESPN automation

---

## 5. Runtime Topology

The recommended v1 topology is a modular monolith with two runtimes:

1. `web`
2. `worker`

Both share the same database and packages.

```text
Manager / Commissioner Browser
            │
            ▼
        Next.js Web App
            │
            ├── PostgreSQL
            ├── Email Provider
            └── ESPN Read/Write APIs

        Node Worker
            │
            ├── PostgreSQL
            ├── Email Provider
            └── ESPN Read/Write APIs
```

### Web Runtime Responsibilities

- marketing pages
- login and magic-link landing
- manager dashboard and history
- commissioner queue and review pages
- authenticated API routes
- synchronous request submission path

### Worker Runtime Responsibilities

- queue promotion
- lease sweeps
- boot-time reconciliation
- delayed-execution preflight
- ESPN execution plan runs
- retry-safe notification fanout

### Why not a single runtime only

The TDD’s lease, queue, and reconciliation model fits poorly if all background execution is forced through request/response handlers. The worker is not a second “system”; it is the durable operational half of the same system.

### Why not microservices

The problem domain is too small to justify service boundaries. Shared domain logic and explicit package boundaries are enough.

---

## 6. Repo Structure

Recommended structure:

```text
.
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (marketing)/
│   │   │   ├── (auth)/
│   │   │   ├── (app)/
│   │   │   ├── (commish)/
│   │   │   └── api/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── public/
│   │   └── styles/
│   └── worker/
│       └── src/
├── packages/
│   ├── config/
│   ├── db/
│   ├── domain/
│   ├── email/
│   ├── espn/
│   └── ui/
├── docs/
│   ├── PRD.md
│   ├── TDD.md
│   ├── FOUNDATION.md
│   └── adr/
└── package.json
```

### Package Responsibilities

`packages/config`

- environment parsing
- shared config types
- runtime feature flags

`packages/db`

- Drizzle schema
- migrations
- query helpers
- transaction helpers

`packages/domain`

- auth/session logic
- substitution request lifecycle
- lineup resolution
- scoring rules
- lease/queue orchestration
- audit event creation

`packages/espn`

- read adapter
- write adapter
- step planner
- verification logic
- payload normalization

`packages/email`

- email client wrapper
- template rendering
- sign-in and receipt messages

`packages/ui`

- design tokens
- primitive wrappers
- shared app components
- motion patterns

### Why packages matter here

The domain rules should not live directly inside Next route handlers. That makes testing harder and leaks workflow logic into UI code. Package boundaries let us keep the product polished without coupling correctness logic to rendering.

---

## 7. Frontend Architecture

## 7.1 Route Groups

Recommended route groups in `apps/web/app`:

- `(marketing)` for homepage and explanatory pages
- `(auth)` for login, magic-link landing, and sign-out states
- `(app)` for manager dashboard and request history
- `(commish)` for commissioner review UI
- `api` for authenticated mutation endpoints and worker-safe control routes if needed

### Rule

Do not mix cinematic marketing concerns with the task UI in the same layout tree. Share tokens and components, but keep their shells separate.

## 7.2 Rendering Model

Default to Server Components for:

- route layouts
- page shells
- initial dashboard data loads
- commissioner list/detail pages
- history pages

Use Client Components for:

- animated transitions
- optimistic UI on confirm
- interactive filtering or reveal controls
- toasts and ephemeral status display
- any gesture-driven or layout-animated elements

### Rule

Server by default, client where necessary. Do not make whole pages client-side just to animate one card.

## 7.3 Data Flow

Recommended UI data pattern:

1. Server-render the initial route with current user/session and dashboard data.
2. Precompute replacement options on the server.
3. Hydrate only the interaction layer needed to select, confirm, and display status transitions.
4. Revalidate everything on submit using server-side domain services.

### Why

This keeps first load fast and trustworthy while still allowing the polished motion layer you want.

---

## 8. Design System Baseline

The app needs a real visual system from the start. Do not wait until “later” and then try to skin a utility dashboard.

## 8.1 Typography

Use at least two roles:

- a display face for hero text, section breaks, and cinematic emphasis
- a text/UI face for controls, dense information, and tables

Recommended starting pair:

- UI text: `Manrope`
- Display accent: `Instrument Serif`

Implementation:

- self-host with `next/font`
- define tokenized font roles instead of referencing raw font names in components

Example roles:

- `--font-text`
- `--font-display`
- `--font-mono`

## 8.2 Color and Surfaces

Base direction:

- dark-first product shell
- warm neutral surfaces, not flat black
- one sharp accent color used sparingly for action and status
- high-contrast typography
- layered background treatment, not plain solid fills

Use CSS variables for:

- background layers
- panel surface
- elevated surface
- text primary / secondary / muted
- accent
- success / warning / danger
- borders and hairlines
- shadows and glow levels

### Rule

Do not use Tailwind defaults as the visual identity. Tailwind classes can reference tokens, but the tokens define the system.

## 8.3 Layout Language

The visual tone should be:

- bold headlines
- generous spacing at the shell level
- tight spacing inside data cards
- clear surface hierarchy
- obvious focal point per screen

Manager flow layout:

- hero/status strip
- injured-player selection
- replacement options
- confirmation summary
- outcome state

Commissioner flow layout:

- calmer and denser than the manager experience
- same typography and token system
- less theatrical motion

## 8.4 Motion

Motion should communicate:

- page entry
- selection change
- request submission
- queue/execution progress
- success/fallback outcome

Motion should not:

- slow down the confirm flow
- hide loading uncertainty
- block controls unnecessarily
- produce layout instability on mobile

Recommended baseline rules:

- page transitions: subtle fade + translate
- list state changes: spring layout motion
- confirmation: short, high-confidence transition
- success state: stronger reveal than the rest of the app
- reduce all motion significantly under `prefers-reduced-motion`

Target feel:

- precise
- crisp
- cinematic
- not playful

## 8.5 Component Strategy

Use Radix primitives only for behavior and accessibility:

- dialogs
- popovers
- switches
- tooltips
- tabs if needed

Do not adopt the default look of a component kit. Build your own component layer in `packages/ui`.

Component tiers:

1. tokens
2. primitive wrappers
3. reusable patterns
4. route-specific compositions

---

## 9. Backend and Domain Architecture

## 9.1 Domain-First Services

The key workflow logic should live in `packages/domain`, not in:

- Next route files
- React components
- one-off worker scripts

Core services:

- `auth`
- `sessions`
- `substitutionRequests`
- `lineupResolution`
- `executionPlanning`
- `scoreCalculation`
- `leaseCoordinator`
- `auditLog`

## 9.2 Database as Operational Backbone

Use PostgreSQL as the only durable coordination layer in v1:

- sessions
- login tokens
- substitution requests
- request snapshots
- events
- execution leases
- matchup adjustment ledger

Do not add Redis unless the DB-backed model proves insufficient. It probably will not at this scale.

## 9.3 ESPN Adapter Boundary

All ESPN behavior should be isolated behind `packages/espn`.

Submodules:

- `readClient`
- `writeClient`
- `planner`
- `verification`
- `normalizers`

The rest of the system should not construct raw ESPN payloads directly.

## 9.4 Worker Model

The worker should run a small set of explicit loops:

- queue promotion loop
- lease expiry loop
- startup reconciliation
- delayed request executor
- notification dispatch

### Rule

Prefer explicit polling and idempotent handlers over a complex event bus. At this scale, clarity wins.

---

## 10. Auth and Security Baseline

Auth model:

- email request form
- magic-link landing page
- explicit consume action
- opaque server-side session cookie

Security baseline:

- `Secure`, `HttpOnly`, `SameSite=Lax` cookies
- CSRF protection on cookie-authenticated mutations
- rate limit sign-in requests
- encrypted ESPN credentials at rest
- audit all commissioner and automation actions

### Rule

The auth layer is intentionally custom because the product flow is narrow and scanner-safe link handling is a first-class requirement.

---

## 11. Testing Baseline

## 11.1 Unit Tests

Use Vitest for:

- lineup solver
- execution planner
- score calculation
- auth token/session logic
- lease behavior
- reconciliation behavior

## 11.2 Integration Tests

Use Vitest plus test DB containers or an isolated Postgres instance for:

- request lifecycle transitions
- worker preflight behavior
- ledger updates
- fallback and stale paths

## 11.3 End-to-End Tests

Use Playwright for:

- sign-in flow
- dashboard selection and confirm flow
- commissioner review actions
- history pages
- reduced-motion rendering sanity checks

## 11.4 Visual Confidence

Add screenshot coverage for:

- marketing landing
- manager dashboard
- confirmation screen
- success / fallback state

This matters because visual quality is a real product goal here, not a nice-to-have.

---

## 12. Deployment Baseline

Recommended v1 deployment:

- `web` as a persistent Node web service
- `worker` as a separate background worker service
- managed Postgres
- transactional email provider

### Default Hosting Recommendation

Use a platform that supports both a long-lived web service and a worker service cleanly. Render and Railway both fit this shape. Do not optimize for serverless deployment in v1.

### Why not Vercel-first

The product is not primarily a marketing site. It is an operational system with:

- queue promotion
- lease sweeping
- restart reconciliation
- long-lived execution behavior

Forcing that into serverless adds complexity in exactly the wrong place.

---

## 13. Developer Experience Baseline

Use:

- `pnpm` workspaces
- shared TypeScript config
- path aliases only where they stay obvious
- environment parsing in one package
- a single command to run web + worker locally

Recommended local DX commands:

- `pnpm dev:web`
- `pnpm dev:worker`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm db:migrate`

Keep the root scripts thin and predictable.

---

## 14. Initial Build Sequence

Recommended implementation order:

1. Monorepo scaffold with `apps/web`, `apps/worker`, and shared packages.
2. Postgres + Drizzle schema setup.
3. Custom auth and session flow.
4. Design tokens, font system, and shell layouts.
5. Manager dashboard skeleton with mocked data.
6. Domain package for substitution lifecycle and scoring.
7. ESPN read adapter.
8. Replacement option precomputation and UI rendering.
9. Worker loops and lease coordinator.
10. ESPN write adapter and verification.
11. Commissioner workflow.
12. polish pass on motion, visual refinement, and end-to-end testing.

This order gives you visible product progress early without skipping the durable backend pieces.

---

## 15. ADR Candidates

The following decisions should become ADRs once implementation begins:

1. Use Next.js App Router for the web runtime.
2. Use PostgreSQL + Drizzle as the operational data layer.
3. Separate `web` and `worker` runtimes within one monorepo.
4. Use custom magic-link auth with explicit consume step.
5. Use a cinematic dark-first design system with shared tokens across marketing and app surfaces.

---

## 16. Non-Goals for v1

Do not spend early time on:

- native mobile apps
- push notifications
- public API surface
- multi-league tenancy
- generic admin tooling
- shader-heavy rendering in critical product routes
- design-system over-abstraction before the first real screens exist

The goal is a polished, reliable v1 product, not a framework.
