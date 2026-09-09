import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  // Frame the raster artwork around its convergence point. Keep the artwork
  // untouched and apply the same transparent margin/corner mask to every size.
  const artwork = await readFile(join(root, "docs/brand/artwork.png"));
  const artworkSize = 1254;
  if (artwork.readUInt32BE(16) !== artworkSize || artwork.readUInt32BE(20) !== artworkSize) {
    throw new Error("Icon artwork dimensions changed; review the convergence framing before exporting");
  }
  const convergence = { x: 620, y: 582 };
  const cropSize = 1070;
  const tile = 916;
  const scale = tile / cropSize;
  const framedArtwork = `<defs><clipPath id="tile"><rect x="54" y="54" width="${tile}" height="${tile}" rx="164"/></clipPath></defs>
    <image x="${54 - (convergence.x - cropSize / 2) * scale}" y="${54 - (convergence.y - cropSize / 2) * scale}" width="${artworkSize * scale}" height="${artworkSize * scale}"
      href="data:image/png;base64,${artwork.toString("base64")}" clip-path="url(#tile)"/>`;
  for (const maskable of [false, true]) {
    const wrapper = join(scratch, "framed.svg");
    await writeFile(wrapper, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
      ${maskable ? '<rect width="1024" height="1024" fill="#001337"/>' : ''}${framedArtwork}</svg>`);
    generate(wrapper, scratch, [1024]);
    await copyFile(join(scratch, "1024x1024.png"), join(root,
      `docs/brand/app-icon${maskable ? "-maskable" : ""}.png`));
  }
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
