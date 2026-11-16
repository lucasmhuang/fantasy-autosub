import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metadata, viewport } from "./app-meta";
import manifest from "./manifest";

const publicDir = new URL("../public/", import.meta.url).pathname;
const tokensPath = new URL(
  "../../../packages/ui/vendor/design-system-v17/tokens.css",
  import.meta.url
).pathname;

// A PNG's width and height, from its IHDR chunk (bytes 16-23).
function pngSize(file: string): string {
  const bytes = readFileSync(`${publicDir}${file.replace(/^\//, "")}`);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

const ground = /--ground:\s*(#[0-9a-f]{6})/i.exec(readFileSync(tokensPath, "utf8"))?.[1];

// FS-HOME-1 to -5: what a phone needs to add InjurySub to its home screen (step 6's spec).
describe("the home-screen app", () => {
  it("is named InjurySub, opens the board standalone, on the system's ground", () => {
    expect(manifest()).toMatchObject({
      name: "InjurySub",
      short_name: "InjurySub",
      start_url: "/app",
      display: "standalone",
      background_color: ground,
      theme_color: ground,
    });
    expect(ground).toBeDefined();
  });

  it("lists icons that exist at the sizes they state", () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => [icon.purpose ?? "any", icon.sizes])).toEqual([
      ["any", "192x192"],
      ["any", "512x512"],
      ["maskable", "512x512"],
      ["any", "any"],
    ]);
    for (const icon of icons.filter((each) => each.type === "image/png")) {
      expect(pngSize(icon.src)).toBe(icon.sizes);
    }
  });

  it("gives Safari its icon, title and status bar, and turns off detected links", () => {
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "InjurySub",
      statusBarStyle: "black-translucent",
    });
    expect(pngSize("/apple-touch-icon.png")).toBe("180x180");
    expect(pngSize("/favicon-32.png")).toBe("32x32");
    expect(metadata.formatDetection).toEqual({ telephone: false, email: false, address: false });
  });

  it("draws under the notch, in the ground colour, dark", () => {
    expect(viewport).toMatchObject({
      viewportFit: "cover",
      themeColor: ground,
      colorScheme: "dark",
    });
  });
});
