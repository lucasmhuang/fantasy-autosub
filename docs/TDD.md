# InjurySub — Technical Design Document

**Last Updated:** April 3, 2026
**Status:** Draft
**Companion to:** InjurySub PRD
**Implementation Foundation:** InjurySub FOUNDATION

> This document contains implementation-specific guidance and is expected to evolve during development. The PRD is the authoritative source for product requirements and business rules. FOUNDATION defines the stack, repo structure, and implementation baseline around this system design.

---

## 1. Architecture Overview

The web-first system has five logical parts: an **email delivery adapter** for sign-in and notifications, a **manager web flow** for submitting requests, a **commissioner oversight flow** for approval/fallback handling, an **execution coordinator** that serializes ESPN mutations per team/matchup, and an **ESPN data adapter** shared by all authenticated request handlers.

```text
Manager's Phone / Browser                     Commissioner's Browser
    │                                               │
    │ visit app domain                              │ visit app domain
    ▼                                               ▼
┌──────────────────────┐                    ┌────────────────────────┐
│ Login / Dashboard     │                    │ Commissioner Review     │
│                      │                    │ Pages / API             │
│ 1. request magic link│                    │                         │
│ 2. receive session   │                    │  GET  /commish/requests │
│ 3. submit sub        │                    │  POST decision/executed │
└───────────┬──────────┘                    │  POST reverse           │
            │                               └────────────┬───────────┘
            │ shares ESPN adapter, auth, and data store              │
┌───────────▼─────────────────────────────────────────────────────────▼─────────┐
│ Web Application                                                                  │
│                                                                                  │
│  POST /auth/request-link   -> send magic link email                              │
│  GET  /auth/magic/:token   -> render sign-in confirmation                        │
│  POST /auth/magic/:token/consume -> create session + redirect                    │
│  GET  /app                 -> load dashboard                                     │
│  POST /requests            -> validate request, compute preview, execute or queue │
└───────────┬──────────────────────────────────────────────────────────────────────┘
            │
   ┌────────┼──────────────────────────────┬───────────────────────────────┐
   │        │                              │                               │
┌──▼───┐ ┌──▼──────────┐               ┌───▼──────────┐                ┌───▼────────────┐
│ ESPN │ │ Data Store   │               │ Email Service │                │ Execution       │
│ Read │ │              │               │ / SMTP        │                │ Coordinator     │
│ API  │ │ • users      │               │               │                │ + ESPN Writes   │
│      │ │ • sessions   │               │               │                │                 │
│      │ │ • requests   │               │               │                │                 │
│      │ │ • events     │               │               │                │                 │
│      │ │ • snapshots  │               │               │                │                 │
│      │ │ • leases     │               │               │                │                 │
└──────┘ └──────────────┘               └───────────────┘                └────────────────┘
```

### Why this is simple

There is no Twilio dependency, no inbound webhook, and no separate trigger channel. For v1, the system runs as one small persistent web process backed by a data store. Auto-execution can still begin from synchronous HTTP handlers, but ESPN mutations are serialized through a DB-backed execution lease per team/matchup. The persistent workflow state is authenticated sessions plus the request lifecycle stored in the data store (`queued/executing/pending_review/stale_requires_review -> executed/fallback_required/rejected/reversed`).

---

## 2. Authentication and Email Delivery

### Setup

- Provision an outbound email provider (for example Resend, Postmark, SES, or equivalent SMTP).
- Configure a sender identity such as `noreply@injurysub.app`.
- Pre-register each manager's email address to their ESPN team before the season.
- Pre-register the commissioner's email as the admin account.

### Sign-in flow

The manager visits the site and enters their email address.

The handler:
1. Normalizes the email address and looks it up in the email-to-team mapping.
2. If found, creates a short-lived one-time login token.
3. Sends a magic-link email.
4. When the link is opened, renders a short confirmation page.
5. When the manager explicitly submits that confirmation, validates the token, creates a persistent session, and redirects to the app.

For unauthenticated recovery, this same sign-in page is the self-service recovery flow. No commissioner intervention is required as long as the user still controls the registered email inbox.

### Delivery behavior

- Sign-in emails should arrive quickly and use a short, plain subject like `Sign in to InjurySub`.
- The sign-in request response should be generic enough to avoid obvious account enumeration if desired. In a private 12-team league, explicit "email not recognized" feedback is also acceptable if preferred.
- Magic links must not be consumed on `GET`. The landing page should require an explicit tap so mail scanners and link prefetchers do not burn a single-use token.
- Request receipts and commissioner notifications can use the same provider.

### Cost estimate

Email volume is tiny. Typical transactional email providers will be effectively free or only a few dollars per month at this scale. Removing Twilio also removes the recurring phone-number cost and per-message SMS charges.

---

## 3. Auth Tokens and Sessions

Authentication now has two layers:

- a short-lived **magic login token** sent by email
- a long-lived **session cookie** stored on the authenticated device/browser

### Magic login token properties

- Cryptographically random string.
- Single-use.
- Short TTL (recommended: 15 minutes).
- Associated with one user account and optional post-login redirect path.
- Consumed only by an explicit confirmation POST, never by the landing-page GET alone.

### Session properties

- Opaque random session ID stored server-side.
- Sent to the browser as a secure, `HttpOnly` cookie.
- Rolling expiration (recommended: 90 days for active users).
- Revocable by deleting the server-side session row.

### Launch assumption

Once signed in, managers can submit multiple requests across the season from the same device without reauth unless the session expires or browser data is cleared. If a manager loses access, they can request a new magic link themselves.

### URL structure

```text
https://{app-domain}/login
https://{app-domain}/auth/magic/{token}
https://{app-domain}/auth/magic/{token}/consume
https://{app-domain}/app
https://{app-domain}/history
https://{app-domain}/commish/requests
```

### Security

- Magic links are only the bootstrap credential for creating a session.
- Application authorization is session-based, not bearer-link based.
- The session determines the acting user, team scope, and role on every request.
- The magic-link landing route must not consume the token on `GET`.
- Expired or used magic links return a friendly error page that directs the user to request a fresh sign-in link.

---

## 4. Web Application

