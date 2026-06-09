import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const assistantAliases = {
  "@gameaistudio/assistant/react": resolve("packages/assistant/src/react/index.ts"),
  "@gameaistudio/assistant/stream/utils": resolve("packages/assistant/src/stream/utils.ts"),
  "@gameaistudio/assistant/stream": resolve("packages/assistant/src/stream/index.ts"),
  "@gameaistudio/assistant/tap": resolve("packages/assistant/src/tap/index.ts"),
  "@gameaistudio/assistant": resolve("packages/assistant/src/index.ts")
};

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
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@gameaistudio/shared": resolve("packages/shared/src/index.ts"),
        ...assistantAliases
      }
    },
    build: {
      rollupOptions: {
        input: resolve("packages/renderer/index.html")
      }
    }
  }
});
