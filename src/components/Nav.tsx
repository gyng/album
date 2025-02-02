import Link from "next/link";
import { useRouter } from "next/router";
import styles from "./Nav.module.css";
import { ThemeToggle } from "./ThemeToggle";

export const Nav: React.FC<{
  isEditing: boolean;
  editable: boolean;
  albumName?: string;
}> = (props) => {
  const router = useRouter();

  return (
    <nav className={styles.nav}>
      <ul>
        <li>
          <Link href="/" style={{ textDecoration: "none" }}>
            ← Albums
          </Link>
        </li>
        <li>
          <ThemeToggle />
        </li>
        {props.albumName ? (
          <>
            <li style={{ alignSelf: "flex-end" }}>
              <Link
                href={`/map?filter_album=${props.albumName}`}
                style={{ textDecoration: "none" }}
              >
                Album map
              </Link>
            </li>
            <li style={{ alignSelf: "flex-end" }}>
              <Link
                href={`/slideshow?filter=${props.albumName}`}
                style={{ textDecoration: "none" }}
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