### Routes

| Route | Method | Purpose |
|---|---|---|
| `GET /login` | GET | Render the sign-in page. |
| `POST /auth/request-link` | POST | Accept an email address and send a magic sign-in link if the user is eligible. |
| `GET /auth/magic/:token` | GET | Render a short confirmation page for a still-valid magic link without consuming it. |
| `POST /auth/magic/:token/consume` | POST | Validate and consume the token, create a session, and redirect to the app. |
| `POST /logout` | POST | Clear the current session. |
| `GET /app` | GET | Load the manager dashboard for the authenticated team. |
| `POST /requests` | POST | Receive the manager's selection (injured player ID, replacement player ID, idempotency key). Re-validate against live ESPN data, resolve the requested lineup intent, compute the submission-time preview adjustment, create or return the existing request for that idempotency key, and then either acquire the execution lease and auto-execute immediately, place the request in `queued`, or queue for commissioner review depending on execution mode. |
| `GET /history` | GET | Show the authenticated manager's substitution history for the current season. |
| `GET /commish/requests` | GET | Commissioner inbox listing open and recent requests. |
| `GET /commish/requests/:requestId` | GET | Show one request with roster snapshot, resolved lineup, planned remaining ESPN steps, score breakdown, and action controls. |
| `POST /commish/requests/:requestId/decision` | POST | Approve, reject, or approve with override when the league is in approval-required mode or a stale/fallback request needs commissioner resolution. An approval that resumes automation must first run a delayed-execution preflight, then either acquire the execution lease and proceed, place the request in `queued`, or return it to commissioner review if the request is stale. Stores commissioner note and emits audit event. |
| `POST /commish/requests/:requestId/executed` | POST | Mark manual ESPN completion after fallback handling, capture or correct `roster_effective_at` for when the replacement actually entered the lineup, recompute the final adjustment delta, update the matchup ledger, and notify the manager. |
| `POST /commish/requests/:requestId/reverse` | POST | Reverse a processed substitution, update the matchup ledger to remove that request's delta, and record audit events. |

### Frontend

The manager application can be a single-page app or a server-rendered app with minimal JS. The key product behavior is that a returning user normally lands directly on their dashboard because their session cookie is still valid.

The manager experience has five states:
1. **Signed out** — enter email to receive a magic link.
2. **Magic-link landing** — confirm sign-in from the email link and consume the token.
3. **Dashboard / Selection** — display injured player(s), precomputed replacement options, and request history.
4. **Confirmation** — display summary of the substitution, resolved lineup arrangement, current score preview, and any pending bench-period risk.
5. **Queued / Executing / Done** — display either brief queueing behind another request for that team, live execution status, final success, or fallback-required status.

On `GET /app`, the server should precompute every `(injured starter, bench player)` pair and classify it as:

- `auto_executable`
- `valid_requires_review`
- `invalid`

The UI should show `auto_executable` options first, then `valid_requires_review`, and keep `invalid` options visible but disabled behind the same injured-player context. `POST /requests` must recompute from live state and must not trust this precomputed classification.

The commissioner oversight pages can stay intentionally simple in v1. A basic queue and request detail page are enough. The required actions are:

1. Review the request, including validation snapshot and lineup resolution.
2. Approve, reject with reason, or set an override adjustment when review mode is enabled.
3. Resolve fallback requests and, if manual ESPN steps were required, mark them executed with a confirmed `roster_effective_at` for when the replacement entered the lineup.
4. Reverse a processed request if needed.

The manager page only needs a single mutating call on confirmation. Commissioner pages use one POST per action.

### Submission and execution lifecycle

1. Authenticated manager opens the dashboard and selects a replacement.
2. Server checks the idempotency key and duplicate-request policy, then creates `SubstitutionRequest`, stores a preview adjustment and immutable submission snapshot, and selects an execution path based on league configuration.
3. In `auto_execute` mode, the server attempts to acquire the `(team_id, matchup_period_id)` execution lease.
4. If the lease is already held by another request for that team/week, the new request moves to `queued` until it reaches the front of the line.
5. When a request is ready to execute, the server runs a delayed-execution preflight against live ESPN state, regenerates a fresh roster execution plan from current state, and confirms the stored intent is still safe to execute.
6. If preflight succeeds, the server immediately attempts the ESPN roster execution plan and then the score-adjustment write.
7. If both writes succeed and verify cleanly, the request moves to `executed` and the manager sees the final result immediately.
8. If the league is in `approval_required` mode, the request moves to `pending_review` until the commissioner approves or rejects it. Approval returns the request to the same preflight + lease flow before any ESPN write.
9. If any automated write or verification step fails, if the rearrangement cannot be decomposed into a safe sequence of ESPN swaps/moves, if the request expires before execution, or if timing ambiguity / adjustment drift / stale-state detection makes automation unsafe, the request moves to `fallback_required` or `stale_requires_review` and the commissioner receives the exact details needed to finish it.
10. If the commissioner completes the request manually after fallback, the authoritative final adjustment is recomputed and stored when they mark it executed.

The important distinction is that **submission time** and **execution time** are still separate events in the data model. In the default auto-execute path they are usually only seconds apart, but queueing, fallback, and approval-required modes can still separate them materially.

### Execution serialization

Only one request may perform ESPN mutations for a given `(team_id, matchup_period_id)` at a time.

Implementation rules:

1. Back the execution lock with a DB row or lease record, not an in-memory mutex.
2. Acquire the lease before any automated ESPN write.
3. Give the lease a short TTL with heartbeat/refresh while a request is actively executing.
4. Release the lease on every terminal transition and after every detected failure path.
5. If a request cannot acquire the lease immediately, move it to `queued` rather than failing validation.
6. When a request releases the lease, the same process should immediately attempt to promote the oldest queued request for that `(team_id, matchup_period_id)`.
7. A small in-process sweeper should also scan every few seconds for queued work and expired leases so promotion does not depend on a specific request path staying alive.
8. On process start, run a reconciliation pass for requests left in `executing` or `queued`, inspect expired leases, reread live ESPN state, and either resume safely or route the request to commissioner review.
9. When a queued request later acquires the lease, it must rerun delayed-execution preflight before any write.
10. Ledger updates for a matchup/team should occur in the same DB transaction that finalizes request state after verified execution.

