"use client";

import type { LeagueExecutionMode } from "@injurysub/domain";
import { Button, CheckRow, RadioRows } from "@injurysub/ui";
import { useState } from "react";
import type { SettingsTeam } from "../../lib/server/settings-page";
import { allTicked, teamsHelper, withAllTeams, withTeam } from "./settings-state";

export type SettingsFormProps = {
  mode: LeagueExecutionMode;
  ticked: number[];
  // The shown save's time, so a tab opened before a later change can't overwrite it.
  shownUpdatedAt: string;
  teams: SettingsTeam[];
};

// The mode and the teams automation may act for (FS-SETTINGS-1 to -4). "All teams" and the
// helper follow the form as it changes; the save route reads only the mode and the ticks.
export function SettingsForm(props: SettingsFormProps) {
  const [mode, setMode] = useState(props.mode);
  const [ticked, setTicked] = useState(props.ticked);
  const teamIds = props.teams.map((team) => team.teamId);
  return (
    <form method="post" action="/commish/settings/save" className="stack-12">
      <input type="hidden" name="shownUpdatedAt" value={props.shownUpdatedAt} />
      <div
        className="panel px-(--space-16) py-(--space-12)"
        onChange={(event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.name === "executionMode") {
            setMode(target.value === "auto" ? "auto" : "approval_required");
          }
        }}
      >
        <RadioRows
          legend="Mode"
          name="executionMode"
          options={[
            {
              value: "approval_required",
              label: "Approval required",
              description: "You approve each request before it runs.",
              checked: props.mode === "approval_required",
            },
            {
              value: "auto",
              label: "Auto",
              description: "Requests that move at most one other starter run without you.",
              checked: props.mode === "auto",
            },
          ]}
        />
      </div>
      <div className="panel px-(--space-16) py-(--space-12)">
        <fieldset className="fieldset">
          <legend className="t-label">Teams automation may act for</legend>
          <p className="text-[13px] text-text-meta">{teamsHelper(mode)}</p>
          <CheckRow
            label="All teams"
            strong
            checked={allTicked(ticked, teamIds)}
            onChange={(event) => setTicked(withAllTeams(event.currentTarget.checked, teamIds))}
          />
          {props.teams.map((team) => (
            <CheckRow
              key={team.teamId}
              name="team"
              value={team.teamId}
              label={team.name}
              note={team.manager ?? undefined}
              checked={ticked.includes(team.teamId)}
              onChange={(event) =>
                setTicked(withTeam(ticked, team.teamId, event.currentTarget.checked))
              }
            />
          ))}
        </fieldset>
      </div>
      <p className="text-[13px] text-text-meta">
        Unticking a team also stops its waiting requests before anything is sent.
      </p>
      <Button type="submit" variant="primary">
        Save settings
      </Button>
    </form>
  );
}
