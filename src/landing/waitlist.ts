/**
 * Waitlist signup. Accepts `{ email, source?, referrer? }` and inserts into
 * the `waitlist` table. Duplicate emails are treated as success (idempotent)
 * so we never leak whether a given address has signed up before.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { waitlist } from '../db/schema.ts';
import { log } from '../lib/log.ts';

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  source: z.string().trim().max(64).optional(),
  referrer: z.string().trim().max(1024).optional(),
});

export function registerWaitlistRoute(app: Hono): void {
  app.post('/api/waitlist', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid input' }, 400);
    }
    const { email, source, referrer } = parsed.data;

    try {
      // Bare ON CONFLICT DO NOTHING — Postgres applies it to any unique
      // violation. The only conflict source here is the lower(email)
      // functional index (id is a fresh UUID per insert). RETURNING gives us
      // [] on conflict so we can surface `alreadyOnList` to the client.
      const inserted = await db()
        .insert(waitlist)
        .values({
          email,
          ...(source !== undefined ? { source } : {}),
          ...(referrer !== undefined ? { referrer } : {}),
        })
        .onConflictDoNothing()
        .returning({ id: waitlist.id });

      return c.json({
        ok: true,
        alreadyOnList: inserted.length === 0,
      });
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'waitlist insert failed',
      );
      return c.json({ error: 'could not record signup; try again' }, 500);
    }
  });
}
