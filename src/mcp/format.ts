/**
 * Tiny human-readable formatters for deal discount + eligibility metadata.
 * Pure functions; safe to call from any tool handler.
 */

import type { Deal } from '../db/schema.ts';

export function discountSummary(deal: Pick<Deal, 'discountType' | 'discountValueBps' | 'discountValueCents'>): string {
  switch (deal.discountType) {
    case 'pct_off': {
      if (deal.discountValueBps != null) {
        const pct = deal.discountValueBps / 100;
        // Strip trailing ".0" for whole percentages.
        const pretty = Number.isInteger(pct) ? pct.toString() : pct.toFixed(2);
        return `${pretty}% off`;
      }
      return 'Percent off';
    }
    case 'amt_off': {
      if (deal.discountValueCents != null) {
        const dollars = (deal.discountValueCents / 100).toFixed(2).replace(/\.00$/, '');
        return `$${dollars} off`;
      }
      return 'Amount off';
    }
    case 'free_shipping':
      return 'Free shipping';
    case 'gift':
      return 'Free gift';
    case 'tiered':
      return 'Tiered discount';
    case 'unknown':
    default:
      return 'Discount';
  }
}

export function eligibilitySummary(deal: Pick<Deal, 'cartMinCents' | 'segment' | 'geoScope'>): string {
  const parts: string[] = [];
  if (deal.cartMinCents != null && deal.cartMinCents > 0) {
    const dollars = (deal.cartMinCents / 100).toFixed(2).replace(/\.00$/, '');
    parts.push(`min cart $${dollars}`);
  }
  if (deal.segment && deal.segment !== 'general') {
    parts.push(deal.segment.replace(/_/g, ' '));
  }
  if (deal.geoScope && deal.geoScope.length > 0) {
    parts.push(`geo: ${deal.geoScope.join(',')}`);
  }
  return parts.length === 0 ? 'no restrictions' : parts.join('; ');
}
