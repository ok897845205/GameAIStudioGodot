import type { Tool } from "../stream";

/**
 * Defines a model tool with its argument schema, execution behavior, and
 * optional model-output conversion.
 *
 * @param tool - Tool definition to expose to the assistant model.
 */
export function tool<TArgs extends Record<string, unknown>, TResult = any>(
  tool: Tool<TArgs, TResult>,
): Tool<TArgs, TResult> {
  return tool;
}
