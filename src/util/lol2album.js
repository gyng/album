// @ts-check

import fs from "fs";
import process from "process";

const source = process.env["INPUT"];
const target = process.env["OTUPUT"];

if (!source || !target) {
  throw new Error("Specify INPUT and OUTPUT env vars");
}

const json = fs.readFileSync(source, "utf-8");
const input = JSON.parse(json);

const blocks = [
  {
    kind: "photo",
    data: {
      src: input.entries.images.background ?? input.entries.images.poster,
      title: input.title,
      kicker: input.subtitle,
    },
    ...input.entries.slice(1, -1).map((e) => {
      return {
        kind: "photo",
        data: {
          src: input.entries.images.background ?? input.entries.images.poster,
          title: input.title,
          description: input.writeup,
        },
      };
    }),
  },
];

const output = JSON.stringify(blocks, null, 2);
fs.writeFileSync(target, output, "utf8");
