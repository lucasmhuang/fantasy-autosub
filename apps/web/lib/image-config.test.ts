import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import { describe, expect, it } from "vitest";
import { IMAGE_CONFIG } from "./image-config";

const remote = (url: string) => hasRemoteMatch([], IMAGE_CONFIG.remotePatterns, new URL(url));
const local = (path: string) => hasLocalMatch(IMAGE_CONFIG.localPatterns, path);

describe("the image optimizer's sources", () => {
  it("takes ESPN's NBA team logos from its CDN", () => {
    expect(remote("https://a.espncdn.com/i/teamlogos/nba/500/gs.png")).toBe(true);
    expect(remote("https://a.espncdn.com/i/teamlogos/nba/500/utah.png")).toBe(true);
  });

  it("takes nothing else from anywhere remote, headshots included", () => {
    expect(remote("https://a.espncdn.com/i/headshots/nba/players/full/4065648.png")).toBe(false);
    expect(remote("http://a.espncdn.com/i/teamlogos/nba/500/gs.png")).toBe(false);
    expect(remote("https://a.espncdn.com.example.com/i/teamlogos/nba/500/gs.png")).toBe(false);
    expect(remote("https://a.espncdn.com/i/teamlogos/nfl/500/gs.png")).toBe(false);
    expect(remote("https://example.com/i/teamlogos/nba/500/gs.png")).toBe(false);
  });

  it("takes only the faces route from the app itself", () => {
    expect(local("/faces/4065648")).toBe(true);
    expect(local("/icon-512.png")).toBe(false);
    expect(local("/faces/4065648?x=1")).toBe(false);
  });
});
