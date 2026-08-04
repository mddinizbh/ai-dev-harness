#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { sanitizeErrorMessage } from "../explorer-l1/src/errors.mjs";
import { bindJourney, loadJourneySpec } from "./src/journey-bind.mjs";

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) throw new Error(`unexpected: ${t}`);
    const k = t.slice(2);
    const n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) out[k] = true;
    else {
      out[k] = n;
      i += 1;
    }
  }
  return out;
}

function req(flags, name) {
  const v = flags[name];
  if (typeof v !== "string" || !v) throw new Error(`--${name} required`);
  return v;
}

export async function main(argv) {
  try {
    const [cmd, ...rest] = argv;
    if (!cmd) throw new Error("usage: bind --spec <journey.json> --edges <edges.json>");
    const flags = parseArgs(rest);
    if (cmd === "bind") {
      const spec = loadJourneySpec(req(flags, "spec"));
      const edgesDoc = JSON.parse(readFileSync(req(flags, "edges"), "utf8"));
      const edges = Array.isArray(edgesDoc) ? edgesDoc : edgesDoc.edges || [];
      const result = bindJourney(spec, edges);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "complete" ? 0 : 0; // partial still 0; gaps in JSON
    }
    throw new Error(`unknown command: ${cmd}`);
  } catch (err) {
    process.stderr.write(`${sanitizeErrorMessage(err)}\n`);
    return 1;
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
