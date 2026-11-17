import { LineBar } from "../../../../../components/shell/loading-parts";
import { ManagerLoadingFrame } from "../../../../../components/shell/shell-frame";

// Shown while the Requests list loads: placeholders the size of real rows (IF-LIST-2).
export default function RequestsLoading() {
  return (
    <ManagerLoadingFrame current="requests">
      <div className="page single flow">
        <header className="titleblock">
          <h1 className="t-title">Your requests</h1>
          <LineBar className="titleblock-subtitle" bar="w-[45%]" />
        </header>
        <div className="list-panel" aria-busy="true">
          {["first", "second", "third", "fourth"].map((row) => (
            <div key={row} className="reqrow has-faces" aria-hidden="true">
              <div className="face-pair">
                <div className="face-s is-out sk" />
                <div className="face-s sk" />
              </div>
              {/* Each bar sits in its line's box: the title's 22 px, the amount's 20, then
                    the pill's line and the time, which wraps under it at phone width. */}
              <div className="flex h-[22px] items-center">
                <div className="sk h-[16px] w-[70%]" />
              </div>
              <div className="flex h-[20px] items-center justify-end">
                <div className="sk h-[16px] w-[40px]" />
              </div>
              <div className="line2">
                <div className="sk h-[20px] w-[96px]" />
                <div className="flex h-[17px] w-[150px] items-center">
                  <div className="sk h-[12px] w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ManagerLoadingFrame>
  );
}
