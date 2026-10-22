import "server-only";
import { env } from "@/lib/env";
import { mockProvider } from "./mock";
import type { PaymentProvider } from "./types";
import { xenditProvider } from "./xendit";

export function paymentProvider(): PaymentProvider {
  return env().PAYMENT_PROVIDER === "xendit" ? xenditProvider : mockProvider;
}

export const paymentExternalId = (paymentId: string) => `pay_${paymentId}`;
export const withdrawalExternalId = (withdrawalId: string) => `wd_${withdrawalId}`;
export const idFromExternalId = (externalId: string) => externalId.replace(/^(pay|wd)_/, "");
