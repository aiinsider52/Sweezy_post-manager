import { createHash } from "node:crypto";

export function hashUrl(url: string): string {
  const normalized = new URL(url);
  normalized.hash = "";
  for (const key of [...normalized.searchParams.keys()]) if (key.startsWith("utm_") || key === "fbclid") normalized.searchParams.delete(key);
  return createHash("sha256").update(normalized.toString()).digest("hex");
}
