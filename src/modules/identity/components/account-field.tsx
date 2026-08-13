import { cn } from "@/core/lib/utils";

interface AccountFieldProps {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  value: string;
  error?: string;
  required?: boolean;
  onChange: (value: string) => void;
}

/**
 * Same structure and styling as Checkout's `CheckoutField` — not imported
 * from there, since Checkout's `components/` are internal to that module,
 * not part of its public boundary. Kept as its own small copy here rather
 * than promoting either to a shared component, which is a larger change
 * this milestone doesn't need.
 */
export function AccountField({
  id,
  label,
  type = "text",
  autoComplete,
  value,
  error,
  required,
  onChange,
}: AccountFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "mt-1.5 w-full rounded-md border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          error
            ? "border-destructive focus-visible:ring-destructive"
            : "border-border focus-visible:ring-ring",
        )}
      />
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
