import type { AudioProviderConfig } from "@gameaistudio/shared";

/**
 * Built-in audio providers shipped with the app. API key is secret-box
 * ciphertext. Bump BUILTIN_AUDIO_VERSION to re-seed after rotating the key.
 * See secret-box.ts for the security caveat (embedded = obfuscation).
 */
export const BUILTIN_AUDIO_VERSION = 1;

const ACE_KEY = "enc:v1:xWDc/x1zAY9j3d39fiG5JaZiPAj3w/ky5lvL596nOPRlCf5dIaBECbVfbmh5HbIt/BLXo9AeJYmiGBVF";

export interface BuiltinAudioDefaults {
  providers: AudioProviderConfig[];
  /** Workflow audio auto-generation stays opt-in by default. */
  autoGenerateInWorkflow: boolean;
}

export function builtinAudioDefaults(): BuiltinAudioDefaults {
  return {
    providers: [
      {
        id: "builtin-ace",
        name: "ACE Music",
        protocol: "ace-music-v1",
        baseUrl: "https://api.acemusic.ai/v1",
        modelId: "acemusic/acestep-v1.5-turbo",
        outputFormat: "mp3",
        order: 0,
        enabled: true,
        apiKey: ACE_KEY
      }
    ],
    autoGenerateInWorkflow: false
  };
}
