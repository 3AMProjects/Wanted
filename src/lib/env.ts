import { z } from "zod";

const bps = z.coerce.number().int().min(0).max(10_000);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),
  CRON_SECRET: z.string().min(16),
  NIK_HASH_SECRET: z.string().min(16),

  PAYMENT_PROVIDER: z.enum(["mock", "xendit"]).default("mock"),
  XENDIT_SECRET_KEY: z.string().optional(),
  XENDIT_CALLBACK_TOKEN: z.string().optional(),

  // Business rules. Basis points: 100 = 1%.
  POSTING_FEE_BPS: bps.default(500),
  WITHDRAWAL_FEE_BPS: bps.default(250),
  CANCEL_FEE_BPS: bps.default(2000),
  MIN_REWARD: z.coerce.number().int().positive().default(50_000),
  MIN_WITHDRAWAL: z.coerce.number().int().positive().default(50_000),
  POST_DURATION_DAYS: z.coerce.number().int().positive().default(60),
  CLAIM_REVIEW_DAYS: z.coerce.number().int().positive().default(3),
  DISPUTE_WINDOW_DAYS: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` works without a full environment. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.parse(process.env);
    if (process.env.VERCEL_ENV === "production" && parsed.PAYMENT_PROVIDER === "mock") {
      throw new Error("PAYMENT_PROVIDER=mock is not allowed in production");
    }
    cached = parsed;
  }
  return cached;
}
