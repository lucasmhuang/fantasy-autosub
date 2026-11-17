import { BackBar, LineBar } from "../../../../../components/shell/loading-parts";
import { ManagerLoadingFrame } from "../../../../../components/shell/shell-frame";

// Shown while a request's page loads: its own placeholders (the swap, the title and its line, the
// status), not the team page's that the folder above would show.
export default function RequestLoading() {
  return (
    <ManagerLoadingFrame current="requests">
      <div className="page flow">
        <BackBar href="/app/requests" label="Requests" />
        <div className="sk h-[218px] rounded-(--radius-14)" aria-hidden="true" />
        <header className="reqhead">
          <LineBar className="t-title" bar="w-[75%]" />
          <LineBar className="reqhead-subtitle" bar="w-[50%]" />
        </header>
        <div className="status sk h-[142px]" aria-busy="true" />
      </div>
    </ManagerLoadingFrame>
  );
}
