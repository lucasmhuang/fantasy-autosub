# InjurySub design system, version 17

The design system's CSS and font, copied unedited. `src/vendor.test.ts` checks each file against `SHA256SUMS`, so a hand edit fails CI. Biome skips this folder (`biome.json`), because it would reformat the copies.

- `tokens.css`: the system's `project/tokens.css` (custom properties, the Inter `@font-face`, the type classes).
- `bundle.css`: the system's `project/components/bundle.css` (base rules and every component's classes).
- `fonts/InterVariable.woff2`: the system's `project/fonts/InterVariable.woff2`. It sits beside `tokens.css`, whose `@font-face` names it by a relative `url()`.

The web loads them from `apps/web/app/globals.css`: `tokens.css` into Tailwind's `base` layer and `bundle.css` into `components`, so utilities still win. `src/styles/theme.css` follows them: the colour tokens as Tailwind colours, and `--font-display` pointed at Barlow Condensed from `next/font`.

## Updating to a new version

1. Copy the three files from the new version's `project/` folder into a folder named for that version, keeping the paths above.
2. Regenerate the checksums there: `shasum -a 256 bundle.css fonts/InterVariable.woff2 tokens.css > SHA256SUMS`.
3. Point the imports in `apps/web/app/globals.css`, the paths in `src/vendor.test.ts`, `apps/web/app/theme.test.ts` and `src/fonts.ts`, and the exclusion in `biome.json` at the new folder, then delete the old one.
4. Run `pnpm test`: it fails on a custom property the new CSS reads that nothing defines, a new colour token missing from `theme.css`, or a property `globals.css` also defines.
