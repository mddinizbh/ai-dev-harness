import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { buildContextPack } from "../src/context-pack.mjs";
import {
  bodyFromL1Pack,
  listProjections,
  writeHumanProjection,
} from "../src/generate-human.mjs";

const dir = mkdtempSync(join(tmpdir(), "eq-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("context-pack + human", () => {
  test("pack extracts code pointers from evidence", () => {
    const pack = buildContextPack({
      system_namespace: "sys",
      edges: [
        {
          edge_id: "e1",
          from: { logical_repo: "a" },
          to: { logical_repo: "b" },
          contract_key: "GET /x",
          match_kind: "path_contract",
          score: 0.55,
          evidence: [
            {
              side: "from",
              file: "A.kt",
              line: 2,
              snippet: "call",
              revision: "r",
            },
            {
              side: "to",
              file: "B.java",
              line: 9,
              snippet: "map",
              revision: "r",
            },
          ],
        },
      ],
    });
    assert.equal(pack.code_pointers.length, 2);
    const hum = writeHumanProjection({
      repo_root: dir,
      layer: "l1",
      meta: { system_namespace: "sys" },
      body_markdown: bodyFromL1Pack(pack),
    });
    assert.ok(hum.path.endsWith(".explorer/L1.md"));
    const list = listProjections(dir);
    assert.equal(list.projections.length, 1);
  });
});
