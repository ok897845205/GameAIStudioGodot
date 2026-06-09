import type { EndpointAdapterConfig } from "./endpoint-adapter";

export const openclawGatewayConfig: EndpointAdapterConfig = {
  id: "openclaw-gateway",
  label: "OpenClaw Gateway",
  runModel: "gateway",
  endpointEnvVars: ["GAMEAISTUDIO_OPENCLAW_GATEWAY_URL", "OPENCLAW_GATEWAY_URL"],
  credentialEnvVars: ["GAMEAISTUDIO_OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"],
  capabilities: {
    runModel: "gateway",
    supportsImages: true,
    imageInputMode: "base64",
    supportsStream: true,
    supportsResume: true,
    headless: true,
  },
};
