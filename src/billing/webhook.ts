/**
 * Stripe webhook handler — verifies the signature, validates the event shape
 * with Zod, and reacts to plan changes by mutating Clerk org metadata.
 *
 * Handled events:
 *   - `checkout.session.completed` -> set org plan + scopes from session metadata.
 *   - `customer.subscription.deleted` -> downgrade org to free.
 *
 * The route is mounted at `/webhooks/stripe` via `registerStripeWebhook(app)`.
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import { clerkClient, defaultScopesFor, isClerkConfigured } from '../auth/clerk.ts';
import type { Plan } from '../auth/types.ts';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';
import { stripe } from './stripe.ts';

const PlanSchema = z.enum(['free', 'starter', 'pro', 'enterprise']);

const CheckoutSessionCompletedSchema = z.object({
  type: z.literal('checkout.session.completed'),
  data: z.object({
    object: z.object({
      id: z.string(),
      customer: z.union([z.string(), z.null()]).optional(),
      metadata: z
        .object({
          clerk_org_id: z.string().optional(),
          plan: PlanSchema.optional(),
        })
        .nullish(),
    }),
  }),
});

const SubscriptionDeletedSchema = z.object({
  type: z.literal('customer.subscription.deleted'),
  data: z.object({
    object: z.object({
      id: z.string(),
      customer: z.union([z.string(), z.null()]).optional(),
      metadata: z
        .object({
          clerk_org_id: z.string().optional(),
        })
        .nullish(),
    }),
  }),
});

const StripeEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
});

export function registerStripeWebhook(app: Hono): void {
  app.post('/webhooks/stripe', async (c) => {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      log.error('STRIPE_WEBHOOK_SECRET not configured; refusing webhook');
      return c.json({ error: 'webhook_not_configured' }, 500);
    }

    const sig = c.req.header('stripe-signature');
    if (!sig) {
      return c.json({ error: 'missing_signature' }, 400);
    }

    const rawBody = await c.req.text();

    let event: unknown;
    try {
      event = stripe().webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      log.warn({ err }, 'stripe webhook signature verification failed');
      return c.json({ error: 'invalid_signature' }, 400);
    }

    // Sanity-check shape with Zod beyond what the SDK returns.
    const envelope = StripeEnvelopeSchema.safeParse(event);
    if (!envelope.success) {
      return c.json({ error: 'malformed_event' }, 400);
    }

    try {
      switch (envelope.data.type) {
        case 'checkout.session.completed': {
          const parsed = CheckoutSessionCompletedSchema.safeParse(event);
          if (!parsed.success) {
            log.warn({ id: envelope.data.id }, 'checkout.session.completed malformed');
            break;
          }
          const obj = parsed.data.data.object;
          const orgId = obj.metadata?.clerk_org_id;
          const plan = obj.metadata?.plan;
          if (!orgId || !plan) {
            log.warn(
              { id: obj.id },
              'checkout.session.completed missing clerk_org_id or plan in metadata',
            );
            break;
          }
          await applyPlanToOrg(orgId, plan);
          break;
        }
        case 'customer.subscription.deleted': {
          const parsed = SubscriptionDeletedSchema.safeParse(event);
          if (!parsed.success) break;
          const orgId = parsed.data.data.object.metadata?.clerk_org_id;
          if (!orgId) break;
          await applyPlanToOrg(orgId, 'free');
          break;
        }
        default:
          // ignore other event types
          break;
      }
    } catch (err) {
      log.error({ err, type: envelope.data.type }, 'stripe webhook handler failed');
      return c.json({ error: 'handler_failed' }, 500);
    }

    return c.json({ received: true });
  });
}

async function applyPlanToOrg(orgId: string, plan: Plan): Promise<void> {
  if (!isClerkConfigured()) {
    log.warn({ orgId, plan }, 'clerk not configured; skipping plan update');
    return;
  }
  const org = await clerkClient().organizations.getOrganization({ organizationId: orgId });
  const scopes = defaultScopesFor(plan);
  await clerkClient().organizations.updateOrganizationMetadata(orgId, {
    publicMetadata: {
      ...((org.publicMetadata as Record<string, unknown>) ?? {}),
      plan,
      planScopes: scopes,
    } as never,
  });
  log.info({ orgId, plan }, 'updated org plan');
}
