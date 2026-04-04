import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const textFont = Manrope({
  subsets: ["latin"],
  variable: "--font-text"
});

const displayFont = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display-face"
});

export const metadata: Metadata = {
  title: "InjurySub",
  description:
    "Premium workflow tooling for ESPN fantasy injury substitutions."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${textFont.variable} ${displayFont.variable} antialiased`}>
        <div className="background-grid" />
        <div className="background-glow background-glow-left" />
        <div className="background-glow background-glow-right" />
        {children}
      </body>
    </html>
  );
}