### Data the page needs (fetched on `GET /app`)

```json
{
  "currentUser": {
    "managerName": "Marcus",
    "teamName": "Lob City Legends",
    "role": "manager"
  },
  "matchupWeek": 14,
  "sessionExpiresAt": "2026-07-01T06:00:00Z",
  "injuredPlayers": [
    {
      "playerId": 3945274,
      "name": "Anthony Davis",
      "team": "LAL",
      "position": "PF",
      "slot": "F",
      "slotId": 6,
      "status": "OUT",
      "injuryDetail": "Knee",
      "ptsThisWeek": 34.2,
      "gamesPlayed": 1,
      "replacementOptions": [
        {
          "playerId": 4432573,
          "playerName": "Cam Thomas",
          "status": "auto_executable",
          "statusLabel": "Ready now",
          "reason": "Valid via rearrangement: Cam Thomas -> UTIL, Jalen Williams -> F",
          "executionStrategy": "sequential_plan",
          "previewAdjustment": -34.2,
          "warningFlags": [],
          "resolvedLineup": [
            { "slot": "G", "playerId": 4017843, "playerName": "Jrue Holiday" },
            { "slot": "F", "playerId": 4431157, "playerName": "Jalen Williams" },
            { "slot": "UTIL", "playerId": 4432573, "playerName": "Cam Thomas" }
          ]
        },
        {
          "playerId": 5550001,
          "playerName": "Walker Kessler",
          "status": "valid_requires_review",
          "statusLabel": "Commissioner review",
          "reason": "League-valid lineup, but no safe verified ESPN step sequence from current live state",
          "executionStrategy": "manual_review",
          "previewAdjustment": -34.2,
          "warningFlags": ["zero_games_remaining"]
        },
        {
          "playerId": 5550002,
          "playerName": "Dereck Lively II",
          "status": "invalid",
          "statusLabel": "Not valid",
          "reason": "No legal lineup arrangement"
        }
      ],
      "statLines": [
        {
          "date": "2026-01-13",
          "opponent": "vs GSW",
          "pts": 24, "reb": 11, "ast": 2, "stl": 1, "blk": 2, "to": 3,
          "fantasyPts": 34.2
        }
      ]
    }
  ],
  "benchPlayers": [
    {
      "playerId": 4432573,
      "name": "Cam Thomas",
      "team": "BKN",
      "position": "SG",
      "gamesRemaining": 2,
      "nextGame": "Wed vs BOS",
      "benchPtsThisWeek": 0,
      "benchPtsAlreadyForfeitedAtLoad": 0,
      "avgFantasyPts": 28.4
    }
  ],
  "recentRequests": [
    {
      "requestId": "req_123",
      "status": "executed",
      "submittedAt": "2026-01-14T02:14:00Z",
      "replacementPlayerName": "Cam Thomas"
    }
  ]
}
```

### Confirmation POST payload

```json
{
  "injuredPlayerId": 3945274,
  "replacementPlayerId": 4432573,
  "idempotencyKey": "0d4df53b-15fd-494a-87f9-7194c0c7b7d1"
}
```

The server re-validates everything from scratch on this POST (see PRD §8.4). It does not trust the client-side data.
The server also uses `idempotencyKey` to collapse repeated taps, refresh retries, and duplicate network submissions into a single logical request.

---

## 5. ESPN Data Integration (Read)

### Authentication

Requires `espn_s2` and `SWID` cookies from the commissioner's ESPN session. Store encrypted. Send as cookies with every API request. Detect expiration by checking for non-200 responses or empty data, and alert the commissioner.

