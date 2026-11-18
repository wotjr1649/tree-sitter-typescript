// Writes the public node-kind and field-name surface of each grammar from its src/node-types.json:
//   test/node-kinds/typescript.txt, test/node-kinds/tsx.txt
// One line per kind, sorted: a named kind is written bare or with its field names (`call_expression{arguments,function,type_arguments}`);
// an anonymous kind (keyword or punctuation token) is a JSON string (`"out"`). Node kinds and field names are a public
// contract (AGENTS.md): a removal or rename must show up as a reviewable diff here, an addition as a plain added line.
// CI runs this script and `git diff --exit-code test/node-kinds`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));

for (const grammar of ["typescript", "tsx"]) {
  const nodeTypes = JSON.parse(readFileSync(`${root}${grammar}/src/node-types.json`, "utf8"));
  const lines = new Set();
  for (const { type, named, fields } of nodeTypes) {
    if (!named) {
      lines.add(JSON.stringify(type));
      continue;
    }
    const names = Object.keys(fields ?? {}).sort();
    lines.add(names.length ? `${type}{${names.join(",")}}` : type);
  }
  writeFileSync(`${here}${grammar}.txt`, `${[...lines].sort().join("\n")}\n`);
}
