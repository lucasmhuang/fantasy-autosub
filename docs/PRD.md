# InjurySub — Product Requirements Document

**Last Updated:** April 3, 2026
**Status:** Draft
**Related Docs:** InjurySub TDD, InjurySub FOUNDATION

---

## 1. Problem

In a weekly-lock ESPN Fantasy Basketball league (H2H Points), each lineup slot locks when that player's first game of the matchup week begins. If a starter is injured mid-week, the manager is stuck with a partial or zero score in that slot for the remaining games — a single injury can decide an entire matchup.

The league adopted a custom rule to address this. The rule works, but the process to execute it is entirely manual, slow, error-prone, and dependent on the commissioner's availability.

---

## 2. The Injury Substitution Rule

> If a rostered player is designated **OUT**, any manager may request an injury substitution. The injured player is removed from the starting lineup and replaced by a player on the requesting manager's bench. The manager **forfeits all fantasy points** the injured player scored during the current matchup week. The bench replacement **only earns credit for games played after** the substitution is processed — points the bench player scored earlier in the week while on the bench are not credited.

### How it's executed today

1. Manager messages the commissioner requesting a sub.
2. Commissioner validates: is the player OUT? Is the replacement on the bench? Does positional eligibility work?
3. Commissioner calculates the injured player's fantasy points scored this week using the league scoring formula.
4. Commissioner applies a **negative score adjustment** in ESPN LM Tools equal to those points.
5. Commissioner performs a **roster edit** in ESPN LM Tools to swap the players.
6. If the roster edit couldn't be done before the bench player's next game, the score adjustment must also account for any points the bench player earned while still on the bench.

### What's wrong with this

- **Latency:** Commissioner may be unavailable for hours. Every hour of delay risks complicating the math or missing a bench player's game entirely.
- **Error-prone math:** Manual stat lookup and formula application across multiple games.
- **Validation burden:** Commissioner must independently verify injury status, roster composition, and positional eligibility through ESPN's UI.
- **No audit trail:** Requests and adjustments live in scattered text messages.

---

## 3. League Configuration

| Setting | Value |
|---|---|
| Platform | ESPN Fantasy Basketball (League Manager league) |
| Format | H2H Points, Redraft |
| Teams | 12 (two 6-team conferences) |
| Starting lineup | 3 G, 3 F, 1 C, 1 F/C, 2 UTIL (10 starters) |
| Bench / IR | 4 bench, 3 IR |
| Lineup changes | Weekly; each slot locks at player's first game of the matchup week |
| Scoring | PTS × 1.0 + REB × 1.2 + AST × 1.5 + STL × 3.0 + BLK × 3.0 − TO × 1.0 |
| Acquisition | FAAB ($1000/year, $0 min bid) |
| Season | 18 regular-season matchups; top 6 make playoffs (top conference seed gets bye) |

### Positional Eligibility

| Lineup Slot | Accepted Positions |
|---|---|
| G | PG, SG |
| F | SF, PF |
| C | C |
| F/C | SF, PF, C |
| UTIL | Any |

A substitution is valid if the bench player can fill the injured player's slot directly, **or** if a rearrangement of existing starters creates a valid configuration. The system should attempt to find any valid lineup arrangement, not just a direct slot swap.

---

## 4. Product Goals

1. **Reduce time-to-execution** from hours to under one minute for normal successful requests.
2. **Eliminate calculation errors** by computing score adjustments from source stat data.
3. **Provide a self-service interface** so managers don't need to message the commissioner directly.
4. **Create a transparent audit trail** of all requests, validations, and adjustments.
5. **Automate ESPN LM actions by default** so the commissioner is removed from the critical path except on failures, overrides, or reversals.

### Success Metrics

| Metric | Target |
|---|---|
| Median time from request to ESPN execution | < 1 min |
| Score adjustment accuracy | 100% |
| Commissioner manual interventions per season | < 5 |

---

## 5. User Roles

**Manager (12 users):** Initiates injury sub requests. Views their own request history. Cannot act on other managers' rosters.

