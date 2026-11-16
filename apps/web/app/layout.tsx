import { Barlow_Condensed, Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// The design system's display face (SemiBold only). Its variable goes on <html>, because the
// theme's :root rule reads it to set --font-display.
const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-barlow-condensed",
});

// The UI face, variable with its optical-size axis like the system's own file. Each script's range
// loads only when a page uses it (a name such as Dončić takes latin-ext); only Latin is preloaded.
// The theme's :root rule reads its variable to set --font-ui.
const uiFont = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-inter",
});

export { metadata, viewport } from "./app-meta";

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${uiFont.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
