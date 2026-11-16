import type { NextConfig } from "next";

type ImageConfig = NonNullable<NextConfig["images"]>;

// What the image optimizer may fetch: ESPN's NBA team logos, and headshots only through the
// app's own faces route, which answers a silhouette when ESPN has none. The browser never asks
// ESPN for either (FS-IMAGE-5). Each answer's own cache lifetime decides how long the optimizer
// keeps it (a day, or a minute after an ESPN failure), so the minimum stays short.
export const IMAGE_CONFIG = {
  remotePatterns: [
    { protocol: "https", hostname: "a.espncdn.com", pathname: "/i/teamlogos/nba/500/*.png" },
  ],
  localPatterns: [{ pathname: "/faces/*", search: "" }],
  minimumCacheTTL: 60,
} satisfies ImageConfig;
