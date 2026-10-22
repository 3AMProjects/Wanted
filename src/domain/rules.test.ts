import { describe, expect, it } from "vitest";
import { assertCanCancel, assertCanClaim, assertCanDispute, RuleError } from "./rules";

const now = new Date("2026-10-22T00:00:00Z");

describe("cancel", () => {
  it("is allowed on an active post with only settled claims", () => {
    expect(() =>
      assertCanCancel({ status: "active" }, [{ status: "dismissed" }, { status: "closed" }]),
    ).not.toThrow();
  });

  it.each(["pending", "rejected", "disputed"] as const)(
    "is blocked while a claim is %s",
    (status) => {
      expect(() => assertCanCancel({ status: "active" }, [{ status }])).toThrow(RuleError);
    },
  );
});

describe("claim", () => {
  const post = { status: "active" as const, posterId: "poster", expiresAt: null };

  it("rejects the poster claiming their own post", () => {
    expect(() => assertCanClaim(post, "poster", now)).toThrow(RuleError);
  });

  it("rejects expired posts", () => {
    expect(() =>
      assertCanClaim({ ...post, expiresAt: new Date("2026-10-21T00:00:00Z") }, "h", now),
    ).toThrow(RuleError);
  });
});

describe("dispute", () => {
  const claim = {
    status: "rejected" as const,
    hunterId: "h",
    disputeDeadline: new Date("2026-10-23T00:00:00Z"),
  };

  it("is allowed for the hunter inside the window", () => {
    expect(() => assertCanDispute(claim, "h", now)).not.toThrow();
  });

  it("is closed after the window", () => {
    expect(() =>
      assertCanDispute({ ...claim, disputeDeadline: new Date("2026-10-21T00:00:00Z") }, "h", now),
    ).toThrow(RuleError);
  });

  it("is only for the claim's hunter", () => {
    expect(() => assertCanDispute(claim, "someone", now)).toThrow(RuleError);
  });
});
