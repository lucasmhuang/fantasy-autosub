import { cn } from "@injurysub/ui";
import type { ReactNode } from "react";

export function Surface({
  className,
  children,
}: Readonly<{
  className?: string;
  children: ReactNode;
}>) {
  return <section className={cn("glass-panel", className)}>{children}</section>;
}
