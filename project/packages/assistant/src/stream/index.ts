// Public `@gameaistudio/assistant/stream` surface — the streaming engine subset
// used by the runtime/store layers: stream construction, the protocol chunk
// type, and the chunk→message accumulator. Wire-format serializers (data-stream,
// ui-message, transport), resumable streams, client-side tool execution, object
// streams, and provider-message converters are intentionally omitted.
export {
  createAssistantStream,
  createAssistantStreamController,
} from "./core/modules/assistant-stream";
export type { AssistantStreamController } from "./core/modules/assistant-stream";

export {
  AssistantMessageAccumulator,
  createInitialMessage as unstable_createInitialMessage,
} from "./core/accumulators/assistant-message-accumulator";
export { AssistantMessageStream } from "./core/accumulators/AssistantMessageStream";

export type { AssistantStream } from "./core/AssistantStream";
export type { AssistantStreamChunk, PartInit } from "./core/AssistantStreamChunk";

export type { TextStreamController } from "./core/modules/text";
export type { ToolCallStreamController } from "./core/modules/tool-call";

export { ToolResponse, type ToolResponseLike } from "./core/tool/ToolResponse";
export type {
  Tool,
  ToolModelContentPart,
  ToolModelOutputFunction,
} from "./core/tool/tool-types";

export type {
  AssistantMessage,
  AssistantMessageStatus,
  AssistantMessageTiming,
  AssistantMessagePart,
  TextPart,
  ReasoningPart,
  ToolCallPart,
  SourcePart,
  FilePart,
  DataPart,
} from "./core/utils/types";
