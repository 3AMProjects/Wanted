import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { profiles, type Profile } from "@/db/schema";
import { supabaseServer } from "@/lib/supabase";

export async function currentUser(): Promise<Profile | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const [profile] = await getDb().select().from(profiles).where(eq(profiles.id, data.user.id));
  return profile ?? null;
}

export async function requireUser(): Promise<Profile> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Posting, claiming and withdrawing all require a verified KYC. */
export async function requireVerifiedUser(): Promise<Profile> {
  const user = await requireUser();
  if (user.kycStatus !== "verified") redirect("/kyc");
  return user;
}

export async function requireAdmin(): Promise<Profile> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
