import type { AssistantStreamChunk } from "./AssistantStreamChunk";

/**
 * Stream of assistant-ui protocol chunks.
 *
 * `AssistantStream` is the normalized internal stream format used by
 * encoders, decoders, accumulators, and tool execution transforms.
 */
export type AssistantStream = ReadableStream<AssistantStreamChunk>;
