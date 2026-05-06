/**
 * Opaque base64-encoded keyset cursors for paginated MCP tools.
 *
 * Cursors carry whatever ordering keys the query needs to resume after the
 * last row. We JSON-encode the payload then base64url-encode it so it survives
 * round-tripping through a URL or JSON-RPC string field.
 */

export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string | undefined,
): T | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as T;
    return undefined;
  } catch {
    return undefined;
  }
}
