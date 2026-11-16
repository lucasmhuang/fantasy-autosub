import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { elementsByTag, renderMarkup } from "../test-support";
import { PlayerFace } from "./player-face";
import { nbaTeamKey, teamStyle } from "./team";

describe("PlayerFace", () => {
  it("shows the headshot as decoration, the name beside it being its text", () => {
    const html = renderMarkup(
      <PlayerFace
        image={{ src: "/_next/image?w=256", srcSet: "/a 1x, /b 2x", sizes: "158px" }}
        className="hs"
      />
    );

    expect(elementsByTag(html, "img")).toEqual([
      {
        tag: "img",
        attributes: {
          class: "hs",
          src: "/_next/image?w=256",
          srcset: "/a 1x, /b 2x",
          sizes: "158px",
          alt: "",
        },
      },
    ]);
  });

  it("loads the headshot as the web asked: lazily, or eagerly for the face that paints first", () => {
    const lazy = renderMarkup(<PlayerFace image={{ src: "/a", loading: "lazy" }} />);
    const eager = renderMarkup(<PlayerFace image={{ src: "/a", loading: "eager" }} />);

    expect(elementsByTag(lazy, "img")[0]?.attributes.loading).toBe("lazy");
    expect(elementsByTag(eager, "img")[0]?.attributes.loading).toBe("eager");
  });

  it("draws the silhouette where the photo would sit when there is none, spoken as no headshot", () => {
    const html = renderMarkup(<PlayerFace className="hs" />);

    expect(elementsByTag(html, "img")).toEqual([]);
    expect(elementsByTag(html, "svg")[0]?.attributes).toMatchObject({
      class: "hs sil",
      viewbox: "0 0 600 436",
      role: "img",
      "aria-label": "No headshot yet",
    });
  });
});

describe("teamStyle", () => {
  it("gives every team the system has a colour for its ground, and a free agent none", () => {
    const tokens = readFileSync(
      new URL("../../vendor/design-system-v17/tokens.css", import.meta.url),
      "utf8"
    );
    const teams = [...tokens.matchAll(/--team-([a-z]+):/g)].map(([, team = ""]) => team);

    expect(teams.length).toBe(30);
    for (const team of teams) {
      expect(teamStyle(team.toUpperCase())).toEqual({ "--team": `var(--team-${team})` });
    }
    expect(teamStyle("FA")).toBeUndefined();
    expect(teamStyle(undefined)).toBeUndefined();
  });

  it("names a team by its lowercased ESPN abbreviation, and a free agent or unknown team not at all", () => {
    expect(nbaTeamKey("GS")).toBe("gs");
    expect(nbaTeamKey("Utah")).toBe("utah");
    expect(nbaTeamKey("FA")).toBeNull();
    expect(nbaTeamKey("XYZ")).toBeNull();
    expect(nbaTeamKey(null)).toBeNull();
  });
});
