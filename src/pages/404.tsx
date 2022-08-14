import Link from "next/link";
import React from "react";

import styles from "./404.module.css";

export default function FourOhFour() {
  return (
    <div className={styles.error}>
      <h1>🔥</h1>
      <Link href="/">
        <a>404. Back to album list</a>
      </Link>
    </div>
  );
}
