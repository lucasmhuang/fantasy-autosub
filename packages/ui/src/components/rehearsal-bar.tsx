// The environment's bar, on every page and never dismissible. Rehearsal: a run that sends
// nothing to ESPN. Practice: staging, whose swaps go to a practice copy of ESPN.
const BARS = {
  rehearsal: { title: "Rehearsal", sentence: "Nothing here is sent to ESPN." },
  practice: {
    title: "Practice",
    sentence: "Swaps go to a practice copy of ESPN, never the real one.",
  },
} as const;

export type RehearsalBarProps = { mode: keyof typeof BARS };

export function RehearsalBar({ mode }: RehearsalBarProps) {
  const { title, sentence } = BARS[mode];
  return (
    <div className="rehearsal" role="note">
      <b>{title}</b>
      <span>{sentence}</span>
    </div>
  );
}
