import type { Metadata } from "next";
import Game from "@/components/game/Game";
import { fireWeek, gameDocs, hasMedia } from "@/lib/content";
import { buildPool } from "@/lib/game";

export const metadata: Metadata = {
  title: "Normal or not?",
  description: "A seven-question game on real NASA fire records: tell a strange fire season from a normal one, and spot the satellite trap.",
};

function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// The rounds are built here, at build time, from the committed offline copy (public/cache/) and
// the globe's real FIRMS week, so the game ships with its numbers and works offline.
export default function PlayPage() {
  const w = fireWeek();
  const week = w ? { dates: [day(w.dates[0]), `${day(w.dates[1])} 2026`] as [string, string],
                     modis: w.sensors.modis.detections, viirs: w.sensors.viirs.detections } : null;
  const pool = buildPool(gameDocs(), week);
  return (
    <Game pool={pool}
          winScene={hasMedia("game-win.webp") ? "/media/game-win.webp" : "/media/delta-high.webp"}
          loseScene={hasMedia("game-lose.webp") ? "/media/game-lose.webp" : "/media/nile-delta.webp"} />
  );
}
