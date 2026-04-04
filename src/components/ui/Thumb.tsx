import common from "../../styles/common.module.css";

export const Thumb = (
  props: {
    size?: "small";
  } & React.ImgHTMLAttributes<HTMLImageElement>,
) => {
  const { size, className, alt = "", ...rest } = props;
  const base = size === "small" ? common.thumbSmall : common.thumb;
  return (
    <img
      className={[base, className].filter(Boolean).join(" ")}
      alt={alt}
      {...rest}
    />
  );
};
