import type { FaceImage } from "@injurysub/ui";
import { nbaTeamKey } from "@injurysub/ui";
import { getImageProps } from "next/image";
import { preload } from "react-dom";

// The ratio of ESPN's full headshots (1040 × 760) and of the silhouette drawn in their place.
const FACE_RATIO = 436 / 600;
const PLAYER_ID = /^\d{1,12}$/;

// A player's headshot, through the optimizer from the app's faces route, at the width the
// card or row draws it. Lazy unless asked for eagerly (the face that paints first). A page that
// re-renders in place asks for `preload` instead: the image is fetched early but drawn lazily,
// since React holds a re-render until a newly added eager image loads, and in Next's refresh that
// re-render never commits (R7d-6's walk).
export function faceImageProps(
  playerId: string | null | undefined,
  width: number,
  options: { eager?: boolean; preload?: boolean } = {}
): FaceImage | null {
  if (!playerId || !PLAYER_ID.test(playerId)) return null;
  const { props } = getImageProps({
    src: `/faces/${playerId}`,
    alt: "",
    width,
    height: Math.round(width * FACE_RATIO),
    loading: options.eager ? "eager" : "lazy",
  });
  if (options.preload) preload(props.src, { as: "image", imageSrcSet: props.srcSet });
  return { src: props.src, srcSet: props.srcSet, loading: options.eager ? "eager" : "lazy" };
}

// An NBA team's logo by ESPN's abbreviation, through the optimizer at twice the drawn width;
// none for a free agent.
export function logoImageProps(team: string | null | undefined, width: number): string | null {
  const key = nbaTeamKey(team);
  if (!key) return null;
  const { props } = getImageProps({
    src: `https://a.espncdn.com/i/teamlogos/nba/500/${key}.png`,
    alt: "",
    width: width * 2,
    height: width * 2,
  });
  return props.src;
}
