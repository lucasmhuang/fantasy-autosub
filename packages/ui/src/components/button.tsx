import * as React from "react";
import { cn } from "../lib/cn";

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

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  intent?: keyof typeof intentClasses;
  size?: keyof typeof sizeClasses;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, intent = "primary", size = "md", asChild = false, children, ...props },
  ref
) {
  const classes = cn(
    "inline-flex items-center justify-center rounded-full font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50",
    intentClasses[intent],
    sizeClasses[size],
    className
  );

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;

    return React.cloneElement(child, {
      className: cn(classes, child.props.className),
    });
  }

  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
});
