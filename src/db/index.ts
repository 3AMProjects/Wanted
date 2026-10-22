import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

function create() {
  // `prepare: false` is required with Supabase's transaction pooler (port 6543).
  const sql = postgres(env().DATABASE_URL, { prepare: false });
  return drizzle({ client: sql, schema });
}

export type Db = ReturnType<typeof create>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { db?: Db };

/** Created on first use so `next build` doesn't need DATABASE_URL. */
export function getDb(): Db {
  globalForDb.db ??= create();
  return globalForDb.db;
}
