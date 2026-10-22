import { describe, expect, it } from "vitest";
import { cancellationSplit, feeOf, postingCharge, withdrawalSplit } from "./fees";

const cfg = { postingFeeBps: 500, withdrawalFeeBps: 250, cancelFeeBps: 2000 };

describe("fees", () => {
  it("rounds fees up to the next Rupiah", () => {
    expect(feeOf(100_001, 500)).toBe(5001);
    expect(feeOf(100_000, 500)).toBe(5000);
  });

  it("charges reward + posting fee up front", () => {
    expect(postingCharge(1_000_000, cfg)).toEqual({
      reward: 1_000_000,
      fee: 50_000,
      total: 1_050_000,
    });
  });

  it("takes 20% of the reward on cancel and refunds the rest", () => {
    expect(cancellationSplit(1_000_000, cfg)).toEqual({
      fee: 200_000,
      refund: 800_000,
    });
  });

  it("deducts the withdrawal fee from the payout", () => {
    expect(withdrawalSplit(1_000_000, cfg)).toEqual({ fee: 25_000, net: 975_000 });
  });

  it("rejects amounts that cannot cover the fee", () => {
    expect(() => withdrawalSplit(1, { ...cfg, withdrawalFeeBps: 10_000 })).toThrow();
  });

  it("rejects non-integer amounts", () => {
    expect(() => feeOf(10.5, 500)).toThrow();
  });
});
