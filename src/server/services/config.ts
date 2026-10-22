import "server-only";
import type { FeeConfig } from "@/domain/fees";
import { env } from "@/lib/env";

export function feeConfig(): FeeConfig {
  const e = env();
  return {
    postingFeeBps: e.POSTING_FEE_BPS,
    withdrawalFeeBps: e.WITHDRAWAL_FEE_BPS,
    cancelFeeBps: e.CANCEL_FEE_BPS,
  };
}
