import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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
});
