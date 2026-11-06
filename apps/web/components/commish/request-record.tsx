import { formatReadTime } from "../requests/format";

type RecordProps = {
  events: { eventType: string; actorType: string; createdAt: Date; payload: unknown }[];
  snapshots: { phase: string; espnDay: number; takenAt: Date }[];
};

// The request's audit record (H2): every action and every ESPN snapshot, oldest first.
export function RequestRecord({ events, snapshots }: RecordProps) {
  return (
    <section className="text-sm">
      <h3 className="text-base font-medium">Record</h3>
      <ul className="mt-2 grid gap-1">
        {events.map((event) => (
          <li key={`${event.eventType}-${event.createdAt.toISOString()}`} className="break-words">
            {formatReadTime(event.createdAt.toISOString())} · {event.actorType} ·{" "}
            {event.eventType.replaceAll("_", " ")}
            {payloadNote(event.payload)}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[color:var(--muted)]">
        ESPN snapshots:{" "}
        {snapshots
          .map((each) => `${each.phase.replaceAll("_", " ")} (day ${each.espnDay})`)
          .join(", ")}
      </p>
    </section>
  );
}

// A commissioner's typed reason, when the event carries one.
function payloadNote(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("reason" in payload)) return "";
  return typeof payload.reason === "string" ? `: ${payload.reason}` : "";
}
