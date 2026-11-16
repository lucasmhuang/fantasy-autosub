import type { Metadata, Viewport } from "next";

// The design system's ground (tokens.css --ground): a manifest and a meta tag take a literal
// colour, so a test checks this against the token.
export const GROUND = "#0c0c0d";

// Step 6's home-screen spec: the name under the icon, Safari's icon and status bar, and no
// telephone, email or address links detected in the text.
export const metadata: Metadata = {
  title: "InjurySub",
  applicationName: "InjurySub",
  appleWebApp: { capable: true, title: "InjurySub", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

// Drawn under the notch (the shell pads by the safe-area insets), in the ground colour.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: GROUND,
  colorScheme: "dark",
};
