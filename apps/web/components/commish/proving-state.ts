import type { ProvingOption } from "../../lib/server/proving";

// The bench player the start form files, by the value picked: the first option until one is.
export function chosenOption(
  options: readonly ProvingOption[],
  picked: string | null
): ProvingOption | null {
  return options.find((option) => String(option.playerId) === picked) ?? options[0] ?? null;
}
