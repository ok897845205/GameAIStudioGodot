/// <reference types="vite/client" />

import type { StudioApi } from "@gameaistudio/shared";

declare global {
  interface Window {
    studio: StudioApi;
  }
}

