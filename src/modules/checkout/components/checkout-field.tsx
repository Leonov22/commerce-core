import { cn } from "@/core/lib/utils";

interface CheckoutFieldProps {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  value: string;
  error?: string;
  required?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export function CheckoutField({
  id,
  label,
  type = "text",
  autoComplete,
  value,
  error,
  required,
  onChange,
  onBlur,
}: CheckoutFieldProps) {
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
        onBlur={onBlur}
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
