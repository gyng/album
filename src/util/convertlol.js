// @ts-check

import fs from "fs";

const toConvert = [
  {
    i: "japan/japan.json",
    o: "japan/manifest.json",
    n: "japan",
  },
];

toConvert.forEach((s) => {
  const source = s.i;
  const target = s.o;
  const targetDir = s.n;
  console.log(source, target, targetDir);

  if (!source || !target || !targetDir) {
    throw new Error("Specify INPUT and OUTPUT env vars");
  }

  const json = fs.readFileSync(source, "utf-8");
  const input = JSON.parse(json);

  const firstEntry = input.entries.shift();

  const blocks = [
    {
      kind: "photo",
      data: {
        src: firstEntry.images.background ?? firstEntry.images.poster,
        title: input.title,
        kicker: input.subtitle,
      },
      formatting: {
        immersive: true,
      },
    },
    ...input.entries.map((e) => {
      return {
        kind: e.images?.background || e.images?.poster ? "photo" : "text",
        data: {
          src: e.images?.background ?? e.images?.poster,
          title: e.title,
          description: e.writeup,
        },
      };
    }),
  ];

  const output = JSON.stringify(
    {
      name: targetDir,
      blocks,
    },
    null,
    2,
  );

  fs.writeFileSync(target, output, "utf8");
});
