import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parts = [
  resolve(root, "font-src/NexaRustSans-Black.part-01.b64"),
  resolve(root, "font-src/NexaRustSans-Black.part-02.b64"),
];
const encoded = (await Promise.all(parts.map((path) => readFile(path, "utf8"))))
  .map((part) => part.trim())
  .join("");

if (encoded.length !== 18060) {
  throw new Error(`Nexa Rust font base64 length mismatch: expected 18060, got ${encoded.length}`);
}
const bytes = Buffer.from(encoded, "base64");
if (bytes.length !== 13544 || bytes.toString("ascii", 0, 4) !== "wOF2") {
  throw new Error(`Nexa Rust WOFF2 validation failed: got ${bytes.length} bytes`);
}

const output = resolve(root, "public/fonts/NexaRustSans-Black.woff2");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(`Prepared Nexa Rust Sans Black (${bytes.length} bytes)`);
