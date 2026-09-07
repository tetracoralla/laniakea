import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeThirdPartyNotices } from "./scripts/generateThirdPartyNotices.mjs";

const markdownPackages = [
  "/micromark",
  "/mdast-util-",
  "/remark-",
  "/unified/",
  "/unist-util-",
  "/vfile",
];

function runtimeChunk(moduleId: string): string | undefined {
  if (!moduleId.includes("/node_modules/")) return undefined;
  if (markdownPackages.some((name) => moduleId.includes(name))) {
    return "markdown-runtime";
  }
  if (
    moduleId.includes("/node_modules/react/") ||
    moduleId.includes("/node_modules/react-dom/") ||
    moduleId.includes("/node_modules/scheduler/")
  ) {
    return "react-runtime";
  }
  if (
    moduleId.includes("/node_modules/@dagrejs/") ||
    moduleId.includes("/node_modules/@openadam/graph-view-compiler/")
  ) {
    return "graph-runtime";
  }
  return undefined;
}

function offlineAssetManifest(): Plugin {
  return {
    name: "laniakea-offline-asset-manifest",
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => /\.(?:css|js)$/u.test(fileName))
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "asset-manifest.json",
        source: JSON.stringify({ version: 1, assets }),
      });
    },
  };
}

function distributionNotices(): Plugin {
  return {
    name: "laniakea-distribution-notices",
    async generateBundle(_options, bundle) {
      const repositoryRoot = fileURLToPath(new URL("./", import.meta.url));
      const { content } = await writeThirdPartyNotices({
        repositoryRoot,
        bundledInputs: Object.values(bundle).flatMap((entry) =>
          entry.type === "chunk" ? Object.keys(entry.modules).filter((id) => !id.startsWith("\0")) : []),
        outputPaths: [],
        productName: "Laniakea",
        distribution: "web and desktop frontend",
      });
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: content });
      for (const fileName of ["LICENSE", "NOTICE"]) {
        this.emitFile({ type: "asset", fileName, source: await readFile(new URL(fileName, import.meta.url), "utf8") });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), offlineAssetManifest(), distributionNotices()],
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: runtimeChunk,
      },
    },
  },
});
