#!/usr/bin/env node
/**
 * Descobrir skill CLI — setup | setup-status | persist-candidate | accept | export
 * Zero dependencies. SQLite is canonical; JSON is export-only.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { canonicalizeCandidatePackage } from "./src/candidate-package.mjs";
import { sanitizeErrorMessage } from "./src/errors.mjs";
import {
  getGraphifyToolStatus,
  setupGraphifyTool,
} from "./src/graphify-tool.mjs";
import { prepareRun } from "./src/prepare-run.mjs";
import {
  acceptBaseline,
  exportPackage,
  findCandidateByHash,
  openStore,
  packageToExportJson,
  persistCandidate,
} from "./src/store.mjs";

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * @param {string} name
 * @param {Record<string, string | boolean>} flags
 */
function requireFlag(name, flags) {
  const value = flags[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  try {
    if (!Array.isArray(argv) || argv.length === 0) {
      throw new Error(
        "usage: setup | setup-status | prepare | persist-candidate | accept | export",
      );
    }
    const [command, ...rest] = argv;
    const flags = parseArgs(rest);

    switch (command) {
      case "setup": {
        const result = await setupGraphifyTool();
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            installed: result.installed,
            version: result.version,
            matches_pin: result.matches_pin,
            pinned_version: result.pinned_version,
            package: result.package,
            uv_available: result.uv_available,
          })}\n`,
        );
        return 0;
      }
      case "setup-status": {
        const result = await getGraphifyToolStatus();
        process.stdout.write(
          `${JSON.stringify({
            installed: result.installed,
            version: result.version,
            matches_pin: result.matches_pin,
            pinned_version: result.pinned_version,
            package: result.package,
            uv_available: result.uv_available,
            setup_command: result.setup_command,
          })}\n`,
        );
        return 0;
      }
      case "prepare":
      case "run-start": {
        const namespace = requireFlag("namespace", flags);
        const logicalRepo = requireFlag("logical-repo", flags);
        const projectPath = requireFlag("project-path", flags);
        /** @type {Record<string, unknown>} */
        const prepareInput = {
          namespace,
          logical_repo: logicalRepo,
          project_path: projectPath,
        };
        if (typeof flags["source-revision"] === "string") {
          prepareInput.source_revision = flags["source-revision"];
        }
        if (typeof flags["run-id"] === "string") {
          prepareInput.run_id = flags["run-id"];
        }
        if (typeof flags.db === "string") {
          prepareInput.db = flags.db;
        }
        if (typeof flags["obsidian-root"] === "string") {
          prepareInput.obsidian_root = flags["obsidian-root"];
        }
        const result = await prepareRun(prepareInput);
        // Sanitized public summary — no absolute paths.
        const summary = {
          status: result.status,
          run_id: result.run_id,
          namespace: result.namespace,
          logical_repo: result.logical_repo,
          source_revision: result.source_revision,
          acquisition_mode: result.acquisition_mode,
          manifest_id: result.manifest_id,
          descriptor_sha256: result.descriptor_sha256,
          chunk_index: result.chunk_index,
          phase_timings_ms: result.phase_timings_ms,
          graphify: result.graphify,
        };
        process.stdout.write(`${JSON.stringify(summary)}\n`);
        return 0;
      }
      case "persist-candidate": {
        const dbPath = requireFlag("db", flags);
        const inputPath = requireFlag("input", flags);
        const raw = JSON.parse(readFileSync(inputPath, "utf8"));
        // CLI input contract is the Explorer draft — always canonicalize.
        const pkg = canonicalizeCandidatePackage(raw);
        const store = openStore(dbPath);
        try {
          const result = persistCandidate(store, pkg);
          process.stdout.write(
            `${JSON.stringify({
              status: "ok",
              candidate_id: result.candidate_id,
              created: result.created,
              canonical_graph_hash: pkg.graph_index.canonical_graph_hash,
            })}\n`,
          );
        } finally {
          store.close();
        }
        return 0;
      }
      case "accept": {
        const dbPath = requireFlag("db", flags);
        const store = openStore(dbPath);
        try {
          let candidateId =
            typeof flags["candidate-id"] === "string" ? flags["candidate-id"] : "";
          if (!candidateId) {
            const namespace = requireFlag("namespace", flags);
            const logicalRepo = requireFlag("logical-repo", flags);
            const graphHash = requireFlag("graph-hash", flags);
            candidateId = findCandidateByHash(store, {
              namespace,
              logical_repo: logicalRepo,
              graph_hash: graphHash,
            }) ?? "";
            if (!candidateId) {
              throw new Error("candidate not found for namespace/logical-repo/graph-hash");
            }
          }
          const approver =
            typeof flags.approver === "string" ? flags.approver : "";
          const result = acceptBaseline(store, {
            candidate_id: candidateId,
            approver,
          });
          process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
        } finally {
          store.close();
        }
        return 0;
      }
      case "export": {
        const dbPath = requireFlag("db", flags);
        const outputPath = requireFlag("output", flags);
        const store = openStore(dbPath);
        try {
          /** @type {Parameters<typeof exportPackage>[1]} */
          const q = {};
          if (typeof flags["candidate-id"] === "string") {
            q.candidate_id = flags["candidate-id"];
          } else {
            q.accepted = true;
            q.namespace = requireFlag("namespace", flags);
            q.logical_repo = requireFlag("logical-repo", flags);
          }
          const pkg = exportPackage(store, q);
          writeFileSync(outputPath, packageToExportJson(pkg), {
            encoding: "utf8",
            mode: 0o600,
          });
          process.stdout.write(
            `${JSON.stringify({
              status: "ok",
              canonical_graph_hash: pkg.graph_index.canonical_graph_hash,
            })}\n`,
          );
        } finally {
          store.close();
        }
        return 0;
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } catch (err) {
    process.stderr.write(`${sanitizeErrorMessage(err)}\n`);
    return 1;
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
