import * as React from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";

// The look of the pages built before the design system, kept until no page uses it.
const intentClasses = {
  primary:
    "bg-[color:var(--accent)] text-slate-950 hover:opacity-92 shadow-[0_12px_40px_rgba(124,224,195,0.24)]",
  ghost: "border border-white/10 bg-white/4 text-[color:var(--foreground)] hover:bg-white/8",
} as const;

const sizeClasses = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

const LEGACY_BASE =
  "inline-flex items-center justify-center rounded-full font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50";

// The design system's buttons: the screen's one primary, Confirm (the only one that writes to
// ESPN), and the secondary, ghost and quiet ways out.
const variantClasses = {
  primary: "btn",
  confirm: "btn btn-l",
  secondary: "btn-sec",
  ghost: "btn-ghost",
  quiet: "btn-quiet",
} as const;

export type ButtonVariant = keyof typeof variantClasses;

type DesignProps = {
  variant: ButtonVariant;
  // A ghost button back to the previous screen: chevron first.
  back?: boolean;
  // A primary that opens the next step: chevron last.
  next?: boolean;
  icon?: IconName;
  // Set once tapped: the button is marked busy and says what is happening instead of its label.
  busyLabel?: string;
  intent?: never;
  size?: never;
};

type LegacyProps = {
  variant?: never;
  back?: never;
  next?: never;
  icon?: never;
  busyLabel?: never;
  intent?: keyof typeof intentClasses;
  size?: keyof typeof sizeClasses;
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
} & (DesignProps | LegacyProps);

type DesignContent = Pick<DesignProps, "back" | "next" | "icon" | "busyLabel">;

function designContent(
  { back, next, icon, busyLabel }: DesignContent,
  label: React.ReactNode
): React.ReactNode {
  if (busyLabel) {
    return (
      <span className="lbl-wrap">
        <span className="spin-ink" aria-hidden="true" />
        {busyLabel}
      </span>
    );
  }
  return (
    <>
      {back && <Icon name="chevron-left" size={20} className="ico" />}
      {icon && <Icon name={icon} className="ico" />}
      {label}
      {next && <Icon name="chevron-right" size={18} className="ico" />}
    </>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, asChild = false, children, variant, back, next, icon, busyLabel, ...rest },
  ref
) {
  const { intent = "primary", size = "md", ...props } = rest;
  const classes = variant
    ? cn(variantClasses[variant], back && "is-back", className)
    : cn(LEGACY_BASE, intentClasses[intent], sizeClasses[size], className);
  const content = (label: React.ReactNode) =>
    variant ? designContent({ back, next, icon, busyLabel }, label) : label;

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }>;

    return React.cloneElement(child, {
      className: cn(classes, child.props.className),
      children: content(child.props.children),
    });
  }

  return (
    <button ref={ref} className={classes} aria-busy={busyLabel ? true : undefined} {...props}>
      {content(children)}
    </button>
  );
});
