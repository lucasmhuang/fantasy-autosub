import { silhouettePng } from "../../../lib/server/silhouette";

const PLAYER_ID = /^\d{1,12}$/;
const ESPN_TIMEOUT_MS = 5_000;
const A_DAY = "public, max-age=86400";
const A_MINUTE = "public, max-age=60";

// A player's headshot for the image optimizer, which is this route's only caller that matters:
// ESPN's photo when it has one, else the drawn silhouette, so the browser never gets a broken
// image (FM-IMAGE-1; Safari draws an icon for one). After an ESPN failure the silhouette is kept
// for a minute only.
export async function GET(_request: Request, context: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await context.params;
  if (!PLAYER_ID.test(playerId)) return new Response(null, { status: 404 });

  const photo = await fetchHeadshot(playerId);
  if (photo.kind === "photo") return png(photo.body, A_DAY);
  return png(await silhouettePng(), photo.kind === "none" ? A_DAY : A_MINUTE);
}

type Headshot = { kind: "photo"; body: ArrayBuffer } | { kind: "none" } | { kind: "failed" };

async function fetchHeadshot(playerId: string): Promise<Headshot> {
  const url = `https://a.espncdn.com/i/headshots/nba/players/full/${playerId}.png`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ESPN_TIMEOUT_MS) });
    if (response.status === 404) return { kind: "none" };
    const isPng = response.headers.get("content-type") === "image/png";
    if (!response.ok || !isPng) return { kind: "failed" };
    // The body can still fail or time out after the headers arrive.
    return { kind: "photo", body: await response.arrayBuffer() };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && isTimeout(error))) {
      return { kind: "failed" };
    }
    throw error;
  }
}

function isTimeout(error: DOMException) {
  return error.name === "TimeoutError" || error.name === "AbortError";
}

function png(body: ArrayBuffer | Buffer, cacheControl: string) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": cacheControl },
  });
}
