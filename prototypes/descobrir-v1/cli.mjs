#!/usr/bin/env node
/**
 * Descobrir v1 CLI command wrapper (ADR 0003).
 *
 * Parses argv (`--config <file>`), resolves+reads the config relative to cwd,
 * calls loadConfig, then runDescobrir with prototypeRoot derived from this
 * module's location and observedAt = now().toISOString(). Emits a sanitized
 * one-line JSON summary to stdout. All IO is injectable for tests; defaults
 * bind real Node IO + the real pipeline.
 *
 * Exit codes: 0 gate passed, 2 pipeline completed but gate false,
 * 1 argument/config/runtime blocker. Direct entry sets process.exitCode only
 * (never calls process.exit). Node built-ins only.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "./src/config.mjs";
import { runDescobrir } from "./src/pipeline.mjs";

const PROTOTYPE_ROOT = dirname(fileURLToPath(import.meta.url));

const defaultReadFile = (path) => readFileSync(path, "utf8");
const defaultRun = ({ config, prototypeRoot, observedAt }) =>
  runDescobrir({ config, prototypeRoot, observedAt });
const defaultNow = () => new Date();

function parseArgs(argv) {
  if (argv.length === 0) return { ok: false, reason: "missing required --config <file>" };
  if (argv[0] !== "--config") return { ok: false, reason: `unknown argument '${argv[0]}'` };
  if (argv.length < 2) return { ok: false, reason: "missing value for --config" };
  if (argv.length > 2) return { ok: false, reason: `unexpected extra argument '${argv[2]}'` };
  return { ok: true, configPath: argv[1] };
}

// Replace known absolute paths (longest first) with placeholders so blocker
// messages never leak resolver/prototype/config-dir machine paths.
function sanitizeMessage(message, knownPaths) {
  let out = message;
  for (const { path, placeholder } of knownPaths) {
    if (path && out.includes(path)) out = out.split(path).join(placeholder);
  }
  return out;
}

function buildSummary(result, passed) {
  return {
    status: passed ? "passed" : "failed",
    canonical_graph_hash: result.graphIndex.canonical_graph_hash,
    records: result.records.length,
    relations: result.relations.length,
    artifact_reference_percentage: result.coverageReport.provenance.artifact_reference_percentage,
    repository_verified_percentage: result.coverageReport.provenance.repository_verified_percentage,
  };
}

/**
 * Run the CLI with injectable IO. Returns an exit code (0/1/2); never throws.
 * @param {object} [options]
 */
export function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    cwd = process.cwd(),
    prototypeRoot = PROTOTYPE_ROOT,
    stdout = process.stdout,
    stderr = process.stderr,
    readFile = defaultReadFile,
    run = defaultRun,
    now = defaultNow,
  } = options;

  let configPathResolved = null;
  let config = null;

  const knownPaths = () => {
    const list = [{ path: prototypeRoot, placeholder: "<prototype>" }];
    if (configPathResolved) {
      list.push({ path: configPathResolved, placeholder: "<config-file>" });
      list.push({ path: dirname(configPathResolved), placeholder: "<config-dir>" });
    }
    if (config) {
      for (const value of Object.values(config.resolver || {})) {
        list.push({ path: value, placeholder: "<resolver>" });
      }
    }
    return list
      .filter((p) => p.path && typeof p.path === "string")
      .sort((a, b) => b.path.length - a.path.length);
  };

  const block = (name, message) => {
    stderr.write(`${name}: ${sanitizeMessage(message, knownPaths())}\n`);
    return 1;
  };

  const parsed = parseArgs(argv);
  if (!parsed.ok) return block("CliError", parsed.reason);

  configPathResolved = resolve(cwd, parsed.configPath);

  let configText;
  try {
    configText = readFile(configPathResolved);
  } catch (err) {
    return block(err.name || "ReadError", err.message);
  }

  try {
    config = loadConfig({ configText, cwd: dirname(configPathResolved) });
  } catch (err) {
    return block(err.name || "ConfigError", err.message);
  }

  let result;
  try {
    result = run({ config, prototypeRoot, observedAt: now().toISOString() });
  } catch (err) {
    return block(err.name || "PipelineError", err.message);
  }

  const passed = result?.coverageReport?.passed === true;
  stdout.write(`${JSON.stringify(buildSummary(result, passed))}\n`);
  return passed ? 0 : 2;
}

// Auto-run only when this module is the direct entry point.
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
