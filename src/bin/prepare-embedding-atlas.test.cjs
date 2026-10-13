const sharp = require("sharp");
const { resizeAtlasCell } = require("./prepare-embedding-atlas.cjs");

it("keeps the central crop used by high-resolution cloud photographs", async () => {
  // Strong detail at the left must not pull the thumbnail away from the centre.
  const width = 144;
  const height = 48;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      if (x < 48) pixels.fill((x + y) % 2 ? 255 : 0, offset, offset + 3);
      else pixels[offset + 1] = 180;
    }
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const cell = await resizeAtlasCell(source, 48);
  const { data, info } = await sharp(cell).raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(48);
  expect(info.height).toBe(48);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    expect([...data.subarray(offset, offset + 3)]).toEqual([0, 180, 0]);
  }
});
