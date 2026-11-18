import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { type HealthCheck, HealthPanel } from "./health-panel";

const ALL_WELL: HealthCheck[] = [
  { name: "ESPN", mark: "ok", state: "Working", when: "checked Wed 6:40 PM PT" },
  { name: "InjurySub", mark: "ok", state: "Running", when: "Wed 6:41 PM PT" },
  { name: "League rules", mark: "ok", state: "Match", when: "checked Wed 6:40 PM PT" },
];

describe("HealthPanel", () => {
  it("is one line while everything works", () => {
    const html = renderMarkup(<HealthPanel checks={ALL_WELL} summaryWhen="Wed 6:41 PM PT" />);

    expect(elementsWithClass(html, "hrow")).toHaveLength(1);
    expect(textOf(html)).toBe("HealthESPN, InjurySub and rulesOK · Wed 6:41 PM PT");
  });

  it("gives every check its own row once one is in trouble, InjurySub apart from ESPN", () => {
    const html = renderMarkup(
      <HealthPanel
        summaryWhen="Wed 6:41 PM PT"
        checks={[
          {
            name: "ESPN",
            mark: "bad",
            state: "Cookie refused",
            when: "Wed 6:31 PM PT",
            detail: "Renew the ESPN cookie on the host.",
          },
          ALL_WELL[1] ?? ALL_WELL[0]!,
          { name: "League rules", mark: "off", state: "Not checked" },
        ]}
      />
    );

    expect(elementsWithClass(html, "hrow").map(({ attributes }) => attributes.class)).toEqual([
      "hrow bad",
      "hrow ok",
      "hrow off",
    ]);
    expect(elementsWithClass(html, "mark")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(elementsWithClass(html, "detail")).toHaveLength(1);
    expect(textOf(html)).toBe(
      "HealthESPNCookie refused · Wed 6:31 PM PTRenew the ESPN cookie on the host.InjurySubRunning · Wed 6:41 PM PTLeague rulesNot checked"
    );
  });

  it("keeps a separate check on its own line after the summary, linked where it says", () => {
    const html = renderMarkup(
      <HealthPanel
        checks={ALL_WELL}
        summaryWhen="Wed 6:41 PM PT"
        separate={{
          name: "Misuse watch",
          mark: "ok",
          state: "Watching",
          when: "checked Wed 6:40 PM PT",
          href: "/commish/alerts",
        }}
      />
    );

    expect(elementsWithClass(html, "hrow").map(({ tag, attributes }) => [tag, attributes])).toEqual(
      [
        ["div", { class: "hrow ok" }],
        ["a", { class: "hrow ok", href: "/commish/alerts" }],
      ]
    );
    expect(textOf(html)).toBe(
      "HealthESPN, InjurySub and rulesOK · Wed 6:41 PM PTMisuse watchWatching · checked Wed 6:40 PM PT"
    );
  });

  it("keeps the separate check last when the others are in trouble too", () => {
    const html = renderMarkup(
      <HealthPanel
        checks={[{ name: "ESPN", mark: "off", state: "Not connected" }]}
        summaryWhen="Wed 6:41 PM PT"
        separate={{ name: "Misuse watch", mark: "bad", state: "Paused", when: "Wed 6:31 PM PT" }}
      />
    );

    expect(elementsWithClass(html, "hrow").map(({ attributes }) => attributes.class)).toEqual([
      "hrow off",
      "hrow bad",
    ]);
  });
});
