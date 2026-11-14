// npm run cache: copy the backend's demo-region cache (python -m app.cache → data/cache/)
// into public/cache/, which the landing, Method and game pages read at build time. Commit the result:
// a deploy can't see data/. Rerun after every data change (mock now, real data from Nov 13).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const src = "../data/cache";
if (!existsSync(`${src}/index.json`)) {
  console.error(`No ${src}/index.json. Build it first: cd ../backend && python -m app.cache`);
  process.exit(1);
}
rmSync("public/cache", { recursive: true, force: true });
mkdirSync("public/cache", { recursive: true });
for (const f of readdirSync(src).filter((f) => f.endsWith(".json"))) copyFileSync(`${src}/${f}`, `public/cache/${f}`);
console.log(`copied ${readdirSync("public/cache").length} files to public/cache/`);
