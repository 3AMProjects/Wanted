import { env } from "@/lib/env";
import type { PaymentProvider } from "./types";

/**
 * Local-dev provider. Checkout sends the user to /dev/mock-pay, which marks the
 * payment paid directly. Payouts are completed right after they are requested.
 */
export const mockProvider: PaymentProvider = {
  name: "mock",

  async createCheckout({ externalId, amount }) {
    const url = new URL("/dev/mock-pay", env().APP_URL);
    url.searchParams.set("externalId", externalId);
    url.searchParams.set("amount", String(amount));
    return { providerRef: `mock_${externalId}`, checkoutUrl: url.toString() };
  },

  async createPayout({ externalId }) {
    return { providerRef: `mock_payout_${externalId}` };
  },

  parseWebhook() {
    return null;
  },
};
