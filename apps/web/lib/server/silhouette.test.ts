import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { silhouettePng } from "./silhouette";

const tokens = readFileSync(
  new URL("../../../../packages/ui/vendor/design-system-v17/tokens.css", import.meta.url),
  "utf8"
);

function tokenRgb(name: string): [number, number, number] {
  const hex = new RegExp(`${name}:\\s*#([0-9a-f]{6});`, "i").exec(tokens)?.[1];
  if (!hex) throw new Error(`tokens.css has no ${name}`);
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + info.channels)];
}

describe("silhouettePng", () => {
  it("draws the system's head and shoulders: its text colour at 20% on nothing", async () => {
    const png = await silhouettePng();
    const [r, g, b] = tokenRgb("--text");

    // The head's centre, then a corner outside the figure.
    const [hr, hg, hb, ha] = await pixel(png, 300, 150);
    expect([hr, hg, hb]).toEqual([r, g, b]);
    expect(ha).toBeGreaterThanOrEqual(50);
    expect(ha).toBeLessThanOrEqual(52);
    expect((await pixel(png, 5, 5))[3]).toBe(0);
  });
});
