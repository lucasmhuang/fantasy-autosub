import { cn } from "../lib/cn";

// A headshot as the web builds it (an optimizer URL and its candidates), so this package
// imports nothing from Next.
export type FaceImage = {
  src: string;
  srcSet?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
};

export type PlayerFaceProps = {
  image?: FaceImage | null;
  className?: string;
};

export const SILHOUETTE_PATH =
  "M212 150a88 104 0 1 0 176 0a88 104 0 1 0-176 0zM258 236h84v50h-84zM60 436c10-96 100-144 198-156h84c98 12 188 60 198 156z";

// The cut-out headshot, decorative since the name is always written beside it. Without one,
// a drawn head and shoulders sits where the photo would, the same size as the photos.
export function PlayerFace({ image, className }: PlayerFaceProps) {
  if (image) {
    return (
      <img
        className={className}
        src={image.src}
        srcSet={image.srcSet}
        sizes={image.sizes}
        loading={image.loading}
        alt=""
      />
    );
  }
  return (
    <svg
      className={cn(className, "sil")}
      viewBox="0 0 600 436"
      role="img"
      aria-label="No headshot yet"
    >
      <path d={SILHOUETTE_PATH} />
    </svg>
  );
}
