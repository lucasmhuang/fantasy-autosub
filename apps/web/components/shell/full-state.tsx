import type { ReactNode } from "react";

const NOTHING_LOST =
  "Nothing you filed is lost. Starter ruled OUT? Text your commissioner; they can file it with the time you asked.";

// A page that can't be shown gives way to one of these: a headline, a sentence and one action.
function FullState({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <main className="fullstate">
      <h1 className="t-headline">{title}</h1>
      <p>{text}</p>
      {action}
    </main>
  );
}

// FS-APP-1: InjurySub's database is down. Never says ESPN can't be reached. An empty href loads
// this same address again.
export function DatabaseDown() {
  return (
    <FullState
      title="Can't load InjurySub right now"
      text={NOTHING_LOST}
      action={
        <a className="btn" href="">
          Try again
        </a>
      }
    />
  );
}

// FS-APP-3: any failure nothing else handled. The error boundary gives its own retry.
export function UnexpectedFailure({ retry }: { retry: ReactNode }) {
  return <FullState title="Something went wrong on our side" text={NOTHING_LOST} action={retry} />;
}

// FS-APP-4: an address with no page.
export function NotFoundView() {
  return (
    <FullState
      title="Nothing here"
      text="The address may be old or mistyped."
      action={
        <a className="btn" href="/app">
          Go to Team
        </a>
      }
    />
  );
}
