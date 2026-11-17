import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { RadioRows, SelectField, TextAreaField, TextField } from "./form-field";

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