### Base URL

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{year}/segments/0/leagues/{league_id}
```

Note: ESPN may use `fba` or `flb` for basketball. Test during development.

### Key views

| Data Needed | View Parameter | Notes |
|---|---|---|
| Rosters with lineup slots | `?view=mRoster&scoringPeriodId={n}` | `lineupSlotId` and `playerPoolEntry` with injury status and stats. |
| Matchup scores | `?view=mMatchup&view=mMatchupScore` | Matchup pairings and scoring periods. |
| Player stats per game | Nested within mRoster/mMatchup | Stats in `playerPoolEntry.player.stats` array. |
| League settings | `?view=mSettings` | Scoring weights, roster slot config. Use to validate rather than hardcode. |

### Player injury status

`playerPoolEntry.player.injuryStatus` — values: `ACTIVE`, `DAY_TO_DAY`, `OUT`, `SUSPENSION`.

### Lineup slot IDs

Derive from `mSettings` response. Commonly observed basketball slot IDs:

| Slot ID | Position |
|---|---|
| 0 | PG |
| 1 | SG |
| 2 | SF |
| 3 | PF |
| 4 | C |
| 5 | G (PG/SG) |
| 6 | F (SF/PF) |
| 9 | PF/C |
| 10 | F/C (SF/PF/C) |
| 11 | UTIL |
| 12 | Bench |
| 13 | IR |

**Verify against actual league data.**

### Lineup resolution and eligibility

Eligibility cannot be modeled as a direct slot check only. The PRD allows any valid rearrangement of current starters plus the replacement player.

Because v1 serves one fixed league, the product may hardcode the league's starter shape and slot-compatibility rules (`3 G, 3 F, 1 C, 1 F/C, 2 UTIL`) for simplicity. Still read `mSettings` during startup or health checks and fail loudly if the live league configuration drifts from that assumption.

Resolve lineup validity as follows:

1. Start from the current locked starter set for the team.
2. Remove the injured starter from the set.
3. Add the candidate bench replacement.
4. Build the starter slot list from `mSettings`, excluding bench and IR.
5. For each player in the candidate set, derive the slots they may legally occupy from ESPN positional eligibility plus league slot rules.
6. Run a depth-first search or bipartite matching solver that assigns every starter to exactly one slot.
7. Sort slots by fewest eligible players first to keep the search small.
8. Prefer the lowest-movement solution:
   - direct swap into the vacated slot
   - one starter move
   - any other valid arrangement
9. If no assignment exists, mark the replacement ineligible and store the reason shown to the manager.

The league only has 10 starter slots, so exhaustive backtracking is acceptable and easier to reason about than a clever heuristic.

### Lineup resolution output

For every `(injuredPlayerId, replacementPlayerId)` pair, the server should return and later persist:

- the option status (`auto_executable`, `valid_requires_review`, or `invalid`)
- the resolved slot assignment for all starters when the pair is league-valid
- whether the solution was direct or required rearrangement
- the planned execution strategy (`direct_swap`, `sequential_plan`, or `manual_review`)
- a short explanation string for the UI and commissioner review page
- a preview adjustment and any warning flags needed by the dashboard
- when auto-executable, an ordered sequence of single ESPN swap/move actions that realizes the target lineup

This stored lineup plan is the plan the system should execute automatically in the normal path. If fallback is required, it is also the plan the commissioner should execute manually.

`GET /app` should precompute these option records up front for the manager dashboard. `POST /requests` must recompute them from live ESPN state before creating or reusing a request row.

Preseason replay has already confirmed that ESPN accepts the one-step roster transaction primitive the planner depends on. For ESPN, a swap is encoded as two `items` in one request. Rearrangement automation should therefore be treated as a step-planning problem that derives a sequence of single-step transactions from the live roster state rather than one large transaction.

Launch policy:

- direct swaps and rearrangements are both part of the normal launch path
- a candidate is auto-executable when the planner can derive a deterministic sequence of ESPN-legal one-step moves/swaps from the current verified roster state
- if no such sequence exists, the request is still league-valid but routes to commissioner review

If the target lineup cannot be decomposed into a safe sequence of single ESPN swaps/moves from the current roster state, the request should still validate as league-legal but route to commissioner review instead of auto-executing.

### Roster execution planning

Auto-execution needs a second layer after lineup resolution: convert the target lineup into an ordered list of ESPN-legal roster actions.

At launch, the planner should first classify the request as `direct_swap`, `sequential_plan`, or `manual_review`. Only the first two classes proceed to automatic execution.

Planner rules:

1. Input is the current verified roster state plus the final `lineup_resolution`.
2. Each planned ESPN request must be either:
   - a move into an empty slot, or
   - a swap between exactly two occupied slots
3. After each planned step, the resulting intermediate roster state should match what ESPN is expected to accept next.
4. The replacement player must remain on the bench until the final planned step so bench-point cutoff timing and completed substitution timing stay aligned.
5. Prefer the shortest valid step sequence.
6. Prefer sequences that keep the injured player as the "buffer" piece when reshuffling other starters before moving that player to bench.
7. If no safe sequence can be derived while preserving the final-step replacement invariant, mark the request non-auto-executable and route to commissioner review.

### Delayed-execution preflight

Any request that does not write to ESPN immediately after submission must run a fresh preflight before automation starts.

Preflight rules:

1. Re-read live roster, matchup, and current ledger state.
2. Confirm the request has not expired (recommended TTL: 12 hours from submission).
3. Preserve submission-time business validity as an immutable snapshot; preflight does not re-decide whether the original request was valid at submission time.
4. Recompute the lineup resolution and build a new `roster_execution_plan` from the current roster state.
5. Confirm the original intent can still be realized safely from the current state.
6. If the request is now stale, unplannable, or inconsistent with current ledger state, transition to `stale_requires_review` instead of forcing the old plan.
7. Persist an immutable preflight snapshot for auditability before any resumed automation attempt.

### Matchup period and time boundaries

The adapter should normalize the following timestamps for every request:

- `submitted_at`: when the manager confirms the request
- `roster_write_sent_at`: when the final required roster-step request is sent
- `roster_write_response_at`: when the final required roster-step response is received
- `espn_transaction_proposed_at`: ESPN's `proposedDate` timestamp when present
- `roster_verified_at`: when a post-write roster read first confirms the full target lineup
- `roster_effective_at`: when the replacement player first leaves the bench and enters a starting slot in ESPN. For auto-executable plans, the planner intentionally makes this the final roster step.
- `score_adjustment_written_at`: when the matchup-adjustment write is confirmed in ESPN
- `workflow_completed_at`: when the request lifecycle is finished in InjurySub
- `matchup_period_end_at`: when the scoring period closes

Roster-write success is defined by explicit post-write readback verification, not by the write response body alone.

Bench-point deductions are keyed to `roster_effective_at`, defined above as the moment the replacement first enters the lineup. Duplicate prevention is keyed to request status plus an idempotency key, not to timestamps alone.

### Stat IDs

| Stat | Likely ESPN ID | Multiplier |
|---|---|---|
| PTS | 0 | × 1.0 |
| BLK | 1 | × 3.0 |
| STL | 2 | × 3.0 |
| AST | 3 | × 1.5 |
| REB | 6 | × 1.2 |
| TO | 11 | × −1.0 |

**Verify by cross-referencing a known player's API stats with their actual box score.**

### NBA schedule and canonical game timing

```
https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
```

Unauthenticated. Build a matchup-week game index in UTC from the scoreboard data and use it for:

- games remaining / next game display in the UI
- authoritative game-start timestamps for bench-point cutoff math
- stat-line to game mapping when deciding whether a replacement player's points count

If a request lands within a configurable ambiguity window near a relevant tipoff, or a stat line cannot be mapped cleanly to a single scheduled game, route the request to commissioner review rather than guessing.

### Adapter pattern

Isolate all ESPN API calls behind a clean interface. When ESPN changes endpoints, payloads, or cookie formats, only the adapter needs updating.

---

## 6. Score Adjustment Calculation

The system stores two per-request calculations: a **submission-time preview** shown before execution and an **execution-time final adjustment** that becomes the authoritative audit value once the replacement's effective lineup-entry time is known. In the default auto-execute path these values will often be identical or nearly identical, but fallback and approval-required modes can still cause them to diverge.

### Definitions

- `injured_total`: all fantasy points the injured player scored in the matchup period.
- `bench_points_before_submission`: all fantasy points the replacement player already scored in matchup-period games that started before `submitted_at` while still on the bench.
- `bench_points_before_roster_effective`: all fantasy points the replacement player scored in matchup-period games that started before `roster_effective_at` while still on the bench.
- `preview_adjustment = -1 * (injured_total + bench_points_before_submission)`
- `final_system_adjustment = -1 * (injured_total + bench_points_before_roster_effective)`

### Submission-time algorithm

```
1. Fetch injured player's stat lines for each game in the matchup period.
2. For each game, compute:
   fantasy_pts = PTS*1.0 + REB*1.2 + AST*1.5 + STL*3.0 + BLK*3.0 - TO*1.0
