import { interFontHref } from "@injurysub/ui";
import type { Metadata } from "next";
import { Barlow_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import "./globals.css";

// The design system's display face (SemiBold only). Its variable goes on <html>, because the
// theme's :root rule reads it to set --font-display.
const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: "InjurySub",
  description: "Premium workflow tooling for ESPN fantasy injury substitutions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  preload(interFontHref, { as: "font", type: "font/woff2", crossOrigin: "" });
  return (
    <html lang="en" className={displayFont.variable}>
      <body className="antialiased">
        <div className="background-grid" />
        <div className="background-glow background-glow-left" />
        <div className="background-glow background-glow-right" />
        {children}
      </body>
    </html>
  );
}
