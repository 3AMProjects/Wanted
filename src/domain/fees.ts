export type FeeConfig = {
  postingFeeBps: number;
  withdrawalFeeBps: number;
  cancelFeeBps: number;
};

const BPS = 10_000;

/** Fees round up to the next Rupiah so the platform never under-collects. */
export function feeOf(amount: number, bps: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return Math.ceil((amount * bps) / BPS);
}

/** What the poster pays up front: the reward goes to escrow, the fee to the platform. */
export function postingCharge(reward: number, cfg: FeeConfig) {
  const fee = feeOf(reward, cfg.postingFeeBps);
  return { reward, fee, total: reward + fee };
}

/**
 * Cancelling (or expiring) a post: the cancel fee is taken from the reward and
 * the rest goes back to the poster. The posting fee is not refunded.
 */
export function cancellationSplit(reward: number, cfg: FeeConfig) {
  const fee = feeOf(reward, cfg.cancelFeeBps);
  return { fee, refund: reward - fee };
}

export function withdrawalSplit(amount: number, cfg: FeeConfig) {
  const fee = feeOf(amount, cfg.withdrawalFeeBps);
  if (fee >= amount) throw new Error("Withdrawal amount does not cover the fee");
  return { fee, net: amount - fee };
}
