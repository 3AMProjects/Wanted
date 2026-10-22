import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweepClaims } from "@/server/services/claims";
import { expireDuePosts } from "@/server/services/posts";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${env().CRON_SECRET}`);
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const claims = await sweepClaims(now);
  const expiredPosts = await expireDuePosts(now);
  return NextResponse.json({ ...claims, expiredPosts });
}
