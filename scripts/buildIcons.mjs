import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tauri = join(root, "node_modules/@tauri-apps/cli/tauri.js");
const scratch = await mkdtemp(join(tmpdir(), "laniakea-icons-"));
function generate(source, output, sizes = []) {
  execFileSync(process.execPath, [
    tauri, "icon", source, "--output", output,
    ...sizes.flatMap((size) => ["--png", String(size)]),
  ], { cwd: root, stdio: "inherit" });
}

try {
  generate("docs/brand/app-icon.png", "src-tauri/icons");
  generate("docs/brand/app-icon.png", scratch, [32, 64, 180, 192, 512]);
  for (const [size, name] of [[32, "favicon-32.png"], [64, "favicon-64.png"],
    [180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
    await copyFile(join(scratch, `${size}x${size}.png`), join(root, "public", name));
  }
  generate("docs/brand/app-icon-maskable.png", scratch, [512]);
  await copyFile(join(scratch, "512x512.png"), join(root, "public/icon-maskable-512.png"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
