import Link from "next/link";
import { useRouter } from "next/router";
import styles from "./Nav.module.css";

export const Nav: React.FC<{ isEditing: boolean; editable: boolean }> = (
  props
) => {
  const router = useRouter();

  return (
    <nav className={styles.nav}>
      <ul>
        <li>
          <Link href="/" style={{ textDecoration: "none" }}>
            ← Albums
          </Link>
        </li>

        {props.editable && !props.isEditing ? (
          <li>
            <Link href={router.asPath + "/edit"}>Edit</Link>
          </li>
        ) : null}

        {props.editable && props.isEditing ? (
          <li>
            <Link href={router.asPath.replace("/edit", "")}>
              Exit edit mode
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
};
