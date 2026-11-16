import { redirect } from "next/navigation";
import { ChooseView } from "../../../../../components/board/choose-view";
import { ConfirmView } from "../../../../../components/board/confirm-view";
import { AddressStatusNotice } from "../../../../../components/board/status-notice";
import { DatabaseDown } from "../../../../../components/shell/full-state";
import { Shell } from "../../../../../components/shell/shell";
import {
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../../lib/server/auth";
import { isLoadedBoard, loadTeamBoard } from "../../../../../lib/server/board";
import { loadConfirmation } from "../../../../../lib/server/requests";
import { loadShell } from "../../../../../lib/server/shell";

type ConfirmSearchParams = { injured?: string; replacement?: string; status?: string };

function playerId(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,12}$/.test(value) ? Number(value) : null;
}

// The summary before Confirm (behaviors R1-R3): leaving it records nothing.
export default async function ConfirmRequestPage(props: {
  searchParams: Promise<ConfirmSearchParams>;
}) {
  const params = await props.searchParams;
  const session = await getCurrentAuthenticatedSession();
  if (!session) {
    const asked = { injured: params.injured, replacement: params.replacement };
    redirect(signInLocation("/app/requests/new", asked));
  }
  const { teamId } = session.user;
  if (teamId === null) redirect("/app");
  const injuredId = playerId(params.injured);
  const replacementId = playerId(params.replacement);
  if (injuredId === null) redirect("/app?status=invalid_form");
  if (params.replacement === undefined) return ChoosePage({ session, teamId, injuredId });
  if (replacementId === null) redirect("/app?status=invalid_form");

  const view = await loadConfirmation({ teamId, injuredId, replacementId });
  if (view.status === "already_requested") redirect(`/app/requests/${view.requestId}`);
  if (view.status === "not_offered") redirect(`/app/requests/new?injured=${injuredId}`);
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="team" tabs={false}>
      {view.status === "confirm" ? (
        <ConfirmView
          view={view}
          zone={deviceZoneOf(session)}
          now={new Date()}
          commissionerName={shell.commissionerName}
          notice={<AddressStatusNotice status={params.status} />}
        />
      ) : (
        <ChooseView
          state="unread"
          reason={view.status}
          injuredId={injuredId}
          commissionerName={shell.commissionerName}
        />
      )}
    </Shell>
  );
}

type SignedIn = NonNullable<Awaited<ReturnType<typeof getCurrentAuthenticatedSession>>>;

// Choose: the starter's options, read fresh. A starter no longer OUT goes back to the team page,
// and one with a request this week to it.
async function ChoosePage(input: { session: SignedIn; teamId: number; injuredId: number }) {
  const board = await loadTeamBoard({ teamId: input.teamId, revealAll: true });
  if (board.status === "database_down") return <DatabaseDown />;
  const starter = isLoadedBoard(board)
    ? [...board.outStarters, ...board.suspendedStarters].find(
        (each) => each.playerId === input.injuredId
      )
    : undefined;
  // An old read (ESPN unread) can't say he's no longer OUT.
  if (isLoadedBoard(board) && !board.stale && starter === undefined) {
    redirect("/app?status=not_out");
  }
  if (starter?.request) redirect(`/app/requests/${starter.request.requestId}`);
  const shell = await loadShell(input.session);
  const found = isLoadedBoard(board) && !board.stale && starter !== undefined;
  return (
    <Shell shell={shell} current="team" tabs={false}>
      {found ? (
        <ChooseView
          state="found"
          starter={starter}
          route={board.readyRoute}
          readAt={board.readAt}
          zone={deviceZoneOf(input.session)}
          now={new Date()}
          commissionerName={shell.commissionerName}
        />
      ) : (
        <ChooseView
          state="unread"
          reason={isLoadedBoard(board) ? "unavailable" : board.status}
          injuredId={input.injuredId}
          commissionerName={shell.commissionerName}
        />
      )}
    </Shell>
  );
}
