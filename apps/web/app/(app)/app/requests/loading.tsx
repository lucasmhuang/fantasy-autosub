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
              <div key={row} className="reqrow" aria-hidden="true">
                <div className="sk h-[14px] w-[70%]" />
                <div className="sk h-[14px] w-[40px]" />
                <div className="sk h-[10px] w-[50%]" />
                <div className="sk h-[18px] w-[60px]" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
