import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const HEADSHOT = "https://a.espncdn.com/i/headshots/nba/players/full/4065648.png";
const PHOTO = readFileSync(new URL("../../../public/icon-192.png", import.meta.url));

function ask(playerId: string) {
  return GET(new Request(`http://localhost/faces/${playerId}`), {
    params: Promise.resolve({ playerId }),
  });
}

function espnAnswers(response: () => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function isSilhouette(response: Response) {
  const body = Buffer.from(await response.arrayBuffer());
  const { width, height, format } = await sharp(body).metadata();
  return format === "png" && width === 600 && height === 436;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /faces/[playerId]", () => {
  it("passes ESPN's headshot through, cached for a day, setting no cookie", async () => {
    const fetch = espnAnswers(
      () => new Response(PHOTO, { status: 200, headers: { "content-type": "image/png" } })
    );

    const response = await ask("4065648");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(HEADSHOT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer()).equals(PHOTO)).toBe(true);
  });

  it("answers the silhouette for a player ESPN has no headshot for, cached for a day", async () => {
    espnAnswers(() => new Response("<html>not found</html>", { status: 404 }));

    const response = await ask("4065648");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await isSilhouette(response)).toBe(true);
  });

  it("answers the silhouette for a minute when ESPN fails or isn't an image", async () => {
    for (const failure of [
      () => new Response("down", { status: 503 }),
      () =>
        new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => Promise.reject(new TypeError("fetch failed")),
      // The answer's headers arrive, then the body times out.
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("The operation timed out.", "TimeoutError"));
            },
          }),
          { status: 200, headers: { "content-type": "image/png" } }
        ),
    ]) {
      espnAnswers(failure);

      const response = await ask("4065648");

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=60");
      expect(await isSilhouette(response)).toBe(true);
    }
  });

  it("refuses a path that isn't a player id without asking ESPN", async () => {
    const fetch = espnAnswers(() => new Response(PHOTO, { status: 200 }));

    for (const playerId of ["", "abc", "12a", "..", "1".repeat(13)]) {
      expect((await ask(playerId)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
