export const extractDateFromExifString = (exifString: string): Date | null => {
  const exifData: any =
    exifString &&
    Object.fromEntries(
      exifString.split("\n").map((line: string) => {
        const [key, ...value] = line.split(":");
        return [key, value.join(":").trim()];
      }),
    );

  try {
    if (exifData["EXIF DateTimeOriginal"]) {
      const splitDate = exifData["EXIF DateTimeOriginal"]
        .split(" ")[0]
        .replace(/:/g, "-");
      const splitTime = exifData["EXIF DateTimeOriginal"].split(" ")[1];

      const dateTimeOriginal = new Date(`${splitDate}T${splitTime}`);

      if (exifData["EXIF OffsetTime"]) {
        // This is kind of funky, needs verification
        const [offsetHours, offsetMinutes] = exifData["EXIF OffsetTime"]
          .split(":")
          .map(Number);

        dateTimeOriginal.setHours(dateTimeOriginal.getHours() + offsetHours);
        dateTimeOriginal.setMinutes(
          dateTimeOriginal.getMinutes() + offsetMinutes,
        );
      }

      return dateTimeOriginal;
    } else {
      return null;
    }
  } catch (err) {
    console.error("Error parsing exif data", err);
    return null;
  }
};
