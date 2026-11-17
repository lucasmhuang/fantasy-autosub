import { Button } from "@injurysub/ui";

// One line of text while it loads: the line's own height in its type style (a no-break space
// sets it), with a bar inside, so the placeholder is exactly as tall as the text that replaces it.
export function LineBar({ className, bar }: { className: string; bar: string }) {
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      {" "}
      <span className={`sk absolute inset-y-[22%] left-0 ${bar}`} />
    </div>
  );
}

// A commissioner page's automation line while it loads.
export function AutomationStripPlaceholder() {
  return (
    <div className="autostrip" aria-hidden="true">
      <LineBar className="lbl grow" bar="w-[70%]" />
    </div>
  );
}

// The way back, which needs no data, so it's real while the page loads.
export function BackBar({
  href,
  label,
  phoneOnly = false,
}: {
  href: string;
  label: string;
  phoneOnly?: boolean;
}) {
  return (
    <nav className={phoneOnly ? "backbar phone-only" : "backbar"}>
      <Button asChild variant="ghost" back>
        <a href={href}>{label}</a>
      </Button>
    </nav>
  );
}
