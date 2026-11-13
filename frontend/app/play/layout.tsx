import { Pixelify_Sans } from "next/font/google";

// The game's pixel display font, loaded only on /play (the characters are pixel art).
const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-pixel" });

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${pixel.variable} play-root`}>{children}</div>;
}
