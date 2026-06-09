import type { EndpointAdapterConfig } from "./endpoint-adapter";

export const cursorCloudConfig: EndpointAdapterConfig = {
  id: "cursor-cloud",
  label: "Cursor Cloud",
  runModel: "cloud",
  endpointEnvVars: ["GAMEAISTUDIO_CURSOR_CLOUD_URL", "CURSOR_CLOUD_URL"],
  credentialEnvVars: ["GAMEAISTUDIO_CURSOR_CLOUD_TOKEN", "CURSOR_API_KEY"],
  capabilities: {
    runModel: "cloud",
    supportsImages: false,
    imageInputMode: "unsupported",
    supportsStream: true,
    supportsResume: true,
    headless: true,
  },
};
