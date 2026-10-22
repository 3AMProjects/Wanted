-- Supabase-specific setup that Drizzle's schema can't express.

-- Profiles mirror auth.users.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fk" FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, split_part(coalesce(NEW.email, ''), '@', 1));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- The ledger is append-only.
CREATE OR REPLACE FUNCTION public.ledger_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_is_append_only();
--> statement-breakpoint

-- Row Level Security: the app reads and writes through the server with a
-- privileged connection, so the public API (anon/authenticated keys) gets no
-- access at all. Deny-by-default = RLS on, no policies.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kyc_submissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "post_media" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "claim_media" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "withdrawals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Storage. Only post photos are public; proofs and KYC documents are private
-- and served through short-lived signed URLs after a server-side check.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('post-media', 'post-media', true, 10485760),
  ('proofs', 'proofs', false, 10485760),
  ('kyc', 'kyc', false, 10485760)
ON CONFLICT (id) DO NOTHING;
