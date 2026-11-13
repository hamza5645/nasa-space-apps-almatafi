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

// X37: the saved accessibility settings reach <html> before the first paint (no flash of the
// normal theme for someone on high contrast). The same attributes as lib/a11y.ts's htmlAttributes.
const A11Y_BOOT = `try{var s=JSON.parse(localStorage.getItem("almatafi-a11y-v1")||"null");if(s&&s.on){var h=document.documentElement;h.setAttribute("data-a11y","on");if([115,130,150].indexOf(s.text)>=0)h.setAttribute("data-a11y-text",String(s.text));if(s.contrast)h.setAttribute("data-a11y-contrast","high");if(s.motion)h.setAttribute("data-a11y-motion","reduce");if(s.keys!==false)h.setAttribute("data-a11y-keys","on");if(s.voice!==false)h.setAttribute("data-a11y-voice","on")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${body.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: A11Y_BOOT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
