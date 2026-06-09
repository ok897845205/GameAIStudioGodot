import { describe, expect, it } from "vitest";
import type { RuntimeEnvironment } from "../runtime-environment";
import { createEndpointAdapter, type EndpointAdapterConfig } from "./endpoint-adapter";

const config: EndpointAdapterConfig = {
  id: "openclaw-gateway",
  label: "OpenClaw Gateway",
  runModel: "gateway",
  endpointEnvVars: ["OPENCLAW_GATEWAY_URL"],
  credentialEnvVars: ["OPENCLAW_GATEWAY_TOKEN"],
  capabilities: {
    runModel: "gateway",
    supportsImages: true,
    imageInputMode: "base64",
    supportsStream: true,
    supportsResume: true,
    headless: true,
  },
};

function fakeEnv(env: NodeJS.ProcessEnv): RuntimeEnvironment {
  return { env } as unknown as RuntimeEnvironment;
}

describe("endpoint adapter", () => {
  it("discovers a configured endpoint from environment variables", async () => {
    const adapter = createEndpointAdapter(config);

    expect(await adapter.discover(fakeEnv({ OPENCLAW_GATEWAY_URL: "https://gateway.local" }))).toEqual({
      found: true,
      executablePath: "https://gateway.local",
    });
  });

  it("reports endpoint and credential health separately", async () => {
    const adapter = createEndpointAdapter(config);

    const missing = await adapter.health(fakeEnv({}));
    expect(missing.installed).toBe(false);
    expect(missing.headlessOk).toBe("unknown");

    const configured = await adapter.health(
      fakeEnv({
        OPENCLAW_GATEWAY_URL: "https://gateway.local",
        OPENCLAW_GATEWAY_TOKEN: "token",
      }),
    );
    expect(configured.installed).toBe(true);
    expect(configured.authed).toBe(true);
    expect(configured.imagesOk).toBe("unknown");
  });
});
