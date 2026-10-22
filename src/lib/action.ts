import "server-only";
import { z } from "zod";
import { RuleError } from "@/domain/rules";

export type ActionState = { error?: string; ok?: string } | undefined;

/**
 * Wraps a server action so rule and validation errors come back as form state
 * instead of crashing the page. Unexpected errors still throw.
 */
export function formAction(
  fn: (form: FormData) => Promise<string | void>,
): (prev: ActionState, form: FormData) => Promise<ActionState> {
  return async (_prev, form) => {
    try {
      const ok = await fn(form);
      return { ok: ok ?? "Berhasil." };
    } catch (err) {
      if (err instanceof RuleError) return { error: err.message };
      if (err instanceof z.ZodError) {
        return { error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      }
      throw err;
    }
  };
}
