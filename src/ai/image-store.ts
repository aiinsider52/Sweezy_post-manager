import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function saveImage(baseDbPath: string, postId: string, buffer: Buffer): Promise<string> {
  const directory = join(dirname(baseDbPath), "images");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${postId}.png`);
  await writeFile(path, buffer, { mode: 0o600 });
  return path;
}

export async function downloadImage(url: string, baseDbPath: string, postId: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Source image download failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Unexpected image content-type: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 10 * 1024 * 1024) throw new Error("Source image exceeds 10 MB");
  return saveImage(baseDbPath, postId, buffer);
}
