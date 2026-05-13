/**
 * Cross-tool shared types.
 *
 * Lives outside `./index.ts` so individual tool modules can depend on it
 * without forming a cycle with the tool registry barrel.
 */

/**
 * Minimal reference to an active code-kind deal that multiple tools attach
 * to their offer / buy-link output. Larger per-tool match shapes (e.g.
 * `CodeMatch` in find-best-deal, `CodeForUrlMatch` in get-code-for-url)
 * carry additional UX-specific fields and stay tool-local.
 */
export interface CodeRef {
  code: string;
  title: string;
  dealId: string;
}
