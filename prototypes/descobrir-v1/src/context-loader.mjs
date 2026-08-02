/**
 * Context Loader (Task 2) — the graph CONSUMER.
 *
 * Turns a Descobrir graph into loadable context: select a bounded subgraph from
 * a root node (traversal over relations) and resolve the code of nodes that
 * carry a repository reference, on demand, through an injected git reader.
 *
 * This is the "flow as a variable" mechanism: the graph is the resident map
 * (cheap, holds pointers); the code is the page loaded on access (via git show
 * at the pinned revision) and never resident in bulk. Pure selection + injected
 * IO; no live git in this module.
 */
import { parseRepositoryReference, ProvenanceError } from "./provenance.mjs";

export class ContextLoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContextLoaderError";
  }
}

function byIdCmp(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Bounded breadth-first selection of the induced subgraph around `rootId`.
 * `depth` is the number of hops from the root. Relations are the induced set
 * (both endpoints inside the visited node set), deterministically sorted.
 *
 * @param {{records: object[], relations: object[], rootId: string, depth?: number}} input
 * @returns {{nodes: object[], relations: object[]}}
 */
export function selectSubgraph({ records, relations, rootId, depth = 2 }) {
  if (!Array.isArray(records)) throw new ContextLoaderError("records must be an array");
  if (!Array.isArray(relations)) throw new ContextLoaderError("relations must be an array");
  const byId = new Map(records.map((r) => [r.id, r]));
  if (!byId.has(rootId)) throw new ContextLoaderError(`root node not found: ${rootId}`);

  const visited = new Set([rootId]);
  let frontier = [rootId];
  for (let hop = 0; hop < depth; hop += 1) {
    const next = [];
    for (const id of frontier) {
      for (const rel of relations) {
        const other =
          rel.from_record === id ? rel.to_record : rel.to_record === id ? rel.from_record : null;
        if (other !== null && byId.has(other) && !visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  const nodes = [...visited].map((id) => byId.get(id)).sort(byIdCmp);
  const subRelations = relations
    .filter((r) => visited.has(r.from_record) && visited.has(r.to_record))
    .sort(byIdCmp);
  return { nodes, relations: subRelations };
}

function resolveNodeCode(node, resolver, readAtRevision) {
  const repoEv = Array.isArray(node.evidence)
    ? node.evidence.find((e) => e.kind === "repository")
    : undefined;
  if (repoEv === undefined) return null;

  let parsed;
  try {
    parsed = parseRepositoryReference(repoEv.uri);
  } catch (err) {
    if (err instanceof ProvenanceError) return { resolved: false, reason: "unparseable-uri" };
    throw err;
  }

  const cwd = resolver[parsed.logicalRepo];
  if (typeof cwd !== "string" || cwd === "") {
    return { resolved: false, reason: "repo-not-available", path: parsed.path };
  }

  let bytes;
  try {
    bytes = readAtRevision({ cwd, revision: parsed.sourceRevision, path: parsed.path });
  } catch (err) {
    if (err instanceof Error && err.name === "GitSourceError") {
      return { resolved: false, reason: "git-unresolved", path: parsed.path };
    }
    throw err;
  }

  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
  const snippet = text.split("\n").slice(parsed.startLine - 1, parsed.endLine).join("\n");
  return {
    resolved: true,
    path: parsed.path,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    text: snippet,
  };
}

/**
 * Resolve the on-demand code for every node in the subgraph that carries a
 * repository reference. Nodes without one carry `code: null`. Expected reader
 * failures (GitSourceError) mark the node unresolved; programmer errors throw.
 *
 * @param {{subgraph: {nodes: object[], relations: object[]}, resolver: Record<string,string>, readAtRevision: Function}} input
 * @returns {{nodes: object[], relations: object[]}}
 */
export function resolveContext({ subgraph, resolver, readAtRevision }) {
  if (typeof readAtRevision !== "function") {
    throw new ContextLoaderError("readAtRevision must be a function");
  }
  const res = resolver ?? {};
  const nodes = subgraph.nodes.map((node) => ({
    ...node,
    code: resolveNodeCode(node, res, readAtRevision),
  }));
  return { nodes, relations: subgraph.relations };
}
