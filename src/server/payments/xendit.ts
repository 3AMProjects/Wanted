import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { WebhookAuthError, type PaymentProvider, type WebhookEvent } from "./types";

// NOTE: written against Xendit's Invoice (v2) and Disbursement APIs but not yet
// exercised against a real account. Verify field names in Xendit's test mode
// before going live; Xendit is also rolling out a newer Payouts v2 API.
const BASE = "https://api.xendit.co";

function authHeader() {
  const key = env().XENDIT_SECRET_KEY;
  if (!key) throw new Error("XENDIT_SECRET_KEY is not set");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function call<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-IDEMPOTENCY-KEY": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xendit ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type InvoiceCallback = { id: string; external_id: string; status: string; paid_amount?: number };
type DisbursementCallback = {
  id: string;
  external_id: string;
  status: string;
  failure_code?: string;
};

export const xenditProvider: PaymentProvider = {
  name: "xendit",

  async createCheckout(input) {
    const invoice = await call<{ id: string; invoice_url: string }>("/v2/invoices", {
      external_id: input.externalId,
      amount: input.amount,
      currency: "IDR",
      description: input.description,
      payer_email: input.payerEmail,
      success_redirect_url: input.successUrl,
      failure_redirect_url: input.failureUrl,
      invoice_duration: 86_400,
    });
    return { providerRef: invoice.id, checkoutUrl: invoice.invoice_url };
  },

  async createPayout(input) {
    const d = await call<{ id: string }>(
      "/disbursements",
      {
        external_id: input.externalId,
        amount: input.amount,
        bank_code: input.bankCode,
        account_holder_name: input.accountHolderName,
        account_number: input.accountNumber,
        description: input.description,
      },
      input.externalId,
    );
    return { providerRef: d.id };
  },

  parseWebhook(headers, body): WebhookEvent | null {
    const expected = env().XENDIT_CALLBACK_TOKEN;
    const token = headers.get("x-callback-token");
    if (!expected || !token || !safeEqual(token, expected)) {
      throw new WebhookAuthError("Invalid Xendit callback token");
    }

    const b = body as Partial<InvoiceCallback & DisbursementCallback>;
    if (!b.external_id || !b.id) return null;

    // Our external ids are prefixed so one endpoint can serve both callback types.
    if (b.external_id.startsWith("pay_")) {
      if (b.status === "PAID" || b.status === "SETTLED") {
        return {
          type: "checkout.paid",
          externalId: b.external_id,
          providerRef: b.id,
          amount: Number(b.paid_amount),
        };
      }
      if (b.status === "EXPIRED") {
        return { type: "checkout.expired", externalId: b.external_id, providerRef: b.id };
      }
    }
    if (b.external_id.startsWith("wd_")) {
      if (b.status === "COMPLETED") {
        return { type: "payout.completed", externalId: b.external_id, providerRef: b.id };
      }
      if (b.status === "FAILED") {
        return {
          type: "payout.failed",
          externalId: b.external_id,
          providerRef: b.id,
          reason: b.failure_code ?? "UNKNOWN",
        };
      }
    }
    return null;
  },
};
