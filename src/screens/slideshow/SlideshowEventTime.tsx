import type { ShellLogEntry } from "../../util/shellDiagnosticsLog";
import { formatEventAge } from "../../util/shellDiagnosticsLog";
import styles from "./SlideshowEventTime.module.css";

export const SlideshowEventTime = ({ entry, now }: { entry: ShellLogEntry; now: number }) => {
  const lastAt = entry.category === "gap" ? undefined : entry.lastAt;
  const repeated = lastAt !== undefined && lastAt !== entry.at;
  const stamp = (at: number, label?: string) => (
    <time dateTime={new Date(at).toISOString()} className={styles.stamp}>
      <span>
        {label}
        {new Date(at).toLocaleString("en-GB")}
      </span>
      <span>{formatEventAge(at, now)}</span>
    </time>
  );
  return (
    <div className={styles.timestamps}>
      {stamp(entry.at, repeated ? "First: " : "")}
      {repeated ? stamp(lastAt, "Latest: ") : null}
    </div>
  );
};
