// The app's mark (step 6's icon A) beside its name: two cards, the starter ruled out and the one
// coming in, in the system's colours. For the eye only; the name beside it says what it is. It
// takes the size of the name's type.
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="180 170 660 680" aria-hidden="true" focusable="false">
      <g transform="rotate(-12 418 462)">
        <rect x="248" y="227" width="340" height="470" rx="44" fill="var(--out-frame)" />
      </g>
      <g transform="rotate(7 602 566)">
        <rect x="432" y="331" width="340" height="470" rx="44" fill="var(--primary)" />
        <rect x="462" y="679" width="280" height="92" rx="16" fill="var(--ground)" />
      </g>
    </svg>
  );
}
