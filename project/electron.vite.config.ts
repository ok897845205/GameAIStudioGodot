import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@gameaistudio/shared": resolve("packages/shared/src/index.ts")
      }
    },
    build: {
      rollupOptions: {
        input: resolve("packages/main/src/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@gameaistudio/shared": resolve("packages/shared/src/index.ts")
      }
    },
    build: {
      rollupOptions: {
        input: resolve("packages/preload/src/index.ts")
      }
    }
  },
  renderer: {
    root: resolve("packages/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@gameaistudio/shared": resolve("packages/shared/src/index.ts")
      }
    },
    build: {
      rollupOptions: {
        input: resolve("packages/renderer/index.html")
      }
    }
  }
});