3. injured_total = sum of fantasy_pts across all games
4. Resolve canonical game-start timestamps from the matchup-week schedule index.
5. Fetch replacement player's stat lines for games already started before submitted_at.
6. Sum only the games that occurred while the player was still on the bench.
7. preview_adjustment = -1 * (injured_total + bench_points_before_submission)
8. Store preview_adjustment and a full breakdown (per-game stats + per-game calc).
9. If the replacement still has future games before matchup_period_end_at, show a warning that the final deduction may increase if execution is delayed.
10. If timing falls inside the ambiguity window and cannot be resolved confidently, route to commissioner review instead of auto-executing.
```

### Execution-time finalization algorithm

```
1. Request may sit in `queued`, `pending_review`, `executing`, `stale_requires_review`, or `fallback_required` until the ESPN LM actions are complete or a commissioner resolves it manually.
2. Determine roster_effective_at:
   a. Default auto-execute mode: record `roster_write_sent_at`, `roster_write_response_at`, any `espn_transaction_proposed_at`, and `roster_verified_at` for the final roster step that promotes the replacement from bench
   b. If ESPN returned `proposedDate` for that final promotion step, preserve it as the preferred server-side candidate timestamp
   c. If all relevant game-start decisions are identical across the verified effective window for that final promotion step, persist a single `roster_effective_at` for auditability using the preferred candidate timestamp when available
   d. If a relevant replacement-player tipoff falls inside or too close to the effective window, route to commissioner review rather than guessing
   e. Approval-required mode follows the same timing rules after approval
   f. Fallback/manual mode: current server time when the commissioner clicks "Mark executed" unless they provide the actual time the replacement entered the lineup
   g. Commissioner may override roster_effective_at if the click happens materially after the actual ESPN roster action
3. Recompute bench_points_before_roster_effective using roster_effective_at and the canonical game schedule index.
4. final_system_adjustment = -1 * (injured_total + bench_points_before_roster_effective)
5. If commissioner supplied an override value:
   applied_adjustment = override_adjustment
   preserve final_system_adjustment separately for auditability
6. Else:
   applied_adjustment = final_system_adjustment
7. Record score_adjustment_written_at when the matchup-adjustment write is verified in ESPN.
8. Persist roster_effective_at, score_adjustment_written_at, workflow_completed_at,
   final_system_adjustment, applied_adjustment, and the final breakdown.
9. Send the manager the final processed message with the applied adjustment.
```

### Why this matters

This split is what makes the PRD's accuracy requirement achievable in all execution modes. The final score adjustment is not frozen until the replacement has entered the lineup and the ledger-backed ESPN adjustment write has been verified.

### Matchup adjustment ledger

ESPN stores one adjustment number per matchup side, but InjurySub treats each injury sub as its own delta and then composes the total matchup adjustment from those deltas.

Ledger rules:

1. On the first system write for a given `(matchup_id, team_id)`, capture `baseline_team_adjustment` from ESPN.
2. For every request in `executed` state, store `applied_adjustment` as that request's delta contribution.
3. For a reversal, mark the original request `reversed`; the target total then drops that request's delta from the sum.
4. Compute `target_team_adjustment = baseline_team_adjustment + sum(applied_adjustment for executed requests on that matchup/team)`.
5. Before every write, compare ESPN's current team adjustment with `last_expected_team_adjustment`.
6. If ESPN has drifted from the last expected total, do not overwrite it blindly; transition to commissioner review with a drift warning and the current observed value.

---

## 7. Data Model

### Configuration (pre-season setup)

```
UserAccount
  user_id              UUID
  email                TEXT (unique, normalized)
  team_id              INTEGER (nullable for commissioner-only account)
  display_name         TEXT
  role                 ENUM ("manager", "commissioner")
  is_active            BOOLEAN
  created_at           TIMESTAMP
  last_login_at        TIMESTAMP (nullable)

LeagueConfig
  league_id            INTEGER
  season_year          INTEGER
  espn_s2              TEXT (encrypted)
  swid                 TEXT (encrypted)
  commissioner_email   TEXT
  commissioner_name    TEXT
  email_from_address   TEXT
  email_provider       TEXT
  app_base_url         TEXT
  magic_link_ttl_min   INTEGER
  session_ttl_days     INTEGER
  default_execution_mode ENUM ("auto_execute", "approval_required")
```

### Auth state

```
LoginLinkToken
  token                TEXT (primary key, 24-char random string)
  user_id              UUID
  redirect_path        TEXT (nullable)
  status               ENUM (active, used, expired, revoked)
  created_at           TIMESTAMP
  expires_at           TIMESTAMP
  used_at              TIMESTAMP (nullable)
```

Session
  session_id           TEXT (primary key, opaque random string)
  user_id              UUID
  created_at           TIMESTAMP
  last_seen_at         TIMESTAMP
  expires_at           TIMESTAMP
  revoked_at           TIMESTAMP (nullable)
  user_agent           TEXT (nullable)
  ip_address           TEXT (nullable)
```

### Audit Log (permanent)

