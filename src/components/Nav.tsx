import Link from "next/link";
import { useRouter } from "next/router";
import styles from "./Nav.module.css";

export const Nav: React.FC<{ isEditing: boolean }> = (props) => {
  const router = useRouter();

  return (
    <nav className={styles.nav}>
      <ul>
        <li>
          <Link href="/">
            <a>Album list</a>
          </Link>
        </li>

        {!props.isEditing ? (
          <li>
            <Link href={router.asPath + "/edit"}>
              <a>Edit</a>
            </Link>
          </li>
        ) : null}

        {props.isEditing ? (
          <li>
            <Link href={router.asPath.replace("/edit", "")}>
              <a>Exit edit mode</a>
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
};