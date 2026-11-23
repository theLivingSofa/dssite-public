import { readFileSync } from "node:fs";
import path from "node:path";
import type { SiteQuery } from "../tina/__generated__/types";

const NAMES = ["settings", "hero", "profile", "quote", "timeline", "research", "institute", "roles", "gallery", "contact", "footer"] as const;

// The public page reads the files of the commit being built, so a save can never
// publish content that TinaCloud has not finished indexing.
export function loadSite() {
  const entries = NAMES.map((name) => [
    name,
    JSON.parse(readFileSync(path.join(process.cwd(), "content/site", `${name}.json`), "utf8")),
  ]);
  return Object.fromEntries(entries) as SiteQuery;
}
