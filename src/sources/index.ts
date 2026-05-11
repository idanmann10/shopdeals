/**
 * Adapter registry. Production callers import `getAllAdapters()` to obtain
 * the full set of source adapters; the cron entrypoint then iterates and
 * skips any that aren't configured.
 */
import { AwinAdapter } from './awin.ts';
import type { SourceAdapter } from './common.ts';
import { FmtcAdapter } from './fmtc.ts';
import { ImpactAdapter } from './impact.ts';
import { SlickdealsAdapter } from './slickdeals.ts';

export type { RawDealInput, SourceAdapter, IngestResult } from './common.ts';
export { AwinAdapter } from './awin.ts';
export { FmtcAdapter } from './fmtc.ts';
export { ImpactAdapter } from './impact.ts';
export { SlickdealsAdapter } from './slickdeals.ts';
export { upsertDeals } from './upsert.ts';

export function getAllAdapters(): SourceAdapter[] {
  return [
    new FmtcAdapter(),
    new AwinAdapter(),
    new ImpactAdapter(),
    new SlickdealsAdapter(),
  ];
}

/** Look up a single adapter by network name. Returns `undefined` if unknown. */
export function getAdapter(network: string): SourceAdapter | undefined {
  switch (network) {
    case 'fmtc':
      return new FmtcAdapter();
    case 'awin':
      return new AwinAdapter();
    case 'impact':
      return new ImpactAdapter();
    case 'slickdeals':
      return new SlickdealsAdapter();
    default:
      return undefined;
  }
}
