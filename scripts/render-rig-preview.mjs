import { spawn, spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5186;
const baseUrl = `http://127.0.0.1:${port}/rig-preview.html`;
const outputDir = path.join(root, "artifacts", "rig-preview");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const browserCandidates = process.env.CHROME_BIN
  ? [process.env.CHROME_BIN]
  : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];

function findBrowser() {
  for (const candidate of browserCandidates) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chromium/Chrome is required; set CHROME_BIN to its executable path.");
}

const browser = findBrowser();
await mkdir(outputDir, { recursive: true });
const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited early with status ${server.exitCode}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Vite did not become ready at ${baseUrl}`);

  const views = [
    ["both-facings", baseUrl],
    ["right-facing", `${baseUrl}?facing=right`],
    ["left-facing", `${baseUrl}?facing=left`],
  ];
  for (const [name, url] of views) {
    const output = path.join(outputDir, `chog-${name}.png`);
    const capture = spawnSync(browser, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=2500",
      "--window-size=1600,960",
      `--screenshot=${output}`,
      url,
    ], { cwd: root, encoding: "utf8", timeout: 60000 });
    if (capture.status !== 0) {
      throw new Error(`Screenshot failed for ${name}:\n${capture.stderr || capture.stdout}`);
    }
    let image;
    try {
      image = await stat(output);
    } catch (error) {
      throw new Error(`Chromium did not save ${output}.\n${capture.stdout}\n${capture.stderr}\n${error.message}`);
    }
    if (image.size < 10_000) throw new Error(`Screenshot for ${name} is unexpectedly small (${image.size} bytes)`);
    process.stdout.write(`${output} (${image.size} bytes)\n`);
  }
} finally {
  server.kill("SIGTERM");
}