**Commissioner (1 user):** Monitors automation, configures system settings (email-to-team mapping, ESPN credentials, email delivery, execution mode), handles overrides and reversals, and steps in only when approval is required or automation fails.

---

## 6. Interface: Web App + Email Magic Link Auth

The system uses a mobile-first web application as the primary interface. Managers navigate directly to the site from a bookmark, home-screen icon, or remembered URL.

**Email** is the authentication and recovery mechanism. On first use or whenever signed out, a manager enters their pre-registered email address. The system sends a short-lived magic link to that email. When the link is opened, the site displays a short sign-in confirmation page; after the manager explicitly taps to continue, the system consumes the link and creates a persistent signed-in session on that device/browser.

**Web UI** is both the interaction surface and the ongoing home screen. After sign-in, the manager lands on a dashboard that shows the current matchup, eligible injured starters, bench replacements, request history, and status of any prior substitutions.

### Why this combination

- **Still low-friction.** No passwords, no account setup, no commissioner involvement for normal sign-in recovery.
- **Cleaner execution flow.** The manager can open the site, confirm the sub, and receive an immediate final result when automation succeeds.
- **One destination.** The product becomes a bookmarked app rather than a text-triggered utility.
- **Self-service recovery.** If a manager loses their session, they can request a new magic link themselves.
- **Simpler architecture.** No Twilio provisioning, webhook validation, or SMS delivery dependencies.

---

## 7. User Flow

### 7.1 Manager Initiates Request

Manager opens the InjurySub website.

If they already have an active session on that device, they go straight to their dashboard.

If they are signed out, the site asks for their pre-registered email address.

If the email isn't recognized:
> "I don't recognize that email address. Ask your commissioner to add you."

### 7.2 System Authenticates and Loads Dashboard

If the email is recognized, the system sends a one-time magic link.

> "Check your email for a sign-in link."

The link is a unique, short-lived, pre-authenticated URL. When opened, it lands on a short confirmation page. After the manager explicitly taps to continue, the system consumes the link, signs the manager into the site, and creates a persistent session on that device/browser.

Once signed in, the system fetches the manager's current roster from ESPN and checks for starters with OUT or SUSPENSION status.

**Zero starters OUT:**
> Dashboard message: "None of your starters are currently listed as OUT. If this just changed, give ESPN a few minutes to update and refresh."

**One or more starters OUT:**
> Dashboard card: "Anthony Davis is OUT (knee), 34.2 pts this week."

If multiple starters are OUT, the dashboard indicates this:
> Dashboard card: "You have 2 starters currently OUT."

On dashboard load, the system also pre-evaluates every `(OUT starter, bench player)` pair and classifies each possible replacement as:

- **Ready now** — valid under league rules and auto-executable from the current live ESPN state.
- **Review required** — valid under league rules, but commissioner review is required because the system cannot safely auto-execute it from the current live state.
- **Not valid** — not a legal substitution.

These statuses are advisory until confirmation time. The system recomputes them against live data when the manager submits.

### 7.3 Manager Completes Sub in Web UI

The web page displays:

**Injured player section.** For each OUT starter: name, team, position, lineup slot, injury detail, fantasy points scored this week (with full stat breakdown), and a clear statement of what will be forfeited. If multiple starters are OUT, the manager selects which one to sub out first.

**Bench replacement section.** Lists bench players with a clear status for the selected injured player: Ready now, Review required, or Not valid. Ready-now options appear first. A manager may optionally reveal all bench players to understand every possibility. For each option, the page shows name, team, position, games remaining this week, next game, season average fantasy points, the resolved lineup preview when valid, and a short reason when review is required or the option is invalid. If applicable, the page also shows a warning that the player has already scored points this week while on the bench that won't be credited.

The manager selects a replacement.

**Confirmation screen.** Summarizes the full substitution: who's going out, who's coming in, which slot, the exact score adjustment, and any bench-period deduction. Manager taps a single "Confirm" button.

### 7.4 Request Submitted

