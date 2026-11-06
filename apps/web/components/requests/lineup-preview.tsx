import type { BoardLineupSlot } from "../../lib/server/board";

// The starting lineup the option would leave, every starter in his slot (behaviors D8). A
// <details> element opens without any client code.
export function LineupPreview({ lineup }: { lineup: BoardLineupSlot[] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-[color:var(--muted)]">Resulting lineup</summary>
      <ul className="mt-2 grid gap-1">
        {lineup.map((slot, index) => (
          <li key={`${slot.slot}-${index}`} className="flex gap-3">
            <span className="w-12 shrink-0 text-[color:var(--muted)]">{slot.slot}</span>
            <span>{slot.name ?? "(empty)"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