```
SubstitutionRequest
  request_id                    UUID
  team_id                       INTEGER
  matchup_period_id             INTEGER
  created_at                    TIMESTAMP
  submitted_at                  TIMESTAMP
  request_expires_at            TIMESTAMP
  idempotency_key               TEXT
  execution_mode                ENUM ("auto_execute", "approval_required")

  injured_player_id             INTEGER
  injured_player_name           TEXT
  injured_player_slot           TEXT (human-readable, e.g., "F")
  injured_player_status         TEXT
  injured_player_pts_wtd        DECIMAL

  replacement_player_id         INTEGER
  replacement_player_name       TEXT
  replacement_games_remaining   INTEGER
  replacement_bench_pts_at_submit DECIMAL
  lineup_resolution             JSON
  roster_execution_plan         JSON (nullable)
  roster_execution_progress     JSON (nullable)

  preview_adjustment            DECIMAL
  preview_breakdown             JSON
  final_system_adjustment       DECIMAL (nullable)
  final_system_breakdown        JSON (nullable)
  applied_adjustment            DECIMAL (nullable)
  override_adjustment           DECIMAL (nullable)
  last_preflight_at             TIMESTAMP (nullable)
  roster_write_sent_at          TIMESTAMP (nullable)
  roster_write_response_at      TIMESTAMP (nullable)
  espn_transaction_proposed_at  TIMESTAMP (nullable)
  roster_verified_at            TIMESTAMP (nullable)
  roster_effective_at           TIMESTAMP (nullable)
  score_adjustment_written_at   TIMESTAMP (nullable)
  workflow_completed_at         TIMESTAMP (nullable)
  fallback_reason               TEXT (nullable)
  stale_reason                  TEXT (nullable)

  status                        ENUM (queued, executing, pending_review,
                                      stale_requires_review, fallback_required, rejected,
                                      executed, failed, reversed)
  rejection_reason              TEXT (nullable)
  commissioner_note             TEXT (nullable)
  commissioner_acted_at         TIMESTAMP (nullable)
  auto_execution_attempted_at   TIMESTAMP (nullable)

  espn_execution_status         ENUM (not_started, in_progress,
                                      manual_confirmed, automated,
                                      fallback_required, failed, reversed)
  espn_execution_method         TEXT (nullable)
  espn_execution_reference      TEXT (nullable)
```

```
TeamExecutionLease
  lease_key                     TEXT (primary key)  -- e.g. "{team_id}:{matchup_period_id}"
  team_id                       INTEGER
  matchup_period_id             INTEGER
  holder_request_id             UUID
  acquired_at                   TIMESTAMP
  heartbeat_at                  TIMESTAMP
  expires_at                    TIMESTAMP
```

```
MatchupAdjustmentLedger
  ledger_id                     UUID
  matchup_id                    INTEGER
  matchup_period_id             INTEGER
  team_id                       INTEGER
  team_side                     ENUM ("home", "away")
  baseline_team_adjustment      DECIMAL
  last_expected_team_adjustment DECIMAL
  last_verified_team_adjustment DECIMAL
  baseline_captured_at          TIMESTAMP
  last_synced_at                TIMESTAMP
  drift_detected_at             TIMESTAMP (nullable)
  drift_note                    TEXT (nullable)
```

```
RequestSnapshot
  snapshot_id                   UUID
  request_id                    UUID
  created_at                    TIMESTAMP
  phase                         ENUM (submission, preflight,
                                      roster_step_verified,
                                      final_adjustment_verified,
                                      manual_completion)
  roster_state                  JSON
  matchup_state                 JSON
  validation_result             JSON (nullable)
  lineup_resolution             JSON (nullable)
  score_breakdown               JSON (nullable)
  outbound_payload              JSON (nullable)
  verification_result           JSON (nullable)
  notes                         TEXT (nullable)
```

```
SubstitutionEvent
  event_id                      UUID
  request_id                    UUID
  created_at                    TIMESTAMP
  actor_type                    ENUM (manager, commissioner, system)
  actor_identifier              TEXT
  event_type                    ENUM (submitted, queued, validation_failed,
                                      lease_acquired, lease_released,
                                      preflight_succeeded, stale_detected,
                                      expired,
                                      auto_execution_started,
                                      auto_execution_succeeded,
                                      auto_execution_failed,
                                      drift_detected,
                                      fallback_required, approved,
                                      rejected, override_set, executed,
                                      execution_failed, reversed)
  payload                       JSON
```

### Notes on persistence

- `SubstitutionRequest` stores the latest state for fast reads.
- `RequestSnapshot` stores immutable normalized evidence for the exact roster/matchup state used at submission, preflight, and final verification.
- `SubstitutionEvent` is append-only and is the authoritative dispute log.
- A unique index on `(team_id, idempotency_key)` should collapse repeated submits from the same confirmation action.
- A partial unique index should prevent more than one self-service request for the same `(team_id, matchup_period_id, injured_player_id)` when status is one of `queued`, `executing`, `pending_review`, `stale_requires_review`, `fallback_required`, `executed`, or `reversed`.
- A request in `queued` or `stale_requires_review` still counts as the active request for that injured player until it is rejected or resolved.
- If a prior request is `rejected`, the manager may submit a new one for the same injured player.
- `UserAccount.email` should be unique and normalized to lowercase.
- `Session` rows allow server-side revocation and rolling expiration refresh.
- `TeamExecutionLease` is the only authority for whether a team/week is actively mutating ESPN state.

---

## 8. ESPN Write Automation

ESPN write automation is the default launch path. Both required LM actions were manually captured and successfully replayed outside the browser using only `espn_s2` and `SWID` cookies. Those captures confirm the one-step LM primitives the planner depends on: roster swaps/moves and matchup score adjustments. Rearrangement support should therefore be treated as a generic step-planning problem solved by deriving and verifying a sequence of one-step ESPN requests from live state.

### Authentication and headers

Write requests use the same cookie authentication model as read requests:

- `espn_s2` cookie
- `SWID` cookie

Required headers beyond normal HTTP defaults:

- `X-Fantasy-Source: kona`
- `X-Fantasy-Platform: espn-fantasy-web`
- `Content-Type: application/json`

Observed query parameter:

- `platformVersion`: present in captured traffic, but likely optional. Test without depending on it.

There was no observed CSRF token, request signing, origin enforcement, or browser fingerprint requirement.

### Write endpoint 1: roster edit

Roster moves are written to:

```text
POST https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/{year}/segments/0/leagues/{league_id}/transactions/
```

Body shape:

