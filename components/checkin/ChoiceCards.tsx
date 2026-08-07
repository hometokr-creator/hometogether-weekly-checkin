import { Check } from "lucide-react";

export interface ChoiceOption<Value extends string | number> {
  value: Value;
  label: string;
  description?: string;
  exclusive?: boolean;
}

export function SingleChoiceCards<Value extends string | number>({
  options,
  value,
  onChange,
  name,
}: {
  options: readonly ChoiceOption<Value>[];
  value?: Value;
  onChange: (value: Value) => void;
  name: string;
}) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`choice-card ${selected ? "choice-card-selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <span className="choice-copy">
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            <span className="choice-indicator" aria-hidden="true">
              {selected ? <Check size={18} strokeWidth={2.5} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MultiChoiceCards<Value extends string>({
  options,
  values,
  onChange,
  name,
}: {
  options: readonly ChoiceOption<Value>[];
  values: Value[];
  onChange: (values: Value[]) => void;
  name: string;
}) {
  const toggle = (option: ChoiceOption<Value>) => {
    if (option.exclusive) {
      onChange(values.includes(option.value) ? [] : [option.value]);
      return;
    }
    const exclusiveValues = new Set(options.filter((item) => item.exclusive).map((item) => item.value));
    const withoutExclusive = values.filter((item) => !exclusiveValues.has(item));
    onChange(
      values.includes(option.value)
        ? withoutExclusive.filter((item) => item !== option.value)
        : [...withoutExclusive, option.value],
    );
  };

  return (
    <div className="choice-list" role="group" aria-label={name}>
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={selected}
            className={`choice-card ${selected ? "choice-card-selected" : ""}`}
            onClick={() => toggle(option)}
          >
            <span className="choice-copy">{option.label}</span>
            <span className="choice-indicator choice-indicator-square" aria-hidden="true">
              {selected ? <Check size={18} strokeWidth={2.5} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
