import "server-only";
import type { WebhookEvent } from "@/server/payments/types";
import { idFromExternalId } from "@/server/payments";
import { markPaymentExpired, markPaymentPaid } from "./posts";
import { markPayoutCompleted, markPayoutFailed } from "./withdrawals";

export async function handlePaymentEvent(event: WebhookEvent) {
  const id = idFromExternalId(event.externalId);
  switch (event.type) {
    case "checkout.paid":
      return markPaymentPaid(id, event.amount);
    case "checkout.expired":
      return markPaymentExpired(id);
    case "payout.completed":
      return markPayoutCompleted(id);
    case "payout.failed":
      return markPayoutFailed(id, event.reason);
  }
}
