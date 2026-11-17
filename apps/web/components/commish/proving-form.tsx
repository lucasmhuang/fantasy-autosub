"use client";

import { Button, SelectField } from "@injurysub/ui";
import { useState } from "react";
import type { ProvingChoices, ProvingOption } from "../../lib/server/proving";
import { chosenOption } from "./proving-state";

type Found = Extract<ProvingChoices, { status: "found" }>;

const KIND_WORDS: Record<ProvingOption["kind"], string> = {
  direct_swap: "direct swap",
  one_move: "one move",
};

// The starter to test with: choosing one loads its bench options.
export function ProvingStarterPicker({ choices }: { choices: Found }) {
  return (
    <form method="get" action="/commish/proving">
      <SelectField
        id="starter"
        name="starter"
        label="Starter"
        defaultValue={choices.chosen === null ? "" : String(choices.chosen)}
        options={[
          ...(choices.chosen === null ? [{ value: "", label: "Choose a starter" }] : []),
          ...choices.starters.map((starter) => ({
            value: String(starter.playerId),
            label: `${starter.name} · ${starter.slot}`,
          })),
        ]}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>
  );
}

// FS-PROVING-3: the bench player and the run's filing. It posts the chosen option's edit and the
// matchup period as the page showed them, which filing checks against ESPN (R4).
export function ProvingFileForm(props: {
  injured: number;
  options: ProvingOption[];
  period: number;
  idempotencyKey: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const option = chosenOption(props.options, picked);
  if (option === null) {
    return (
      <p className="text-[14px] text-text-2">
        No bench player can come in for him with at most one other starter moving.
      </p>
    );
  }
  return (
    <form method="post" action="/commish/proving/file" className="stack-12">
      <input type="hidden" name="injured" value={props.injured} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <input type="hidden" name="edit" value={option.digest} />
      <input type="hidden" name="period" value={props.period} />
      <SelectField
        id="bench"
        name="replacement"
        label="Bench player"
        hint="A direct swap first; the second run needs one that moves another starter."
        value={String(option.playerId)}
        onChange={(event) => setPicked(event.currentTarget.value)}
        options={props.options.map((each) => ({
          value: String(each.playerId),
          label: `${each.name} · ${KIND_WORDS[each.kind]}`,
        }))}
      />
      <Button type="submit" variant="confirm">
        File and run proving · +0.1 test
      </Button>
    </form>
  );
}
