import { SILHOUETTE_PATH } from "@injurysub/ui";
import sharp from "sharp";

// The system's drawn head and shoulders (`.sil`: the text colour at 20%, on nothing), as the PNG
// the faces route answers when ESPN has no headshot. Drawn once per process. The figure is drawn
// opaque and its alpha scaled afterwards, since drawing it at 20% rounds the colour off.
const TEXT = "#ededee";
const OPACITY = 0.2;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="436" viewBox="0 0 600 436"><path fill="${TEXT}" d="${SILHOUETTE_PATH}"/></svg>`;

let drawing: Promise<Buffer> | undefined;

async function draw(): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(SVG))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    data[alpha] = Math.round((data[alpha] ?? 0) * OPACITY);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

export function silhouettePng(): Promise<Buffer> {
  drawing ??= draw();
  return drawing;
}
