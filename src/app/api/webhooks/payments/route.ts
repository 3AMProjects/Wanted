import { NextResponse } from "next/server";
import { paymentProvider } from "@/server/payments";
import { WebhookAuthError } from "@/server/payments/types";
import { handlePaymentEvent } from "@/server/services/payment-events";

export async function POST(request: Request) {
  let event;
  try {
    event = paymentProvider().parseWebhook(request.headers, await request.json());
  } catch (err) {
    const status = err instanceof WebhookAuthError ? 401 : 400;
    return NextResponse.json({ error: "invalid webhook" }, { status });
  }
  if (!event) return NextResponse.json({ ignored: true });

  // Handlers are idempotent; a 5xx makes the gateway retry.
  await handlePaymentEvent(event);
  return NextResponse.json({ ok: true });
}
