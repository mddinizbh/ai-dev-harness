/**
 * Repository-evidence verifier + status promotion seam for Descobrir v1
 * (ADR 0002 §"Regras de status da fonte" + workflows/descobrir/contracts/
 * repo-reference.md).
 *
 * A `hipótese` entity is promoted to `comprovado` only when it has at least
 * one repository evidence AND every such evidence parses, matches the logical
 * repo + pinned source revision, resolves pinned bytes through the injected
 * reader, and every line range is in bounds. Artifact-only entities stay
 * hipótese and are never unresolved. contradição / stale / comprovado are
 * passed through unchanged. Inputs are never mutated; outputs are fresh,
 * sorted by id, with a deterministic unresolvedIds list (also sorted by id).
 *
 * The reader is injected ({revision, path}) => Buffer|string so this module
 * never touches live git. Production wiring wraps readFileAtRevision.
 */
import {
  parseRepositoryReference,
  verifyLineRange,
  ProvenanceError,
} from "./provenance.mjs";

export class RepoVerifierError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepoVerifierError";
  }
}

const HIPOTESE = "hipótese";
const COMPROVADO = "comprovado";

function fail(message) {
  throw new RepoVerifierError(message);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value === "") fail(`${label} must be a non-empty string`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortById(items) {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function toText(bytes) {
  return Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
}

/**
 * Only the production git reader's typed failure is expected. Every other
 * thrown value propagates so an implementation bug cannot masquerade as an
 * unresolved repository reference.
 */
function isExpectedReaderFailure(err) {
  return err instanceof Error && err.name === "GitSourceError";
}

/**
 * Verify one repository evidence item against the pinned logical repo +
 * revision through the injected reader. Returns 'verified' or 'unresolved'.
 * Propagates programmer errors (parse errors that aren't ProvenanceError,
 * non-Error throws from the reader, TypeError/ReferenceError, etc.).
 */
function verifyOneRepoEvidence(ev, logicalRepo, sourceRevision, readAtRevision) {
  let parsed;
  try {
    parsed = parseRepositoryReference(ev.uri);
  } catch (err) {
    if (err instanceof ProvenanceError) return "unresolved";
    throw err;
  }
  if (parsed.logicalRepo !== logicalRepo || parsed.sourceRevision !== sourceRevision) {
    return "unresolved";
  }
  let bytes;
  try {
    bytes = readAtRevision({ revision: parsed.sourceRevision, path: parsed.path });
  } catch (err) {
    if (isExpectedReaderFailure(err)) return "unresolved";
    throw err;
  }
  if (!verifyLineRange(toText(bytes), parsed.startLine, parsed.endLine)) {
    return "unresolved";
  }
  return "verified";
}

function cloneWithStatus(entity, status) {
  return {
    ...entity,
    evidence: entity.evidence.map((e) => ({ ...e })),
    status,
  };
}

/**
 * Process one entity. Returns { entity, unresolved }.
 * - Non-hipótese status: pass through unchanged, never unresolved.
 * - No repository evidence: stays hipótese, never unresolved (artifact-only).
 * - Else: every repo evidence must verify; first failure ⇒ unresolved.
 */
function processEntity(entity, logicalRepo, sourceRevision, readAtRevision) {
  if (entity.status !== HIPOTESE) {
    return { entity: cloneWithStatus(entity, entity.status), unresolved: false };
  }
  const repoEv = entity.evidence.filter((e) => e !== null && typeof e === "object" && e.kind === "repository");
  if (repoEv.length === 0) {
    return { entity: cloneWithStatus(entity, HIPOTESE), unresolved: false };
  }
  for (const ev of repoEv) {
    if (verifyOneRepoEvidence(ev, logicalRepo, sourceRevision, readAtRevision) === "unresolved") {
      return { entity: cloneWithStatus(entity, HIPOTESE), unresolved: true };
    }
  }
  return { entity: cloneWithStatus(entity, COMPROVADO), unresolved: false };
}

/**
 * Verify repository evidence on hipótese records/relations and promote the
 * ones that fully verify to comprovado.
 *
 * @param {object}   input
 * @param {Array}    input.records         KnowledgeRecord[] (schema-conformant).
 * @param {Array}    input.relations       Relation[] (schema-conformant).
 * @param {string}   input.logicalRepo     Logical repo identity to match.
 * @param {string}   input.sourceRevision  Pinned revision to match and read at.
 * @param {(args:{revision:string,path:string}) => Buffer|string} input.readAtRevision
 *   Injected reader returning pinned bytes (Buffer or string). Throws on
 *   expected failures (e.g. GitSourceError); programmer errors propagate.
 * @returns {{ records: object[], relations: object[], unresolvedIds: string[] }}
 *   Fresh, sorted-by-id records and relations plus a sorted deterministic
 *   list of entity ids whose repository evidence failed to verify.
 * @throws {RepoVerifierError} on invalid top-level inputs or entity shapes.
 */
export function verifyAndPromote({
  records,
  relations,
  logicalRepo,
  sourceRevision,
  readAtRevision,
}) {
  requireArray(records, "records");
  requireArray(relations, "relations");
  requireNonEmptyString(logicalRepo, "logicalRepo");
  requireNonEmptyString(sourceRevision, "sourceRevision");
  if (typeof readAtRevision !== "function") fail("readAtRevision must be a function");

  const unresolvedIds = [];

  const outRecords = records.map((rec) => {
    if (!isPlainObject(rec)) fail("each record must be an object");
    if (!Array.isArray(rec.evidence)) fail("each record must have an evidence array");
    const result = processEntity(rec, logicalRepo, sourceRevision, readAtRevision);
    if (result.unresolved) unresolvedIds.push(result.entity.id);
    return result.entity;
  });

  const outRelations = relations.map((rel) => {
    if (!isPlainObject(rel)) fail("each relation must be an object");
    if (!Array.isArray(rel.evidence)) fail("each relation must have an evidence array");
    const result = processEntity(rel, logicalRepo, sourceRevision, readAtRevision);
    if (result.unresolved) unresolvedIds.push(result.entity.id);
    return result.entity;
  });

  unresolvedIds.sort();
  return {
    records: sortById(outRecords),
    relations: sortById(outRelations),
    unresolvedIds,
  };
}
