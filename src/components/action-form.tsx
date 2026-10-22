"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type State = { error?: string; ok?: string } | undefined;

export function ActionForm({
  action,
  children,
  submitLabel,
  className = "space-y-3",
  danger = false,
}: {
  action: (prev: State, form: FormData) => Promise<State>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  danger?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <Submit label={submitLabel} danger={danger} />
    </form>
  );
}

function Submit({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
        danger ? "bg-red-600 hover:bg-red-700" : "bg-neutral-900 hover:bg-neutral-700"
      }`}
    >
      {pending ? "Memproses..." : label}
    </button>
  );
}
