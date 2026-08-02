/**
 * Shared builders for Explorer Artifact Adapter records/relations.
 */
import { canonicalRecordId, canonicalRelationId } from "../canonical-id.mjs";
import {
  artifactReference,
  parsePathLine,
  repositoryReference,
} from "../provenance.mjs";

export const STATUS_HIPOTESE = "hipótese";

export function sourceEngineOf(ctx) {
  return {
    name: ctx.engineName,
    profile: ctx.engineProfile,
    adapter_version: ctx.adapterVersion,
    artifact_manifest_id: ctx.manifestId,
  };
}

export function indexArtifacts(artifacts) {
  const byPath = new Map();
  for (const a of artifacts) {
    byPath.set(a.path, a);
  }
  return byPath;
}

export function findArtifact(byPath, ...suffixes) {
  for (const [path, art] of byPath) {
    for (const suf of suffixes) {
      if (path === suf || path.endsWith(`/${suf}`) || path.endsWith(suf)) {
        return art;
      }
    }
  }
  return undefined;
}

export function lineCount(content) {
  if (content === "") return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

export function fullArtifactEvidence(ctx, art) {
  const end = Math.max(1, lineCount(art.content));
  return artifactReference({
    manifestId: ctx.manifestId,
    artifactPath: art.path,
    contentSha256: art.contentSha256,
    startLine: 1,
    endLine: end,
  });
}

export function rangeArtifactEvidence(ctx, art, startLine, endLine) {
  return artifactReference({
    manifestId: ctx.manifestId,
    artifactPath: art.path,
    contentSha256: art.contentSha256,
    startLine,
    endLine,
  });
}

/** Extract `path:line` or `path:start-end` tokens from free text. */
export function extractPathLines(text) {
  const results = [];
  const re = /`?([A-Za-z0-9_./-]+\.[A-Za-z0-9_]+):(\d+(?:-\d+)?)`?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = `${m[1]}:${m[2]}`;
    results.push(parsePathLine(token));
  }
  return results;
}

export function repoEvidenceFromPathLines(ctx, pathLines) {
  const seen = new Set();
  const out = [];
  for (const pl of pathLines) {
    const key = `${pl.path}:${pl.startLine}-${pl.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "repository",
      uri: repositoryReference({
        logicalRepo: ctx.logicalRepo,
        sourceRevision: ctx.sourceRevision,
        path: pl.path,
        startLine: pl.startLine,
        endLine: pl.endLine,
      }),
    });
  }
  return out;
}

export function makeRecord(ctx, { type, naturalKey, name, summary, attributes, evidence }) {
  return {
    id: canonicalRecordId(type, naturalKey),
    namespace: ctx.namespace,
    type,
    name,
    summary,
    attributes: attributes ?? {},
    status: STATUS_HIPOTESE,
    source_revision: ctx.sourceRevision,
    source_engine: sourceEngineOf(ctx),
    evidence,
  };
}

export function makeRelation(ctx, { relationType, fromRecord, toRecord, evidence }) {
  return {
    id: canonicalRelationId(relationType, fromRecord, toRecord),
    namespace: ctx.namespace,
    from_record: fromRecord,
    relation_type: relationType,
    to_record: toRecord,
    status: STATUS_HIPOTESE,
    source_revision: ctx.sourceRevision,
    source_engine: sourceEngineOf(ctx),
    evidence,
  };
}

export function sortById(items) {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Normalize event type strings from producer/consumer tables. */
export function normalizeEventNaturalKey(raw) {
  let s = raw.trim().replace(/^`+|`+$/g, "");
  s = s.replace(/^cloud\/domains\//i, "");
  s = s.replace(/\.Event$/i, ".event");
  return s;
}
