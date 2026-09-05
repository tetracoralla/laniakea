import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  base: "./",
  plugins: [react(), offlineAssetManifest()],
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
