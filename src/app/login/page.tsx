"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-sm space-y-3">
      <h1 className="text-xl font-bold">Masuk</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="rounded bg-neutral-900 px-4 py-2 text-sm text-white" disabled={status === "sending"}>
        Kirim link masuk
      </button>
      {status === "sent" && <p className="text-sm text-green-700">Cek email kamu untuk link masuk.</p>}
      {status === "error" && <p className="text-sm text-red-600">Gagal mengirim link. Coba lagi.</p>}
    </form>
  );
}
