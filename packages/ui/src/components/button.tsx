import * as React from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";

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
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
} & DesignProps;

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
  { className, asChild = false, children, variant, back, next, icon, busyLabel, ...props },
  ref
) {
  const classes = cn(variantClasses[variant], back && "is-back", className);
  const content = (label: React.ReactNode) => designContent({ back, next, icon, busyLabel }, label);

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
