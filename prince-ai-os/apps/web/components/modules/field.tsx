import type { ComponentProps, ReactNode } from "react";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FieldErrors = Record<string, string[] | undefined>;

/** Label, control, optional hint and error, wired together for screen readers via ids. */
export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** aria props for a control inside <Field>. */
export function describedBy(id: string, error?: string, hint?: boolean) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby":
      [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined,
  } as const;
}

interface NamedField {
  /** Prefix that keeps ids unique when several forms share a page. */
  form: string;
  name: string;
  label: string;
  errors: FieldErrors;
  hint?: string;
  className?: string;
}

export function InputField({
  form,
  name,
  label,
  errors,
  hint,
  className,
  ...props
}: NamedField & Omit<ComponentProps<"input">, "name" | "form">) {
  const id = `${form}-${name}`;
  const error = errors[name]?.[0];
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <Input name={name} {...describedBy(id, error, !!hint)} {...props} />
    </Field>
  );
}

export function TextareaField({
  form,
  name,
  label,
  errors,
  hint,
  className,
  ...props
}: NamedField & Omit<ComponentProps<"textarea">, "name" | "form">) {
  const id = `${form}-${name}`;
  const error = errors[name]?.[0];
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <Textarea
        name={name}
        // An explicit row count sets the height instead of the default minimum.
        className={props.rows ? "min-h-0" : undefined}
        {...describedBy(id, error, !!hint)}
        {...props}
      />
    </Field>
  );
}

export function SelectField({
  form,
  name,
  label,
  errors,
  hint,
  className,
  options,
  ...props
}: NamedField &
  Omit<ComponentProps<"select">, "name" | "form"> & {
    options: { value: string; label: string }[];
  }) {
  const id = `${form}-${name}`;
  const error = errors[name]?.[0];
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <Select name={name} {...describedBy(id, error, !!hint)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A form's fields as a plain object of strings; the server parses and validates them. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === "string") values[k] = v;
  });
  return values;
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  );
}
