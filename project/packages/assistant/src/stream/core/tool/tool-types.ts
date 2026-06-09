// Minimal subset of assistant-stream tool types needed by the streaming engine.
// The full tool-declaration / JSON-schema machinery (zod adapters, MCP config,
// execution) is intentionally omitted — GameAIStudio runs local CLI agents and
// does not execute client-side tools.

/**
 * A content part returned to the model after a tool call.
 */
export type ToolModelContentPart =
  | {
      /** A text content part returned to the model after a tool call. */
      readonly type: "text";
      /** Text that should be included in the model-visible tool result. */
      readonly text: string;
    }
  | {
      /** A file content part returned to the model after a tool call. */
      readonly type: "file";
      /**
       * File payload encoded as a provider-compatible string, commonly base64
       * for binary data.
       */
      readonly data: string;
      /** MIME type for the file payload. */
      readonly mediaType: string;
      /** Optional display filename for the file payload. */
      readonly filename?: string;
    };

/**
 * Converts a tool's runtime result into content that is sent back to the model.
 *
 * Referenced from JSDoc on {@link ToolModelContentPart} consumers; kept as a
 * type so ported call sites remain faithful to the reference.
 */
export type ToolModelOutputFunction<TArgs, TResult> = (options: {
  args: TArgs;
  result: TResult;
}) =>
  | readonly ToolModelContentPart[]
  | Promise<readonly ToolModelContentPart[]>;

/**
 * Minimal structural tool declaration.
 *
 * Upstream `assistant-stream` models tools as a large discriminated union over
 * frontend/backend/human/provider/MCP variants with zod/standard-schema
 * parameter typing. GameAIStudio never authors or executes client-side tools
 * (its agents run local CLIs), so this keeps only the permissive shape the
 * model-context registry needs to merge/spread tool entries — without pulling
 * in the schema machinery.
 */
export type Tool<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = {
  readonly type?: string | undefined;
  readonly description?: string | undefined;
  readonly parameters?: unknown;
  readonly execute?:
    | ((args: TArgs, context: unknown) => TResult | Promise<TResult>)
    | undefined;
  readonly toModelOutput?: ToolModelOutputFunction<TArgs, TResult> | undefined;
};
