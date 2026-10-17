import type { ReactNode } from "react";
import { getResizedAlbumVideoSrc } from "../../util/getResizedAlbumImageSrc";
import styles from "./HoverPlayClip.module.css";
import { useHoverPlayClip } from "./useHoverPlayClip";

type HoverPlayClipProps = {
  /** The clip a tile's poster stands for, or one of its scene rows. */
  clipPath: string | null;
  /** The consumer's own tile class: this wrapper carries no display of its own. */
  className?: string | undefined;
  /** The poster, rendered exactly as it was. */
  children: ReactNode;
};

/**
 * A poster that plays the clip it stands for while a pointer is on it.
 *
 * The children are the poster the tile already rendered and are not touched:
 * what is added is a wrapper to position the preview against, and — only once a
 * pointer has qualified — one muted, inline, looping `<video>` over the top.
 * Nothing is fetched before that first enter, because `preload="none"` says so
 * and the element does not exist until then.
 */
export const HoverPlayClip = ({ clipPath, className, children }: HoverPlayClipProps) => {
  const { shouldRenderVideo, isActive, videoRef, handlers } = useHoverPlayClip(clipPath);

  // Arming implies a playable, non-null path, but only the compiler needs to be
  // told: this is the check that narrows `clipPath` for the URL builder.
  return (
    <span {...handlers} className={[styles.wrapper, className].filter(Boolean).join(" ")}>
      {children}
      {shouldRenderVideo && clipPath !== null ? (
        <video
          ref={videoRef}
          className={styles.preview}
          src={getResizedAlbumVideoSrc(clipPath)}
          muted
          playsInline
          loop
          preload="none"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          hidden={!isActive}
        />
      ) : null}
    </span>
  );
};
