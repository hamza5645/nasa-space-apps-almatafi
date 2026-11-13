import type { Metadata } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Game from "@/components/game/Game";
import type { Sheets } from "@/components/game/Sprite";
import { fireWeek, gameDocs } from "@/lib/content";
import { buildChapters, type MapShots } from "@/lib/game";

export const metadata: Metadata = {
  title: "Normal or not?",
  description: "A five-chapter game on real NASA fire records: what a hotspot is, why two satellites disagree, and how to tell a strange fire season from a normal one.",
};

function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function json<T>(...parts: string[]): T | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), "public", ...parts), "utf8")) as T; } catch { return null; }
}

// Built here, at build time, from the committed offline copy (public/cache/), the globe's real
// FIRMS week and the explorer snapshots (public/game/maps/), so the game ships with its numbers.
export default function PlayPage() {
  const w = fireWeek();
  const week = w ? { dates: [day(w.dates[0]), `${day(w.dates[1])} 2026`] as [string, string],
                     modis: w.sensors.modis.detections, viirs: w.sensors.viirs.detections } : null;
  const chapters = buildChapters(gameDocs(), week, json<MapShots>("game", "maps", "maps.json") ?? {});
  const sheets = json<Sheets>("game", "sprites", "sprites.json");
  if (!sheets) throw new Error("public/game/sprites/sprites.json is missing: run design/sprites/process.py");
  // X36: the Higgsfield street plates (design/higgsfield: game_street, game_street_tall), when generated.
  const plate = { wide: existsSync(join(process.cwd(), "public", "media", "game-street.webp")), tall: existsSync(join(process.cwd(), "public", "media", "game-street-tall.webp")) };
  return <Game chapters={chapters} sheets={sheets} plate={plate.wide ? plate : null} />;
}
