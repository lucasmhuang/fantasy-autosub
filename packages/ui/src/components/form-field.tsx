import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

// A field's label, its hint and its error, the last two read out with the field.
type FieldLabels = { id: string; label: string; hint?: string; error?: string };

function fieldState({ id, hint, error }: FieldLabels) {
  const described = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described || undefined,
  };
}

function Field({ id, label, hint, error, children }: FieldLabels & { children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          <Icon name="warn" size={14} className="ico" />
          <span>{error}</span>
        </span>
      )}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export type TextFieldProps = FieldLabels &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
    // The 6-digit sign-in code: one large field a phone can fill from the email.
    code?: boolean;
  };

export function TextField({
  id,
  label,
  hint,
  error,
  code = false,
  className,
  ...input
}: TextFieldProps) {
  const codeInput: InputHTMLAttributes<HTMLInputElement> = code
    ? { inputMode: "numeric", autoComplete: "one-time-code" }
    : {};
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        className={cn("input", code && "code", className)}
        {...codeInput}
        {...input}
        {...fieldState({ id, label, hint, error })}
      />
    </Field>
  );
}

export type SelectFieldProps = FieldLabels &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options: { value: string; label: string }[];
  };

export function SelectField({
  id,
  label,
  hint,
  error,
  options,
  className,
  ...select
}: SelectFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select
        className={cn("input select", className)}
        {...select}
        {...fieldState({ id, label, hint, error })}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export type TextAreaFieldProps = FieldLabels &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "defaultValue" | "maxLength"> & {
    maxLength: number;
    defaultValue?: string;
  };

// The counter shows what was written when the page was served.
export function TextAreaField({
  id,
  label,
  hint,
  error,
  maxLength,
  defaultValue = "",
  className,
  ...textarea
}: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        className={cn("input textarea", className)}
        maxLength={maxLength}
        defaultValue={defaultValue}
        {...textarea}
        {...fieldState({ id, label, hint, error })}
      />
      <span className="counter">{`${defaultValue.length} of ${maxLength}`}</span>
    </Field>
  );
}

export type RadioOption = { value: string; label: string; description?: string; checked?: boolean };

export type RadioRowsProps = { legend: string; name: string; options: RadioOption[] };

export function RadioRows({ legend, name, options }: RadioRowsProps) {
  return (
    <fieldset className="fieldset">
      <legend className="t-label">{legend}</legend>
      {options.map((option) => (
        <label className="radio-row" key={option.value}>
          <input type="radio" name={name} value={option.value} defaultChecked={option.checked} />
          <span>
            <b>{option.label}</b>
            {option.description && <span className="d">{option.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
