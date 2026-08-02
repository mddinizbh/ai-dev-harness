/**
 * Provenance references for Descobrir v1 (ADR 0002 + repo-reference.md).
 *
 * Pure construction of:
 *   - Repository Reference URI: repo://<logical>@<revision>/<path>#L<start>-L<end>
 *   - Artifact Reference object (discriminated evidence, kind: "artifact")
 *   - Inclusive 1-based line-range verification against source bytes
 *
 * Path segment rules follow the schema relativePath pattern: no '.', '..',
 * backslash, whitespace, NUL, or reserved '%?#@'. v1 prohibits percent-encoding
 * (presence of '%' is a hard reject; verifiers never decode).
 */
export class ProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProvenanceError";
  }
}

const FORBIDDEN_SEGMENT_CHARS = ["\\", "%", "?", "#", "@"];

function fail(reason) {
  throw new ProvenanceError(reason);
}

function validatePath(path, label = "path") {
  if (typeof path !== "string" || path === "") {
    fail(`${label} is empty`);
  }
  if (path.includes("\0")) {
    fail(`${label} contains NUL`);
  }
  if (path[0] === "/") {
    fail(`${label} must be relative (no leading slash)`);
  }
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "") {
      fail(`${label} has empty segment (no '//' or trailing '/')`);
    }
    if (seg === "." || seg === "..") {
      fail(`${label} has forbidden '${seg}' segment`);
    }
    if (/\s/.test(seg)) {
      fail(`${label} contains whitespace`);
    }
    for (const ch of FORBIDDEN_SEGMENT_CHARS) {
      if (seg.includes(ch)) {
        fail(`${label} contains reserved '${ch}'`);
      }
    }
  }
}

function validateLineRange(startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    fail("line range must be integers");
  }
  if (startLine < 1) {
    fail("start_line must be >= 1");
  }
  if (endLine < 1) {
    fail("end_line must be >= 1");
  }
  if (endLine < startLine) {
    fail("end_line must be >= start_line");
  }
}

function validateLogicalRepo(logicalRepo) {
  if (typeof logicalRepo !== "string" || logicalRepo === "" || /[@\/\s]/.test(logicalRepo)) {
    fail("logical_repo must be a non-empty single token (no '@', '/', whitespace)");
  }
}

function validateRevision(sourceRevision) {
  if (typeof sourceRevision !== "string" || sourceRevision === "" || /[\/\s]/.test(sourceRevision)) {
    fail("source_revision must be non-empty (no '/', whitespace)");
  }
}

function validateSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail("content_sha256 must be 64 lowercase hex chars");
  }
}

export function parsePathLine(input) {
  if (typeof input !== "string") {
    fail("parsePathLine input must be a string");
  }
  const idx = input.lastIndexOf(":");
  if (idx === -1) {
    fail("missing ':line' suffix");
  }
  const path = input.slice(0, idx);
  const range = input.slice(idx + 1);
  const match = range.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    fail(`malformed line range: '${range}'`);
  }
  const startLine = Number(match[1]);
  const endLine = match[2] !== undefined ? Number(match[2]) : startLine;
  validatePath(path);
  validateLineRange(startLine, endLine);
  return { path, startLine, endLine };
}

export function repositoryReference({ logicalRepo, sourceRevision, path, startLine, endLine }) {
  validateLogicalRepo(logicalRepo);
  validateRevision(sourceRevision);
  validatePath(path);
  validateLineRange(startLine, endLine);
  return `repo://${logicalRepo}@${sourceRevision}/${path}#L${startLine}-L${endLine}`;
}

/**
 * Strict inverse of repositoryReference: parse repo://<logical>@<revision>/<path>#L<start>-L<end>
 * and reject anything the constructor could not have produced. Structural parsing
 * (scheme, '@', first path '/', '#', line-range fragment) happens first; the parsed
 * components are then run through the same validators as the constructor, so accept/reject
 * behavior stays identical and round-trip is exact.
 */
export function parseRepositoryReference(uri) {
  if (typeof uri !== "string") {
    fail("uri must be a string");
  }
  if (!uri.startsWith("repo://")) {
    fail("uri must use the 'repo://' scheme");
  }
  const afterScheme = uri.slice("repo://".length);
  const atIdx = afterScheme.indexOf("@");
  if (atIdx === -1) {
    fail("uri is missing '@<revision>'");
  }
  const logical = afterScheme.slice(0, atIdx);
  const afterAt = afterScheme.slice(atIdx + 1);
  const slashIdx = afterAt.indexOf("/");
  if (slashIdx === -1) {
    fail("uri is missing '/<path>' after revision");
  }
  const revision = afterAt.slice(0, slashIdx);
  const pathAndFragment = afterAt.slice(slashIdx + 1);
  const hashIdx = pathAndFragment.indexOf("#");
  if (hashIdx === -1) {
    fail("uri is missing '#L<start>-L<end>' fragment");
  }
  const path = pathAndFragment.slice(0, hashIdx);
  const fragment = pathAndFragment.slice(hashIdx + 1);
  // [1-9][0-9]* forbids zero, leading zeros, and any non-canonical form, matching the
  // schema fragment regex. end>=start is a cross-bound invariant left to validateLineRange.
  const match = fragment.match(/^L([1-9][0-9]*)-L([1-9][0-9]*)$/);
  if (!match) {
    fail(`malformed line-range fragment: '#${fragment}'`);
  }
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  validateLogicalRepo(logical);
  validateRevision(revision);
  validatePath(path);
  validateLineRange(startLine, endLine);
  return { logicalRepo: logical, sourceRevision: revision, path, startLine, endLine };
}

export function artifactReference({ manifestId, artifactPath, contentSha256, startLine, endLine }) {
  if (typeof manifestId !== "string" || manifestId === "") {
    fail("manifest_id is empty");
  }
  validatePath(artifactPath, "artifact_path");
  validateSha256(contentSha256);
  validateLineRange(startLine, endLine);
  return {
    kind: "artifact",
    manifest_id: manifestId,
    artifact_path: artifactPath,
    content_sha256: contentSha256,
    range: { start_line: startLine, end_line: endLine },
  };
}

export function verifyLineRange(sourceText, startLine, endLine) {
  if (typeof sourceText !== "string") return false;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  if (startLine < 1 || endLine < startLine) return false;
  const lineCount =
    sourceText === "" ? 0 : sourceText.split("\n").length - (sourceText.endsWith("\n") ? 1 : 0);
  return endLine <= lineCount;
}
