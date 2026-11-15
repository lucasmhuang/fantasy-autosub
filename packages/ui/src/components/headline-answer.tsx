import { cn } from "../lib/cn";

export type HeadlineAnswerProps = {
  // Starters designated OUT, and starters suspended.
  out: number;
  suspended: number;
  // What can be done, and that ESPN can lag.
  sentence: string;
  id?: string;
};

function answer(out: number, suspended: number): { words: string; tone: string | null } {
  if (out > 0) {
    return { words: out === 1 ? "1 starter is OUT" : `${out} starters are OUT`, tone: "is-out" };
  }
  if (suspended > 0) {
    return {
      words: suspended === 1 ? "1 starter is suspended" : `${suspended} starters are suspended`,
      tone: "is-susp",
    };
  }
  return { words: "No starters are OUT", tone: null };
}

// The board's answer to "do I have a problem?". With only suspended starters it never says
// none are OUT above a card that offers a request.
export function HeadlineAnswer({
  out,
  suspended,
  sentence,
  id = "board-headline",
}: HeadlineAnswerProps) {
  const { words, tone } = answer(out, suspended);
  return (
    <section className="headline" aria-labelledby={id}>
      <h1 id={id} className={cn("t-headline", tone)}>
        {words}
      </h1>
      <p>{sentence}</p>
    </section>
  );
}
