import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { CheckRow, PickRows, RadioRows, SelectField, TextAreaField, TextField } from "./form-field";

describe("TextField", () => {
  it("labels the field and ties its hint to it", () => {
    const html = renderMarkup(
      <TextField id="email" label="Email" hint="The address your commissioner registered." />
    );

    expect(elementsByTag(html, "label")[0]?.attributes.for).toBe("email");
    expect(elementsByTag(html, "input")[0]?.attributes).toMatchObject({
      class: "input",
      id: "email",
      "aria-describedby": "email-hint",
    });
    expect(elementsWithClass(html, "hint")[0]?.attributes.id).toBe("email-hint");
  });

  it("puts an error at the field, marks the field, and keeps what was typed", () => {
    const html = renderMarkup(
      <TextField
        id="code"
        label="6-digit code"
        code
        defaultValue="481 207"
        error="Wrong code. 3 tries left."
        hint="Not there? Check Junk."
      />
    );

    expect(elementsByTag(html, "input")[0]?.attributes).toMatchObject({
      "aria-invalid": "true",
      "aria-describedby": "code-error code-hint",
      value: "481 207",
    });
    expect(elementsWithClass(html, "field-error")[0]?.attributes.id).toBe("code-error");
    expect(textOf(html)).toBe("6-digit codeWrong code. 3 tries left.Not there? Check Junk.");
  });

  it("makes the code field the system's one-time-code field", () => {
    const html = renderMarkup(<TextField id="code" label="6-digit code" code />);

    expect(elementsByTag(html, "input")[0]?.attributes).toMatchObject({
      class: "input code",
      inputmode: "numeric",
      autocomplete: "one-time-code",
    });
  });
});

describe("SelectField", () => {
  it("offers each option under its label", () => {
    const html = renderMarkup(
      <SelectField
        id="team"
        label="Team"
        options={[
          { value: "7", label: "Glass Cannons · Dana" },
          { value: "8", label: "Pick & Roll Call · Lee" },
        ]}
      />
    );

    expect(elementsByTag(html, "select")[0]?.attributes).toMatchObject({
      class: "input select",
      id: "team",
    });
    expect(elementsByTag(html, "option").map(({ attributes }) => attributes.value)).toEqual([
      "7",
      "8",
    ]);
  });
});

describe("TextAreaField", () => {
  it("counts what is written against its limit", () => {
    const html = renderMarkup(
      <TextAreaField
        id="note"
        label="Note"
        name="note"
        maxLength={500}
        defaultValue="Dana texted."
      />
    );

    expect(elementsByTag(html, "textarea")[0]?.attributes).toMatchObject({
      class: "input textarea",
      maxlength: "500",
    });
    expect(elementsWithClass(html, "counter")).toHaveLength(1);
    expect(textOf(html)).toBe("NoteDana texted.12 of 500");
  });
});

describe("RadioRows", () => {
  it("groups the choices under a legend, each with its description", () => {
    const html = renderMarkup(
      <RadioRows
        legend="Embiid's status when Dana asked"
        name="status"
        options={[
          { value: "OUT", label: "OUT", description: "As ESPN showed it then.", checked: true },
          { value: "SUSPENSION", label: "Suspended" },
        ]}
      />
    );

    expect(elementsWithClass(html, "fieldset")[0]?.tag).toBe("fieldset");
    expect(elementsByTag(html, "legend")[0]?.attributes.class).toBe("t-label");
    expect(elementsByTag(html, "input").map(({ attributes }) => attributes)).toEqual([
      { type: "radio", name: "status", value: "OUT", checked: "" },
      { type: "radio", name: "status", value: "SUSPENSION" },
    ]);
    expect(elementsWithClass(html, "radio-row")).toHaveLength(2);
    expect(elementsWithClass(html, "d")).toHaveLength(1);
  });
});

describe("RadioRows with what's wrong", () => {
  it("puts the error and the hint under the choices, read out with the group", () => {
    const html = renderMarkup(
      <RadioRows
        id="game"
        legend="Reid's game when Dana asked"
        name="replacementGame"
        hint="Checked against the tip time."
        error="His game had started by then (4:30 PM PT)."
        options={[{ value: "not_started", label: "Hadn't started", checked: true }]}
      />
    );

    expect(elementsByTag(html, "fieldset")[0]?.attributes).toMatchObject({
      id: "game",
      "aria-invalid": "true",
      "aria-describedby": "game-error game-hint",
    });
    expect(elementsWithClass(html, "field-error")[0]?.attributes.id).toBe("game-error");
    expect(textOf(html)).toBe(
      "Reid's game when Dana askedHadn't startedHis game had started by then (4:30 PM PT).Checked against the tip time."
    );
    expect(elementsWithClass(html, "hint")[0]?.attributes.id).toBe("game-hint");
  });
});

const row = (name: string) => ({
  slot: "C",
  name,
  team: "PHI",
  meta: "PHI · C · ESPN: OUT",
  weekPoints: "82.1",
  average: "30.2",
});

describe("PickRows", () => {
  it("makes each board row a choice, under the group's legend", () => {
    const html = renderMarkup(
      <PickRows
        id="injured"
        legend="Injured starter"
        name="injured"
        rows={[
          { value: "3059318", row: row("Joel Embiid"), checked: true },
          { value: "1966", row: row("Devin Booker") },
        ]}
      />
    );

    expect(elementsByTag(html, "legend")[0]?.attributes.class).toBe("t-label");
    expect(elementsWithClass(html, "rows")).toHaveLength(1);
    expect(elementsWithClass(html, "pick")).toHaveLength(2);
    expect(elementsByTag(html, "input").map(({ attributes }) => attributes)).toEqual([
      { type: "radio", name: "injured", value: "3059318", checked: "" },
      { type: "radio", name: "injured", value: "1966" },
    ]);
    expect(elementsWithClass(html, "row")).toHaveLength(2);
    expect(html.indexOf('type="radio"')).toBeLessThan(html.indexOf('class="row"'));
  });

  it("says what's wrong under the rows, read out with the group", () => {
    const html = renderMarkup(
      <PickRows
        id="replacement"
        legend="Replacement from the bench"
        name="replacement"
        error="Choose the replacement."
        rows={[{ value: "4432194", row: row("Day'Ron Sharpe") }]}
      />
    );

    expect(elementsByTag(html, "fieldset")[0]?.attributes).toMatchObject({
      id: "replacement",
      "aria-invalid": "true",
      "aria-describedby": "replacement-error",
    });
    expect(textOf(html)).toContain("Choose the replacement.");
  });
});

describe("CheckRow", () => {
  it("is a checkbox with its label and a quieter note", () => {
    const html = renderMarkup(
      <CheckRow name="team" value="7" label="Glass Cannons" note="Dana" defaultChecked />
    );

    expect(elementsWithClass(html, "check")[0]?.tag).toBe("label");
    expect(elementsByTag(html, "input")[0]?.attributes).toEqual({
      type: "checkbox",
      name: "team",
      value: "7",
      checked: "",
    });
    expect(textOf(html)).toBe("Glass Cannons · Dana");
  });

  it("can be bold, with no note", () => {
    const html = renderMarkup(<CheckRow label="All teams" strong />);

    expect(elementsByTag(html, "b")).toHaveLength(1);
    expect(textOf(html)).toBe("All teams");
  });
});
