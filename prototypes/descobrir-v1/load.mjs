#!/usr/bin/env node
/**
 * Context Loader CLI (Task 2) — "load a flow as context".
 *
 *   node load.mjs --config <file> --flow <flowId> [--depth N]
 *
 * Reads the Descobrir graph from <prototypeRoot>/output, selects the bounded
 * subgraph around the flow, resolves the code of nodes that carry a verified
 * repository reference on demand (git show at the pinned revision), writes a
 * context slice to output/context-slice.json, and prints a summary. Read-only
 * over the target repo; code is loaded surgically, never in bulk.
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "./src/config.mjs";
import { readFileAtRevision } from "./src/git-source.mjs";
import { selectSubgraph, resolveContext } from "./src/context-loader.mjs";

const PROTOTYPE_ROOT = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { depth: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config") out.config = argv[(i += 1)];
    else if (a === "--flow") out.flow = argv[(i += 1)];
    else if (a === "--depth") out.depth = Number(argv[(i += 1)]);
    else return { ok: false, reason: `unknown argument '${a}'` };
  }
  if (!out.config) return { ok: false, reason: "missing --config <file>" };
  if (!out.flow) return { ok: false, reason: "missing --flow <flowId>" };
  if (!Number.isInteger(out.depth) || out.depth < 1) return { ok: false, reason: "--depth must be a positive integer" };
  return { ok: true, ...out };
}

export function main({
  argv = process.argv.slice(2),
  prototypeRoot = PROTOTYPE_ROOT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`CliError: ${parsed.reason}\n`);
    return 1;
  }

  let config;
  try {
    const text = readFileSync(parsed.config, "utf8");
    config = loadConfig({ configText: text, cwd: dirname(parsed.config) });
  } catch (err) {
    stderr.write(`${err.name || "ConfigError"}: ${err.message}\n`);
    return 1;
  }

  const outputRoot = join(prototypeRoot, "output");
  let records;
  let relations;
  try {
    records = JSON.parse(readFileSync(join(outputRoot, "knowledge-records.json"), "utf8"));
    relations = JSON.parse(readFileSync(join(outputRoot, "relations.json"), "utf8"));
  } catch (err) {
    stderr.write(`GraphError: cannot read graph in output/ (run the indexer first): ${err.message}\n`);
    return 1;
  }

  let slice;
  try {
    const subgraph = selectSubgraph({ records, relations, rootId: parsed.flow, depth: parsed.depth });
    slice = resolveContext({ subgraph, resolver: config.resolver, readAtRevision: readFileAtRevision });
  } catch (err) {
    stderr.write(`${err.name || "LoadError"}: ${err.message}\n`);
    return 1;
  }

  const document = {
    root: parsed.flow,
    namespace: config.namespace,
    source_revision: config.source_revision,
    depth: parsed.depth,
    nodes: slice.nodes,
    relations: slice.relations,
  };
  writeFileSync(join(outputRoot, "context-slice.json"), `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  const resolved = slice.nodes.filter((n) => n.code && n.code.resolved).length;
  const withPointer = slice.nodes.filter((n) => n.code !== null).length;
  const summary = {
    root: parsed.flow,
    depth: parsed.depth,
    nodes: slice.nodes.length,
    relations: slice.relations.length,
    code_resolved: resolved,
    code_pointers: withPointer,
  };
  stdout.write(`${JSON.stringify(summary)}\n`);
  return 0;
}

const isDirectEntry = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isDirectEntry) {
  process.exitCode = main();
}