```json
{
  "isLeagueManager": true,
  "teamId": 1,
  "type": "ROSTER",
  "memberId": "{SWID}",
  "scoringPeriodId": 163,
  "executionType": "EXECUTE",
  "items": [
    {"playerId": 4601023, "type": "LINEUP", "fromLineupSlotId": 12, "toLineupSlotId": 11},
    {"playerId": 3936099, "type": "LINEUP", "fromLineupSlotId": 11, "toLineupSlotId": 12}
  ],
  "isActingAsTeamOwner": false,
  "skipTransactionCounters": false
}
```

Implementation notes:

- `memberId` should use the commissioner's `SWID` value in the format accepted by ESPN.
- `teamId` and `scoringPeriodId` come from the league and matchup context.
- `items` represents one ESPN roster action, not the entire substitution workflow.
- For the simple one-for-one injury-sub case, the minimum payload is the injured starter moved to bench plus the bench player moved into the vacated slot.
- A move into an empty slot should produce one `items` entry.
- A swap between two occupied slots should produce two `items` entries in one request.
- Do not assume one request can express an entire multi-step rearrangement.
- For rearrangement cases, generate an ordered sequence of roster requests from the stored `roster_execution_plan`, where each request is one legal move or swap from the current verified roster state.
- For auto-executable rearrangements, the generated sequence must keep the replacement player on the bench until the final roster request.
- Starting-slot IDs should be read from the live roster response, not hardcoded.
- Successful responses have included `status = EXECUTED`, a transaction `id`, and `proposedDate`. Persist those values, but treat the step as successful only after an explicit `mRoster` verification read confirms the expected assignments.

Observed slot IDs remain:

| Slot ID | Meaning |
|---|---|
| 0 | PG |
| 1 | SG |
| 2 | SF |
| 3 | PF |
| 4 | C |
| 5 | G |
| 6 | F |
| 10 | F/C |
| 11 | UTIL |
| 12 | Bench |

### Write endpoint 2: matchup score adjustment

Score adjustments are written to:

```text
POST https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/{year}/segments/0/leagues/{league_id}/schedule
```

Body shape:

```json
[{
  "away": {"adjustment": 0, "adjustmentReason": "", "teamId": 5},
  "home": {"adjustment": -34.2, "adjustmentReason": "Injury sub: AD out, Cam Thomas in", "teamId": 1},
  "id": 5
}]
```

Implementation notes:

- The payload is an array containing the matchup object.
- `id` is the matchup ID from the schedule data.
- `adjustmentReason` accepts free text and is displayed in ESPN.
- Decimal adjustments are confirmed working.
- The payload includes both `home` and `away` values. Always read the current matchup first and preserve the opponent's existing adjustment.
- Never treat the write as a blind overwrite of a single request's delta. Write the ledger-computed `target_team_adjustment` for the acting team.
- If ESPN's current acting-team adjustment does not match `last_expected_team_adjustment`, treat that as drift and route to commissioner review instead of overwriting it.

### Execution strategy

Default auto-execute flow:

1. Attempt to acquire the DB-backed execution lease for `(team_id, matchup_period_id)`. If unavailable, move the request to `queued`.
2. After lease acquisition, read live roster and matchup state and persist a preflight snapshot.
3. If the request is expired, transition to `stale_requires_review` before any write.
4. Build `roster_execution_plan` as an ordered list of one-step ESPN roster requests from the current verified roster to the stored request intent while preserving the invariant that the replacement is promoted from bench only in the final step.
5. If no safe plan can be derived, transition to `fallback_required` or `stale_requires_review` before any write.
6. Execute the roster plan one step at a time:
   a. Record `roster_write_sent_at` and POST the next roster request
   b. Record `roster_write_response_at`, persist any ESPN transaction `id` and `proposedDate`, then read back roster state
   c. Verify the expected intermediate assignments
   d. Persist progress and a verification snapshot after each verified step
7. After the final roster step verifies, set `roster_verified_at` and resolve `roster_effective_at` using the execution-time timing rules above.
8. Recompute the authoritative per-request delta using `roster_effective_at`.
9. Read the current matchup object and current ledger state.
10. If this is the first system write for the matchup/team, capture `baseline_team_adjustment`.
11. If ESPN's current acting-team adjustment differs from `last_expected_team_adjustment`, emit `drift_detected` and transition to review/fallback.
12. Compute `target_team_adjustment` from the ledger and merge in an `adjustmentReason`.
13. POST the matchup adjustment payload.
14. Read back matchup state and verify the new adjustment value.
15. Persist a final verification snapshot, set `score_adjustment_written_at`, `workflow_completed_at`, and mark the request `executed` with `espn_execution_status = automated`.
16. Release the execution lease.

### Failure handling

- **Verification:** After each write, read back via the read API to confirm expected state. Never treat the roster POST response body as sufficient proof that the lineup change is complete.
- **Stepwise execution:** Rearrangement automation is not atomic at the ESPN API layer. Persist each verified roster step so the system always knows the current applied state and the remaining steps.
- **Partial progress:** If a roster step succeeds but a later roster step or score adjustment fails, detect it immediately, persist the current verified roster state plus remaining planned steps, and notify the commissioner with the exact remaining manual fix.
- **Fallback:** Any failure -> immediate transition to `fallback_required` with the pre-computed payload details preserved for commissioner handling.
- **Lease safety:** If the process dies mid-execution, lease TTL expiry allows a commissioner-assisted resume path instead of a permanently stuck lock.
- **Startup recovery:** On process boot, scan `executing` and `queued` requests, inspect expired leases, reread live ESPN state, and either resume safely from verified progress or route the request to commissioner review.
- **Stale requests:** If a request sat queued or pending long enough that preflight can no longer realize the stored intent safely, transition to `stale_requires_review`.
- **Drift:** If the matchup adjustment has changed outside InjurySub, stop and route to commissioner review rather than reconciling automatically.
- **Auditability:** Persist the outbound request metadata needed for debugging, excluding raw secret values.

### Infrastructure note

Because the write path is plain HTTP, launch automation does not require a headless browser or Playwright infrastructure. The same persistent server process that handles the web flow can own the write adapter and execution lease logic.

---

## 9. Deployment

### Recommended topology