On confirmation, the system:
1. Records the request in the audit log with full details.
2. Either begins execution immediately or places the request in a short-lived queue if another request for the same team and matchup week is already being executed.
3. When the request reaches the front of the queue, attempts to execute the roster edit automatically by default. It derives a sequence of one or more ESPN roster transactions from the current verified lineup state and then applies the score adjustment.
4. If execution succeeds, displays a final success message on the page immediately.
5. If execution fails, live ESPN state has materially changed before a delayed execution attempt, or league settings require review first, routes the request to the commissioner workflow and displays a clear pending/fallback status.
6. Optionally sends an email receipt to the manager with either the final success result or the fallback status.

### 7.5 Automation and Commissioner Oversight

**Default launch mode:** After the manager confirms, the system validates the request, derives a safe sequence of one or more ESPN roster transactions from the current verified lineup state, executes the roster edit and score adjustment automatically, verifies each required write, and returns the final result immediately when no earlier request for that team and matchup week is already executing.

**Approval-required mode (optional):** The commissioner receives an approve/reject prompt before the automated write is attempted.

Before any delayed execution attempt, the system re-reads live ESPN state and confirms the original request can still be executed safely from the current roster and matchup state.

**Fallback mode:** If any ESPN write fails, verification fails, a required automation step cannot be completed reliably, the system cannot derive or complete a safe sequence of ESPN roster transactions from the current state, live state has drifted enough that the original execution plan is no longer safe, or the commissioner disables automation, the commissioner receives the exact request details, payload values, and manual execution instructions needed to finish the substitution.

The manager sees the final result in the web UI and may also receive an email confirmation:
> "Done! Your injury sub is confirmed. Cam Thomas is now starting at F."

If the request falls back to commissioner handling, the manager sees a clear status such as:
> "Your injury sub is valid, but automatic execution needs commissioner review. You'll get an update when it's finished."

---

## 8. Functional Requirements

### 8.1 Manager Identification

- The system maintains a mapping of pre-registered email addresses to ESPN team IDs, configured by the commissioner before the season.
- Sign-in attempts from unrecognized emails receive an error message.
- One primary email per team for the initial version. If a team has co-managers, they must designate one primary account.

### 8.2 Authentication & Recovery

- The sign-in flow is passwordless. Managers authenticate by entering their registered email address and receiving a one-time magic link.
- Magic links expire after a configurable duration (recommended: 15 minutes) and are single-use.
- Opening a magic link must first land on a short confirmation page. The token is consumed only after the manager explicitly taps to continue.
- Successful sign-in creates a persistent session on the current device/browser.
- Sessions should use a rolling expiration long enough to cover the season for active users (recommended: 90 days).
- If a session is lost or expires, the manager can self-serve a new magic link by entering their email again.
- An expired or invalid magic link displays a friendly error page directing the manager to request a new one.

### 8.3 Roster & Injury Data

- The system fetches the manager's current roster live (not cached) on dashboard load and again at confirmation time, including lineup slot assignments, injury status, and week-to-date stats.
- Only players with an ESPN injury status of OUT or SUSPENSION qualify for injury substitution.

### 8.4 Validation

All of the following must be true for a request to be valid:

1. The injured player has a qualifying injury designation (OUT / SUSPENSION) at the time of confirmation.
2. The injured player is in a starting lineup slot (not bench, not IR).
3. The replacement player is on the manager's bench.
4. The replacement player can be placed into a valid lineup configuration (direct slot fit or rearrangement).
5. No existing self-service request for the same injured player in the same matchup week is already in progress, completed, or reversed.
6. The matchup week has not concluded.
7. The manager is authenticated and authorized to act on that team.

If a prior request for that injured player was rejected before execution, the manager may submit a new request.

Repeated taps, refreshes, or retried network submissions must collapse to a single request rather than creating duplicates.

Validation is performed at confirmation time (not just at page load) to ensure data freshness. If validation fails, the web page displays a specific, actionable error message.

