import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),

  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_FREE: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),

  FMTC_API_KEY: z.string().optional(),
  FMTC_BASE_URL: z.string().url().default('https://s3.fmtc.co/api/v3/'),

  AWIN_API_TOKEN: z.string().optional(),
  AWIN_PUBLISHER_ID: z.string().optional(),

  IMPACT_ACCOUNT_SID: z.string().optional(),
  IMPACT_AUTH_TOKEN: z.string().optional(),

  KEEPA_API_KEY: z.string().optional(),

  VOYAGE_API_KEY: z.string().optional(),

  // Affiliate / monetization tags. When set, find_deals / get_deal / find_products
  // rewrite outbound URLs through them. See src/lib/affiliate.ts.
  AMAZON_ASSOCIATES_TAG: z.string().optional(),

  // CouponAPI.org — paid coupon catalog (free 7-day trial). When set, the
  // ingest cron pulls it. See src/sources/couponapi.ts.
  COUPONAPI_KEY: z.string().optional(),
  COUPONAPI_BASE_URL: z.string().url().optional(),
  COUPONAPI_COUNTRY: z.string().length(2).optional(),

  // SerpApi — live Google Shopping fallback for find_products. When set,
  // find_products returns real results; otherwise it returns a note.
  SERPAPI_KEY: z.string().optional(),

  MCP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  MCP_OAUTH_ISSUER: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