A single small persistent server handles everything:

1. **Web app** — serves sign-in, manager dashboard, history pages, and commissioner review/execution endpoints.
2. **Execution coordinator** — acquires execution leases, runs delayed-execution preflight, performs ESPN writes, and releases leases.
3. **Email adapter** — sends magic links, manager receipts, and commissioner notifications.

These can be the same process/deployment since they share the ESPN adapter, auth/session layer, data store, and email client.

### Hosting candidates

| Option | Pros | Cons | Cost |
|---|---|---|---|
| Fly.io / Railway / Render | Persistent process, easy deploy, supports the synchronous execution path and DB-backed leases directly | Small monthly cost even when idle | ~$5–7/month |
| Vercel / Netlify (serverless) | Low idle cost | Not recommended for v1: multi-step ESPN execution, lease coordination, and durable revalidation fit poorly without adding a background worker + external DB/queue | Free-$5/month before extra stateful services |
| VPS (DigitalOcean, etc.) | Full control | More ops burden | ~$5/month |

Recommendation: use a small persistent server for v1. At this scale the monthly cost is still low, and it avoids adding the extra queue/worker/database complexity that serverless would need to execute the same design safely.

Target: **under $10/month total** including email delivery.

### Domain

A short, memorable domain for the app itself. It should be easy to bookmark and add to a phone home screen (for example `injurysub.app` or `sub.yourleaguename.com`).

---

## 10. Security

- **ESPN credentials** encrypted at rest, decrypted only in memory.
- **Passwordless auth** via one-time magic links plus persistent server-side sessions.
- **Session cookies** should be `Secure`, `HttpOnly`, and `SameSite=Lax` at minimum.
- **CSRF protection** is required on mutating routes because authorization is now cookie-based.
- **Magic links** are single-use, short-lived, and must not be consumed on the landing-page `GET`.
- **Auth request throttling** should rate-limit `/auth/request-link` to reduce abuse and accidental email spam.
- **HTTPS only** for all endpoints.
- **No cross-manager data exposure.** The authenticated session determines team scope. The web UI only shows that team's roster.
- **Commissioner and automation mutations are auditable.** Every approve/reject/override/execute/reverse action and every automated execution attempt emits an append-only event row.

---

## 11. Testing Strategy

### Unit tests

- Score calculation against known stat lines.
- Positional eligibility and lineup rearrangement logic.
- Magic-link generation, landing-page confirmation, validation, expiration, and single-use enforcement.
- Session creation, rolling refresh, expiration, and revocation.
- Execution-lease acquisition, lease expiry, and queued-request promotion.
- Precomputed dashboard option classification for `auto_executable`, `valid_requires_review`, and `invalid`.
- Planner invariant that keeps the replacement player on bench until the final step.
- Finalization logic that changes when `roster_effective_at` crosses a replacement-player tipoff.
- Duplicate-request detection plus `idempotencyKey` replay behavior.
- Delayed-execution preflight and stale-request detection.
- Startup reconciliation for orphaned `executing` or `queued` requests.
- Ledger total calculation, reversal handling, and drift detection.

### Integration tests

- ESPN adapter: verify data parsing against a captured API response.
- Auth flow: request magic link, render landing page, consume token, establish session, and access protected pages.
- Dashboard data: verify `GET /app` returns replacement options with `auto_executable`, `valid_requires_review`, and `invalid` statuses plus the expected reasons and previews.
- Web app confirmation flow: submit POST with valid/invalid payloads, verify request rows and event log entries for auto-execute success.
- Queueing flow: submit two valid requests for the same team/week, verify the second waits, re-runs preflight, and then executes after the first finishes.
- Approval-required mode: queue a request, approve/reject it, and verify later execution behavior.
- Fallback flow: induce an automation failure, verify `fallback_required` state, then complete the request manually.
- Stale flow: let a request age past expiry or mutate the roster externally before delayed execution, then verify transition to `stale_requires_review`.
- Restart recovery flow: leave a request in `executing` or `queued`, restart the process, and verify boot-time reconciliation resumes safely or routes to review.
- History and commissioner views: verify a manager only sees their own requests and the commissioner can see all requests.
- ESPN write adapter: verify roster transactions are formed correctly for direct swaps and for rearrangements executed as multiple sequential ESPN requests that keep the replacement on bench until the final step.
- Schedule/score logic: verify canonical game-start mapping, ambiguity-window fallback, and bench-point cutoffs around tipoff.
- Matchup ledger: verify schedule-adjustment writes preserve the opponent's value, compose additive deltas correctly, and halt on drift.
- Snapshot persistence: verify immutable submission/preflight/final verification snapshots are stored for dispute review.

### Pre-season validation

Run real injury subs through the full flow against previous season data. Have league-mates test the email magic-link -> app -> confirm pipeline on their phones, verify successful auto-execute on a direct swap and on at least one rearrangement that requires multiple sequential roster requests, simulate at least one near-tipoff submission, and deliberately simulate at least one fallback case plus one external-adjustment drift case for commissioner handling.

---

## 12. Known Unknowns

| Item | How to Resolve |
|---|---|
| ESPN basketball API path: `fba` vs `flb`? | Test request with each. |
| ESPN stat ID mapping for basketball | Cross-reference API output with known box scores. |
| Exact `memberId` formatting requirements for write calls (`SWID` with or without braces) | Verify against a second replay and normalize in the adapter. |
| Whether `proposedDate` should be treated as authoritative effective time or only as a server-side candidate timestamp | Compare repeated write responses, `Date` headers, and immediate verification reads; use conservative fallback near tipoff until confidence is high. |
| Which valid rearrangements can be decomposed into ESPN-legal one-step swaps/moves while keeping the replacement on bench until the final step | Dry-run several representative rearrangements in preseason using the final-step planner and record any patterns that must always fall back. |
| ESPN cookie expiration cadence | Monitor during pre-season. |
| Email deliverability and spam-folder behavior for magic links | Dry-run first-use sign-in with multiple league-mates before season. |
| How often real requests land inside the schedule ambiguity window near tipoff | Simulate boundary cases during preseason and tune the fallback threshold conservatively. |
