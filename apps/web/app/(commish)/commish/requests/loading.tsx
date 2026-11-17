// Shown while the queue loads: placeholders the shape of real queue rows, so the rows don't shift
// the page when they come.
export default function QueueLoading() {
  return (
    <div className="app">
      <main className="shell-main">
        <div className="page single flow">
          <header className="titleblock">
            <h1 className="t-title">Queue</h1>
          </header>
          <div className="list-panel" aria-busy="true">
            {["first", "second", "third", "fourth"].map((row) => (
              <div key={row} className="qrow has-faces" aria-hidden="true">
                <div className="face-pair">
                  <div className="face-s is-out sk" />
                  <div className="face-s sk" />
                </div>
                {/* Each bar sits in its line's box: the team's line and the amount, the swap
                    and its time, then the pill and its sentence. */}
                <div className="flex h-[22px] items-center">
                  <div className="sk h-[16px] w-[60%]" />
                </div>
                <div className="flex h-[22px] items-center justify-end">
                  <div className="sk h-[16px] w-[56px]" />
                </div>
                <div className="line2">
                  <div className="flex h-[20px] w-[70%] items-center">
                    <div className="sk h-[14px] w-full" />
                  </div>
                </div>
                <div className="why">
                  <div className="sk h-[20px] w-[96px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
