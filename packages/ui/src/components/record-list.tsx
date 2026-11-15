import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

// An event, oldest first: its time in the reader's zone ("6:41 PM PT", or "Wed 6:41 PM PT" once
// the record spans days), and a sentence naming who acted.
export type RecordEvent = { time: string; text: ReactNode };

export type RecordListProps = {
  events: RecordEvent[];
  title?: string;
  // Behind a "Full record · N events" disclosure.
  collapsed?: boolean;
  id?: string;
};

const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/;

function Events({ events }: { events: RecordEvent[] }) {
  // Once any time carries its weekday, every row takes the wider time column, so they align.
  const spansDays = events.some(({ time }) => WEEKDAY.test(time));
  return (
    <div>
      {events.map((event, index) => (
        <div key={`${index}-${event.time}`} className={cn("ev", spansDays && "is-days")}>
          <span className="t">{event.time}</span>
          <span>{event.text}</span>
        </div>
      ))}
    </div>
  );
}

// The request's permanent record: every event in order, in sentences that settle a dispute.
export function RecordList({
  events,
  title = "Record",
  collapsed = false,
  id = "record",
}: RecordListProps) {
  if (collapsed) {
    return (
      <details className="group" aria-label="Full record">
        <summary className="disclosure list-none [&::-webkit-details-marker]:hidden">
          <span className="t-label">Full record · {events.length} events</span>
          <Icon name="chevron-down" size={18} className="ico group-open:rotate-180" />
        </summary>
        <Events events={events} />
      </details>
    );
  }
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="t-label mb-(--space-4)">
        {title}
      </h2>
      <Events events={events} />
    </section>
  );
}