The dashboard may precompute and display a status for every `(injured starter, bench player)` pair using three categories:

- `auto_executable`
- `valid_requires_review`
- `invalid`

These statuses improve the UI and reduce failed confirmations, but they are advisory only. The confirmation request remains authoritative.

Request validity is distinct from auto-executability. A rearrangement may be league-valid but still require commissioner review if the system cannot derive or safely verify a sequence of ESPN roster transactions from the current live state.

ESPN writes for a given team in a given matchup week must execute serially. If multiple valid requests exist for the same team and week, later requests may wait briefly behind earlier ones rather than writing concurrently.

If a request is delayed before execution because it is awaiting commissioner action or waiting behind another in-progress request, the system must revalidate against live ESPN state again immediately before the write attempt. If the live state has drifted enough that the original request cannot be executed safely, the request must route to commissioner review rather than forcing the stale plan.

Delayed requests should expire after a configurable window (recommended: 12 hours). Expired requests remain in the audit log but are not auto-executed until the commissioner reviews them.

### 8.5 Score Adjustment Calculation

1. Sum the injured player's fantasy points across all games played within the current matchup period, using the league scoring formula.
2. The base adjustment is the **negative** of this sum.
3. The authoritative timing boundary for the bench deduction is when the replacement player first leaves the bench and enters a starting lineup slot in ESPN.
4. Auto-executable rearrangements must be planned so the replacement enters the lineup in the final roster step. This keeps the timing boundary aligned with the completed substitution.
5. If the replacement enters the lineup after the bench player's next game has started: also compute and deduct the bench player's fantasy points for games that started before that effective time while the player was still on the bench.
6. If the replacement enters the lineup before the bench player's next game: no additional adjustment needed.
7. Each injury-sub adjustment is treated as that request's delta and combined with any existing matchup adjustments rather than replacing the matchup adjustment field outright.

The system must output the total adjustment value and a human-readable breakdown showing per-game stat lines and formula application.

The system determines that timing boundary from the ESPN transaction timestamp when available plus a verified post-write roster read showing when the replacement left the bench. If those signals are ambiguous or too close to a relevant tipoff to preserve accuracy confidently, it must route the request to commissioner review rather than guessing.

### 8.6 Commissioner Workflow

- Commissioner can configure the league's execution mode: `auto-execute` (default) or `approval-required`.
- In `approval-required` mode, commissioner receives a notification for each validated request with an approve/reject prompt.
- On automation failure or verification failure, commissioner receives a notification with team name, injured player, replacement player, calculated adjustment, and manual execution instructions.
- Before any delayed automation attempt, the system re-fetches live ESPN state, recomputes the execution plan if needed, and confirms the request is still safe to execute.
- If a pending or queued request has become stale or expired, the system routes it to commissioner review instead of auto-executing it.
- Commissioner can approve, reject (with reason), or override the calculated adjustment value when review is required.
- On manual completion, commissioner can confirm or correct the effective time when the replacement actually entered the lineup for the final bench-point deduction.
- Commissioner can reverse a processed injury sub. System computes the inverse adjustment.

### 8.7 Audit Trail

- Every request is logged with: timestamp, team, injured player, replacement player, injury status at time of request, validation result, calculated adjustment (with breakdown), roster effective time, commissioner action, execution status, and immutable request-time and execution-time snapshots of the roster/matchup state used in decisions.
- All managers can view their own request history (via the web UI). Commissioner can view all requests.
- The audit log is the authoritative record for league disputes.

---

## 9. Web UI Design Principles

- **Mobile-first.** The primary use case is a manager on their phone during a game. The page must be fully functional and polished on small screens.
- **Dark theme.** Matches a game-day viewing context (dimmed room, TV on). Avoid bright white backgrounds.
- **Information-dense but scannable.** Show all relevant context (stats, games remaining, eligibility, warnings) without requiring scrolling through walls of text. Use visual hierarchy: the injured player and their forfeited points should be the most prominent element.
- **One clear action per screen.** Selection screen → confirmation screen → done screen. Never show more than one primary action button.
- **Actionable options first, transparency preserved.** Show Ready-now options first by default, but allow managers to reveal all bench players. Review-required and invalid options stay visible with a clear reason instead of disappearing.
- **Warnings over blocks.** If a bench player has zero games remaining or has already scored bench points, warn the manager clearly but don't prevent the action. Trust the manager to make informed decisions.

