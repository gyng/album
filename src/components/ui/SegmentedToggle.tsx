import styles from "./SegmentedToggle.module.css";

export const SegmentedToggle = <T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) => {
  const { options, value, onChange, ariaLabel, className } = props;
  return (
    <div
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={[
            styles.button,
            option.value === value ? styles.buttonActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
