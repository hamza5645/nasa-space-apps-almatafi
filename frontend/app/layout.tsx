import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

// One family: Archivo's width axis gives the wide display cuts and the normal text cut.
const body = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
// The editorial italic for the one word in a headline that carries the question.
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif" });

export const metadata: Metadata = {
  title: { default: "Almatafi · Is this fire season normal?", template: "%s · Almatafi" },
  description:
    "25 years of NASA FIRMS fire detections from MODIS and VIIRS, merged into one consistent record. Pick any area and see its burning calendar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
