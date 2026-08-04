#!/usr/bin/env node
/**
 * explorer-query — ensure (build↑) + answer/context-pack (query↓) + generate-human
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stitchL1 } from "../explorer-l1/src/stitch.mjs";
import { bindJourney, loadJourneySpec } from "../explorer-l2/src/journey-bind.mjs";
import { buildContextPack } from "./src/context-pack.mjs";
import {
  bodyFromL1Pack,
  listProjections,
  writeHumanProjection,
} from "./src/generate-human.mjs";

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
    if (!cmd) {
      throw new Error(
        "usage: ensure | answer | generate-human | list-projections",
      );
    }
    const flags = parseArgs(rest);

    switch (cmd) {
      case "ensure": {
        // fixture-oriented: --frontier-dir + --system-namespace + --namespace + --repos a,b
        // optional --system-db --domain ignored in v1 minimal
        const namespace = req(flags, "namespace");
        const systemNs = req(flags, "system-namespace");
        const frontierDir = req(flags, "frontier-dir");
        const repoList = req(flags, "repos").split(",").map((s) => s.trim());
        const systemDb =
          typeof flags["system-db"] === "string"
            ? flags["system-db"]
            : join(frontierDir, "system.sqlite");
        const result = stitchL1({
          namespace,
          system_namespace: systemNs,
          system_db: systemDb,
          repos: repoList.map((logical_repo) => ({ logical_repo })),
          frontier_dir: frontierDir,
          skip_baseline_check: true,
          dry_run: flags["dry-run"] === true,
          config_target_repo:
            typeof flags["config-map"] === "string"
              ? Object.fromEntries(
                  flags["config-map"].split(",").map((p) => {
                    const [k, v] = p.split("=");
                    return [k, v];
                  }),
                )
              : undefined,
        });
        if (typeof flags.output === "string") {
          writeFileSync(flags.output, `${JSON.stringify(result, null, 2)}\n`);
        }
        process.stdout.write(
          `${JSON.stringify(
            {
              status: result.status,
              edge_count: result.edge_count,
              system_namespace: systemNs,
              system_db: flags["dry-run"] ? null : systemDb,
            },
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      case "answer": {
        const systemNs = req(flags, "system-namespace");
        const edgesPath = req(flags, "edges");
        const edgesDoc = JSON.parse(readFileSync(edgesPath, "utf8"));
        const edges = Array.isArray(edgesDoc) ? edgesDoc : edgesDoc.edges || [];
        let journey;
        if (typeof flags.journey === "string") {
          const spec = loadJourneySpec(flags.journey);
          journey = bindJourney(spec, edges);
        }
        let projections = [];
        if (flags["with-projections"] === true && typeof flags["repo-root"] === "string") {
          projections = listProjections(flags["repo-root"]).projections || [];
        }
        const pack = buildContextPack({
          system_namespace: systemNs,
          question: typeof flags.question === "string" ? flags.question : "",
          journey,
          edges,
          projections,
        });
        if (typeof flags.output === "string") {
          writeFileSync(flags.output, `${JSON.stringify(pack, null, 2)}\n`);
        }
        process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
        return 0;
      }
      case "generate-human": {
        const repoRoot = req(flags, "repo-root");
        const layer = req(flags, "layer"); // l0|l1|l2
        if (!["l0", "l1", "l2"].includes(layer)) {
          throw new Error("--layer must be l0|l1|l2");
        }
        const packPath = req(flags, "from-pack");
        const pack = JSON.parse(readFileSync(packPath, "utf8"));
        const body =
          layer === "l1" || layer === "l2"
            ? bodyFromL1Pack(pack)
            : `# Explorer L0\n\n${pack.question || ""}\n`;
        const r = writeHumanProjection({
          repo_root: repoRoot,
          layer: /** @type {"l0"|"l1"|"l2"} */ (layer),
          meta: {
            system_namespace: pack.system_namespace || null,
            journey_id: pack.journey_id || null,
          },
          body_markdown: body,
        });
        process.stdout.write(`${JSON.stringify({ status: "ok", ...r })}\n`);
        return 0;
      }
      case "list-projections": {
        const repoRoot = req(flags, "repo-root");
        process.stdout.write(
          `${JSON.stringify(listProjections(repoRoot), null, 2)}\n`,
        );
        return 0;
      }
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
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
