import Link from "next/link";
import styles from "./Nav.module.css";
import commonStyles from "../styles/common.module.css";
import { ThemeToggle } from "./ThemeToggle";

export const Nav: React.FC<{
  isEditing: boolean;
  editable: boolean;
  albumName?: string;
}> = (props) => {
  return (
    <nav className={styles.nav}>
      <ul className={commonStyles.topBar}>
        <li>
          <Link href="/" className={commonStyles.button}>
            ← Albums
          </Link>
        </li>
        <li>
          <ThemeToggle />
        </li>
        {props.albumName ? (
          <>
            <li>
              <Link
                href={`/map?filter_album=${props.albumName}`}
                className={commonStyles.button}
              >
                Album map
              </Link>
            </li>
            <li>
              <Link
                href={`/slideshow?filter=${props.albumName}`}
                className={commonStyles.button}
              >
                Album slideshow
              </Link>
            </li>
          </>
        ) : null}

        {/* Deprecate edit mode */}
        {/* 
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
        ) : null} */}
      </ul>
    </nav>
  );
};
