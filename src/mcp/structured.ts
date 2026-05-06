/**
 * Helpers for producing the dual-format MCP tool response
 * (`content: [{ type: 'text', text }]` AND `structuredContent: result`)
 * required by the 2025-11 spec.
 */

export type ToolTextContent = { type: 'text'; text: string };

export type StructuredToolResult<T extends Record<string, unknown>> = {
  content: ToolTextContent[];
  structuredContent: T;
};

/**
 * Wrap a typed JSON-serializable result into the MCP dual-format response shape.
 * The `structuredContent` is the canonical machine-readable payload; `content`
 * holds a JSON-string fallback for clients that only consume `content`.
 */
export function structured<T extends Record<string, unknown>>(
  result: T,
): StructuredToolResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