---

## 10. Launch Model

### Launch Strategy

The system launches with ESPN write automation enabled by default. There is no separate manual-first product phase. Manual commissioner handling exists only as a fallback path and operational safety valve.

Launch intent is to automate direct swaps and rearrangements as part of the normal path whenever the system can derive and verify a deterministic sequence of one or more ESPN roster transactions from the live roster state. League-valid requests that cannot be planned or verified safely remain supported through commissioner review.

**Target:** Ready before the 2026–27 NBA season (build August-September 2026).

### Execution Modes

- **Auto-execute (default):** validated requests execute immediately in ESPN.
- **Approval-required (optional):** commissioner approves the request before the automated write is attempted.
- **Manual fallback:** if automation fails, verification fails, or automation is disabled, the commissioner receives manual execution instructions and the request remains tracked in the same system.

### Future Enhancements (not committed)

- **Proactive injury alerts:** Monitor injury feeds and email or push-notify managers when a starter is ruled OUT.
- **Suggested sub recommendations** based on remaining schedule and projected points.
- **League-wide dashboard** showing all injury subs, audit log, and impact analysis.
- **Summary messages** posted to the league's Messenger group chat for transparency.
- **Optional SMS or push delivery** for login recovery and urgent alerts.

---

## 11. Edge Cases

| Situation | Behavior |
|---|---|
| Player is OUT before matchup week starts (never plays) | Allowed. Points forfeited = 0. Just a roster swap, no score adjustment. |
| Player injured during a game (partial minutes) | Allowed only once ESPN designates them OUT. Partial game points are forfeited. |
| Player status reverts from OUT to ACTIVE between page load and confirmation | Validation at confirmation time catches this. Display error: "Player is no longer listed as OUT." |
| Bench replacement has already played game(s) this week | Allowed. Web UI displays a warning. Those points are excluded via the adjustment. |
| Bench replacement has zero games remaining | Warn the manager in the UI but allow it. The sub is still valid. |
| Manager wants to sub from IR, not bench | Not allowed. IR players are not shown in the replacement list. |
| Manager wants to reverse a processed sub | Not supported as self-service. Commissioner can manually reverse. |
| Multiple starters OUT on the same team | Web UI shows all OUT starters. Manager selects one at a time. Each sub is independent. |
| Sub request arrives after bench player's last game has started | Sub processes but bench player gains no new points. Net effect is purely subtractive. |
| Request waits in queue or approval long enough that roster state changes | System revalidates before execution. If the original plan is now stale, route to commissioner review instead of auto-executing. |
| Manager double-submits due to refresh or repeated taps | System returns the existing request instead of creating a duplicate. |
| Stat correction after sub is processed | Flag for commissioner review. Do not auto-adjust. |
| Magic link is opened by an email security scanner or link prefetcher | The link lands on a confirmation page and is not consumed until the manager explicitly taps to continue. |
| Expired or used magic link | Friendly error page: "This sign-in link has expired. Request a new one." |
| Session expired or browser data cleared | Manager re-enters email and gets a fresh magic link. No commissioner action required. |
| Magic link opened on different device or shared | Link works on any device once. After use, the destination device receives the signed-in session. |

---

## 12. Open Questions

| # | Question | Owner |
|---|---|---|
| 1 | Should there be a deadline within the matchup week for submitting requests? | League vote |
| 2 | Should the system support "courtesy" subs for DTD players confirmed out via news? | League vote |
| 3 | Should the audit log be visible to all managers or only the requesting manager + commissioner? | League vote |
| 4 | Should the web UI support multiple subs in one session, or require one substitution per confirmation flow? | Product decision |
