import type { ReactNode } from "react";

/**
 * Shared loading/empty/error presentation for the Admin Panel (IMP-043) —
 * one place so Products, Categories, and every future admin list share
 * identical states rather than each inventing their own.
 */

export function AdminLoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function AdminErrorState({
  message = "Something went wrong. Please try again.",
}: {
  message?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
    >
      {message}
    </div>
  );
}
