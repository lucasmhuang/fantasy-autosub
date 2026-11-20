"use client";

import {
  type BoardRowProps,
  Button,
  Notice,
  PickRows,
  RadioRows,
  SelectField,
  StatusPanel,
  TextAreaField,
  TextField,
} from "@injurysub/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { FilingField } from "../../lib/filing-fields";
import { FreshTime } from "../shell/fresh-time";
import {
  designationHint,
  type FilingCopyContext,
  type FilingPicked,
  fieldErrorText,
  legendWords,
  problemCount,
  refusalText,
  statusText,
} from "./filing-copy";
import {
  type FilingOutcome,
  type FilingPicks,
  outcomeOf,
  picksOf,
  showsPoints,
} from "./filing-state";

export type FilingChoice = { value: string; name: string; designation: string; row: BoardRowProps };

export type FilingFormProps = {
  copy: FilingCopyContext;
  teamId: number;
  zoneLabel: string;
  idempotencyKey: string;
  readAt: string;
  starters: FilingChoice[];
  bench: FilingChoice[];
  days: { value: string; label: string }[];
  chosenDay: string;
};

const MAX_NOTE = 500;

// The team picker: choosing a team loads its form.
export function TeamPicker(props: {
  teams: { teamId: number; label: string }[];
  chosen: number | null;
  hint: string;
}) {
  return (
    <form method="get" action="/commish/requests/new" className="stack-8">
      <SelectField
        id="team"
        name="team"
        label="Team"
        hint={props.hint}
        defaultValue={props.chosen === null ? "" : String(props.chosen)}
        options={[
          { value: "", label: "Choose a team" },
          ...props.teams.map((team) => ({ value: String(team.teamId), label: team.label })),
        ]}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>
  );
}

// The filing itself (FS-FILE-2 to -6). It posts with fetch and shows the answer in place, so
// nothing typed is lost (IF-FILE-4).
export function FilingForm(props: FilingFormProps) {
  const [picks, setPicks] = useState<FilingPicks>({
    injured: null,
    replacement: null,
    day: props.chosenDay,
    game: "not_started",
  });
  const [outcome, setOutcome] = useState<FilingOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome !== null) top.current?.focus();
  }, [outcome]);

  const starter = props.starters.find((each) => each.value === picks.injured) ?? null;
  const picked: FilingPicked = {
    starter: starter?.name ?? null,
    replacement: props.bench.find((each) => each.value === picks.replacement)?.name ?? null,
    day: picks.day,
  };
  const words = legendWords(picked, props.copy);
  const errors = outcome?.kind === "problems" ? outcome.errors : {};
  const errorAt = (field: FilingField) => {
    const error = errors[field];
    return error === undefined ? undefined : fieldErrorText(error, props.copy, picked);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const next = await post(event.currentTarget);
    if (next.kind === "navigate") {
      window.location.assign(next.to);
      return;
    }
    setOutcome(next);
    setPending(false);
  }

  return (
    <form
      method="post"
      action="/commish/requests/file"
      className="stack-12 file-form"
      noValidate
      onSubmit={submit}
      onChange={(event) => setPicks(picksOf(new FormData(event.currentTarget)))}
    >
      <div ref={top} tabIndex={-1} className="stack-8">
        <Answer outcome={outcome} copy={props.copy} picked={picked} />
      </div>
      <input type="hidden" name="team" value={props.teamId} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <input type="hidden" name="zone" value={props.copy.zone} />
      <PickRows
        id="injured"
        legend="Injured starter"
        name="injured"
        rows={props.starters}
        error={errorAt("injured")}
      />
      <PickRows
        id="replacement"
        legend="Replacement from the bench"
        name="replacement"
        rows={props.bench}
        error={errorAt("replacement")}
      />
      <div className="cols even">
        <SelectField
          id="day"
          name="day"
          label={words.day}
          defaultValue={props.chosenDay}
          options={props.days}
          error={errorAt("day")}
        />
        <TextField
          id="time"
          name="time"
          type="time"
          label={`Time, ${props.zoneLabel}`}
          error={errorAt("time")}
        />
      </div>
      <RadioRows
        legend={words.status}
        name="designation"
        hint={
          starter === null ? undefined : (
            <DesignationHint
              designation={starter.designation}
              readAt={props.readAt}
              zone={props.copy.zone}
            />
          )
        }
        id="designation"
        options={[
          { value: "OUT", label: "OUT", checked: true },
          { value: "SUSPENSION", label: "Suspended" },
        ]}
      />
      <RadioRows
        id="replacementGame"
        legend={words.game}
        name="replacementGame"
        error={errorAt("replacementGame")}
        options={[
          {
            value: "not_started",
            label: "Hadn't started",
            checked: true,
          },
          {
            value: "ended",
            label: "Had ended",
            description: "Nothing after the request can count",
          },
          { value: "in_progress", label: "In progress", description: words.inProgress },
        ]}
      />
      {showsPoints(picks.game) && (
        <PointsFields
          label={words.points}
          hint={words.pointsHint}
          errors={[errorAt("enteredPoints"), errorAt("note")]}
        />
      )}
      <Button
        type="submit"
        variant="primary"
        aria-busy={pending || undefined}
        disabled={pending}
        busyLabel={pending ? "Filing…" : undefined}
      >
        File request
      </Button>
    </form>
  );
}

function PointsFields(props: {
  label: string;
  hint: string;
  errors: [string | undefined, string | undefined];
}) {
  return (
    <>
      <TextField
        id="enteredPoints"
        name="enteredPoints"
        inputMode="decimal"
        label={props.label}
        hint={props.hint}
        error={props.errors[0]}
      />
      <TextAreaField
        id="note"
        name="note"
        label="Note backing the points"
        hint="Required with hand-entered points. Up to 500 characters."
        maxLength={MAX_NOTE}
        rows={3}
        error={props.errors[1]}
      />
    </>
  );
}

// What the route said: how many answers need fixing, the whole form's refusal, or a notice.
function Answer(props: {
  outcome: FilingOutcome | null;
  copy: FilingCopyContext;
  picked: FilingPicked;
}) {
  const { outcome, copy, picked } = props;
  if (outcome === null || outcome.kind === "navigate") return null;
  if (outcome.kind === "notice") {
    return (
      <Notice tone="fail" announce>
        {statusText(outcome.status, copy.team, copy.manager)}
      </Notice>
    );
  }
  return (
    <>
      {outcome.count > 0 && (
        <Notice tone="fail" announce>
          {problemCount(outcome.count)}
        </Notice>
      )}
      {outcome.refusal !== null && (
        <StatusPanel
          tone="neutral"
          word="Refused"
          who="Nothing was filed"
          sentence={refusalText(outcome.refusal, copy, picked) ?? undefined}
        />
      )}
    </>
  );
}

// The route's answer to the form's fetch; a lost connection or an answer it can't read is a
// failure on our side, with everything typed still on the page.
async function post(form: HTMLFormElement): Promise<FilingOutcome> {
  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { accept: "application/json" },
    });
    const contentType = response.headers.get("content-type");
    const body: unknown = (contentType ?? "").includes("application/json")
      ? await response.json()
      : null;
    return outcomeOf({ redirected: response.redirected, url: response.url, contentType, body });
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
    return { kind: "notice", status: "unavailable" };
  }
}

// What ESPN shows of the starter, its read time kept current (FS-TIME-8).
function DesignationHint(props: { designation: string; readAt: string; zone: string }) {
  const words = designationHint(props.designation, props.readAt, props.zone);
  return (
    <>
      {words.before}
      <FreshTime at={props.readAt} time={words.time} />
      {words.after}
    </>
  );
}
