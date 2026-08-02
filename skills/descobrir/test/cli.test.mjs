import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { main } from "../cli.mjs";
import { canonicalizeCandidatePackage } from "../src/candidate-package.mjs";
import { coverageDraftInputs, explorerDraft } from "./fixtures.mjs";

const temps = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "descobrir-cli-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

describe("descobrir CLI", () => {
  test("persist-candidate → accept → export round-trip", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "store.sqlite");
    const draftPath = join(dir, "draft.json");
    const outPath = join(dir, "export.json");

    const draft = explorerDraft({
      coverage_report: coverageDraftInputs(),
    });
    const expected = canonicalizeCandidatePackage(draft);
    writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

    const persistCode = await main([
      "persist-candidate",
      "--db",
      dbPath,
      "--input",
      draftPath,
    ]);
    assert.equal(persistCode, 0);

    const acceptCode = await main([
      "accept",
      "--db",
      dbPath,
      "--namespace",
      expected.namespace,
      "--logical-repo",
      expected.logical_repo,
      "--graph-hash",
      expected.graph_index.canonical_graph_hash,
      "--approver",
      "Marley",
    ]);
    assert.equal(acceptCode, 0);

    const exportCode = await main([
      "export",
      "--db",
      dbPath,
      "--namespace",
      expected.namespace,
      "--logical-repo",
      expected.logical_repo,
      "--accepted",
      "--output",
      outPath,
    ]);
    assert.equal(exportCode, 0);
    const exported = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(
      exported.graph_index.canonical_graph_hash,
      expected.graph_index.canonical_graph_hash,
    );
  });

  test("accept without approver fails with non-zero exit", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "store.sqlite");
    const draftPath = join(dir, "draft.json");
    const draft = explorerDraft({
      coverage_report: coverageDraftInputs(),
    });
    const expected = canonicalizeCandidatePackage(draft);
    writeFileSync(draftPath, `${JSON.stringify(draft)}\n`, "utf8");
    await main(["persist-candidate", "--db", dbPath, "--input", draftPath]);
    const code = await main([
      "accept",
      "--db",
      dbPath,
      "--namespace",
      expected.namespace,
      "--logical-repo",
      expected.logical_repo,
      "--graph-hash",
      expected.graph_index.canonical_graph_hash,
    ]);
    assert.notEqual(code, 0);
  });

  test("unknown command fails", async () => {
    const code = await main(["nope"]);
    assert.notEqual(code, 0);
  });
});
