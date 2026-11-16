// Shown while the Requests list loads: placeholders the size of real rows (IF-LIST-2).
export default function RequestsLoading() {
  return (
    <div className="app">
      <main className="shell-main">
        <div className="page single flow">
          <header className="titleblock">
            <h1 className="t-title">Your requests</h1>
          </header>
          <div className="list-panel" aria-busy="true">
            {["first", "second", "third", "fourth"].map((row) => (
              <div key={row} className="reqrow has-faces" aria-hidden="true">
                <div className="face-pair">
                  <div className="face-s is-out sk" />
                  <div className="face-s sk" />
                </div>
                <div className="sk h-[16px] w-[70%]" />
                <div className="sk h-[16px] w-[40px]" />
                <div className="line2">
                  <div className="sk h-[20px] w-[64px]" />
                  <div className="sk h-[12px] w-[96px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
