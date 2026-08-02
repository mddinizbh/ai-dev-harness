import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Seam under test (Task 2 — context-loader): given a Descobrir graph, select a
// bounded subgraph from a root node (traversal) and resolve the code of nodes
// that carry a repository reference, on demand, through an injected reader.
// Module does not exist yet — RED first.
import {
  selectSubgraph,
  resolveContext,
  ContextLoaderError,
} from "../src/context-loader.mjs";

const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";
const REPO = "nori-cloud";

function repoUri(path, start, end) {
  return `repo://${REPO}@${REV}/${path}#L${start}-L${end}`;
}

function node(id, type, evidence = []) {
  return { id, type, name: id, status: "hipótese", evidence };
}

function rel(id, relationType, from, to) {
  return { id, relation_type: relationType, from_record: from, to_record: to, status: "hipótese" };
}

// Synthetic star: flow ← endpoint ← service → {event, table}; plus a far node.
const RECORDS = [
  node("flow:F", "Flow"),
  node("endpoint:E", "Endpoint"),
  node("service:S", "Service", [
    { kind: "artifact", artifact_path: ".claude/explorer/endpoints.md", content_sha256: "a".repeat(64), manifest_id: "m", range: { start_line: 1, end_line: 1 } },
    { kind: "repository", uri: repoUri("domains/s/service.go", 2, 3) },
  ]),
  node("event:V", "Event"),
  node("table:T", "Table"),
  node("far:X", "Service"),
];
const RELATIONS = [
  rel("triggers:E:F", "TRIGGERS", "endpoint:E", "flow:F"),
  rel("exposes:S:E", "EXPOSES", "service:S", "endpoint:E"),
  rel("publishes:S:V", "PUBLISHES", "service:S", "event:V"),
  rel("persists:S:T", "PERSISTS_TO", "service:S", "table:T"),
  rel("near:T:X", "EXPOSES", "table:T", "far:X"),
];

describe("selectSubgraph — bounded traversal from a root", () => {
  test("depth 1 = root + direct neighbors, induced relations only", () => {
    const g = selectSubgraph({ records: RECORDS, relations: RELATIONS, rootId: "flow:F", depth: 1 });
    assert.deepStrictEqual(g.nodes.map((n) => n.id), ["endpoint:E", "flow:F"]);
    assert.deepStrictEqual(g.relations.map((r) => r.id), ["triggers:E:F"]);
  });

  test("depth 2 reaches the service and includes both induced edges", () => {
    const g = selectSubgraph({ records: RECORDS, relations: RELATIONS, rootId: "flow:F", depth: 2 });
    assert.deepStrictEqual(g.nodes.map((n) => n.id), ["endpoint:E", "flow:F", "service:S"]);
    assert.deepStrictEqual(g.relations.map((r) => r.id), ["exposes:S:E", "triggers:E:F"]);
  });

  test("depth 3 pulls the service's events and tables (both edge directions)", () => {
    const g = selectSubgraph({ records: RECORDS, relations: RELATIONS, rootId: "flow:F", depth: 3 });
    assert.deepStrictEqual(g.nodes.map((n) => n.id), [
      "endpoint:E", "event:V", "flow:F", "service:S", "table:T",
    ]);
    assert.ok(g.relations.some((r) => r.id === "publishes:S:V"));
    assert.ok(g.relations.some((r) => r.id === "persists:S:T"));
    assert.ok(!g.nodes.some((n) => n.id === "far:X"), "far:X is beyond depth 3");
  });

  test("rejects an unknown root with a typed error", () => {
    assert.throws(
      () => selectSubgraph({ records: RECORDS, relations: RELATIONS, rootId: "flow:NOPE", depth: 1 }),
      ContextLoaderError,
    );
  });
});

describe("resolveContext — lazy code resolution over a subgraph", () => {
  const subgraph = selectSubgraph({ records: RECORDS, relations: RELATIONS, rootId: "flow:F", depth: 2 });

  test("resolves the repository snippet of a node that carries one", () => {
    const reader = ({ cwd, revision, path }) => {
      assert.strictEqual(cwd, "/local/nori");
      assert.strictEqual(revision, REV);
      assert.strictEqual(path, "domains/s/service.go");
      return "line1\nline2\nline3\nline4\n";
    };
    const ctx = resolveContext({
      subgraph,
      resolver: { "nori-cloud": "/local/nori" },
      readAtRevision: reader,
    });
    const service = ctx.nodes.find((n) => n.id === "service:S");
    assert.strictEqual(service.code.resolved, true);
    assert.strictEqual(service.code.text, "line2\nline3");
    assert.strictEqual(service.code.path, "domains/s/service.go");
  });

  test("nodes without a repository reference carry code=null", () => {
    const ctx = resolveContext({
      subgraph,
      resolver: { "nori-cloud": "/local/nori" },
      readAtRevision: () => "x\n",
    });
    const flow = ctx.nodes.find((n) => n.id === "flow:F");
    assert.strictEqual(flow.code, null);
  });

  test("a GitSourceError from the reader marks the node unresolved (not thrown)", () => {
    const reader = () => {
      const err = new Error("git show failed");
      err.name = "GitSourceError";
      throw err;
    };
    const ctx = resolveContext({
      subgraph,
      resolver: { "nori-cloud": "/local/nori" },
      readAtRevision: reader,
    });
    const service = ctx.nodes.find((n) => n.id === "service:S");
    assert.strictEqual(service.code.resolved, false);
    assert.strictEqual(service.code.reason, "git-unresolved");
  });

  test("a repo not present in the resolver is reported, not crashed", () => {
    const ctx = resolveContext({
      subgraph,
      resolver: {},
      readAtRevision: () => "x\n",
    });
    const service = ctx.nodes.find((n) => n.id === "service:S");
    assert.strictEqual(service.code.resolved, false);
    assert.strictEqual(service.code.reason, "repo-not-available");
  });
});
