import { describe, expect, it } from "vitest";
import { faceImageProps, logoImageProps } from "./images";

const optimized = (path: string) => `/_next/image?url=${encodeURIComponent(path)}`;

describe("faceImageProps", () => {
  it("serves a player's headshot through the optimizer from the app's faces route", () => {
    const face = faceImageProps("4065648", 72);

    expect(face?.src.startsWith(optimized("/faces/4065648"))).toBe(true);
    expect(face?.srcSet).toMatch(/ 1x, .* 2x$/);
    expect(face?.srcSet).not.toContain("espncdn");
  });

  it("loads lazily unless the face is asked for eagerly", () => {
    expect(faceImageProps("4065648", 72)?.loading).toBe("lazy");
    expect(faceImageProps("4065648", 256, { eager: true })?.loading).toBe("eager");
  });

  it("draws a preloaded face lazily, so a re-render in place never waits on it", () => {
    expect(faceImageProps("4065648", 170, { preload: true })?.loading).toBe("lazy");
  });

  it("gives no image for a missing or unusable player id, so the silhouette is drawn", () => {
    expect(faceImageProps(null, 72)).toBeNull();
    expect(faceImageProps(undefined, 72)).toBeNull();
    expect(faceImageProps("", 72)).toBeNull();
    expect(faceImageProps("12a", 72)).toBeNull();
    expect(faceImageProps("../x", 72)).toBeNull();
  });
});

describe("logoImageProps", () => {
  it("serves an NBA team's logo through the optimizer, by ESPN's abbreviation", () => {
    const logo = logoImageProps("GS", 42);

    expect(logo?.startsWith(optimized("https://a.espncdn.com/i/teamlogos/nba/500/gs.png"))).toBe(
      true
    );
  });

  it("gives none for a free agent or a team it doesn't know", () => {
    expect(logoImageProps("FA", 42)).toBeNull();
    expect(logoImageProps(null, 42)).toBeNull();
    expect(logoImageProps("XYZ", 42)).toBeNull();
  });
});
