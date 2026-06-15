// Public `@gameaistudio/assistant/stream/utils` surface — JSON helpers and the
// async-iterable stream adapter consumed by the runtime/store layers.
export {
  parsePartialJsonObject,
  getPartialJsonObjectFieldState,
  getPartialJsonObjectMeta,
} from "./utils/json/parse-partial-json-object";
export {
  type AsyncIterableStream,
  asAsyncIterableStream,
} from "./utils/AsyncIterableStream";
export type {
  ReadonlyJSONValue,
  ReadonlyJSONArray,
  ReadonlyJSONObject,
} from "./utils/json/json-value";
