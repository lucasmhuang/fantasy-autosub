// The vendored Inter file, which tokens.css's @font-face also names. The bundler resolves both
// to the same emitted asset, so a page can preload the file its stylesheet will ask for.
export const interFontHref = new URL(
  "../vendor/design-system-v17/fonts/InterVariable.woff2",
  import.meta.url
).href;
