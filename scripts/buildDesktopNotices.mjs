import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const supplementalRoot = resolve(root, "licenses/rust");
const supplements = JSON.parse(await readFile(resolve(supplementalRoot, "supplements.json"), "utf8"));
const packages = new Map();
// Include build tools as well as runtime dependencies. A universal macOS
// bundle needs both architectures; Windows must use its own dependency graph.
const platform = process.env.TAURI_ENV_PLATFORM ?? process.platform;
const defaultTargets = {
  macos: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  darwin: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  windows: ["x86_64-pc-windows-msvc"],
  win32: ["x86_64-pc-windows-msvc"],
};
const targets = process.env.LANIAKEA_NOTICE_TARGETS?.split(",") ?? defaultTargets[platform];
const supported = new Set(Object.values(defaultTargets).flat());
assert.ok(targets?.length && targets.every((target) => supported.has(target)),
  `Unsupported notice target for ${platform}; specify LANIAKEA_NOTICE_TARGETS explicitly`);
for (const target of targets) {
  const { stdout } = await run("cargo", ["metadata", "--locked", "--format-version", "1",
    "--manifest-path", "src-tauri/Cargo.toml", "--filter-platform", target],
  { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  const resolved = new Set(metadata.resolve.nodes.map(({ id }) => id));
  for (const item of metadata.packages) {
    if (resolved.has(item.id) && item.name !== "laniakea") packages.set(item.id, item);
  }
}

const sections = [];
const inventory = [];
for (const item of [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"))) {
  const directory = dirname(item.manifest_path);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/iu.test(entry.name))
    .map(({ name }) => name).sort();
  if (item.license_file && !files.includes(item.license_file)) files.push(item.license_file);
  const texts = await Promise.all(files.map(async (file) => ({
    name: file, text: await readFile(resolve(directory, file), "utf8"),
  })));
  if (texts.length === 0) {
    const supplement = supplements.find(({ name, version }) => name === item.name && version === item.version);
    assert.ok(supplement, `No license text for ${item.name}@${item.version}`);
    const vcs = JSON.parse(await readFile(resolve(directory, ".cargo_vcs_info.json"), "utf8"));
    assert.equal(vcs.git.sha1, supplement.upstreamCommit, `${item.name} supplement provenance changed`);
    for (const file of supplement.files) {
      const path = resolve(supplementalRoot, file.path);
      const relation = relative(supplementalRoot, path);
      assert.ok(!relation.startsWith("..") && !isAbsolute(relation), "Supplement must be contained");
      const bytes = await readFile(path);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${item.name} supplement digest changed`);
      texts.push({ name: file.url, text: bytes.toString("utf8") });
    }
  }
  assert.ok(texts.length > 0 && texts.every(({ text }) => text.trim()), `Empty notices for ${item.name}`);
  assert.ok(item.source?.startsWith("registry+"), `Review non-registry source ${item.name}`);
  const sourceUrl = `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`;
  sections.push(`## ${item.name}@${item.version}\n\nDeclared license: ${item.license ?? "See included text"}\n\n` +
    `Unmodified source archive: ${sourceUrl}\n\n` +
    (item.authors?.length ? `Package authors: ${item.authors.join(", ")}\n\n` : "") +
    texts.map(({ name, text }) => `### ${name}\n\n${text.trim()}\n`).join("\n"));
  inventory.push({ name: item.name, version: item.version, license: item.license, sourceUrl });
}
const output = resolve(root, "src-tauri/notices");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "THIRD_PARTY_NOTICES.txt"),
  "# Laniakea native dependencies\n\n" +
  `License and notice texts from the exact locked dependencies for ${targets.join(", ")} follow. ` +
  "This inventory includes build dependencies as well as runtime dependencies. " +
  "The source archive links provide the unchanged sources, including any MPL-covered components. " +
  "Crates whose published archives omit license files use the checked-in upstream supplements, verified by version, commit and digest. " +
  "Frontend dependency notices are in THIRD_PARTY_NOTICES.web.txt.\n\n" + sections.join("\n"));
await writeFile(resolve(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
console.log(`Native distribution notices: ${inventory.length} locked packages for ${targets.join(", ")}`);
