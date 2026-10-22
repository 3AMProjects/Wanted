/**
 * The payment layer is kept behind this interface so the escrow logic does not
 * depend on any one gateway. "mock" is for local dev; "xendit" is the planned
 * production provider.
 */
export interface PaymentProvider {
  readonly name: string;

  /** Hosted checkout for the poster's prepayment (reward + posting fee). */
  createCheckout(input: {
    externalId: string;
    amount: number;
    description: string;
    payerEmail?: string;
    successUrl: string;
    failureUrl: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;

  /** Bank transfer to a user's account for a withdrawal. */
  createPayout(input: {
    externalId: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountHolderName: string;
    description: string;
  }): Promise<{ providerRef: string }>;

  /** Authenticates and normalises a gateway webhook. Returns null if it should be ignored. */
  parseWebhook(headers: Headers, body: unknown): WebhookEvent | null;
}

export type WebhookEvent =
  | { type: "checkout.paid"; externalId: string; providerRef: string; amount: number }
  | { type: "checkout.expired"; externalId: string; providerRef: string }
  | { type: "payout.completed"; externalId: string; providerRef: string }
  | { type: "payout.failed"; externalId: string; providerRef: string; reason: string };

export class WebhookAuthError extends Error {}
