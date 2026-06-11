import styles from "./SegmentedToggle.module.css";

export const SegmentedToggle = <T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) => {
  const { options, value, onChange, ariaLabel, className } = props;

  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    if (index === -1) return;
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
    }
  };

  return (
    <div
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={[
              styles.button,
              selected ? styles.buttonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
