import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const marker = localFont({
  src: "./fonts/PermanentMarker-400.woff2",
  variable: "--font-marker",
  weight: "400",
  display: "swap",
});

const hand = localFont({
  src: "./fonts/PatrickHand-400.woff2",
  variable: "--font-hand",
  weight: "400",
  display: "swap",
});

const handSC = localFont({
  src: "./fonts/PatrickHandSC-400.woff2",
  variable: "--font-hand-sc",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ULTIMATE ROULETTE — 2.5D Doodle Russian Roulette",
  description:
    "A first-person 2.5D doodle Russian roulette game. Fate dice, a revolver, and one room full of tension.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b0a08",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${marker.variable} ${hand.variable} ${handSC.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
