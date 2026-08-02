const SHA256 = /^[a-f0-9]{64}$/;

export class MutationEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "MutationEvidenceError";
  }
}

function fail(message) {
  throw new MutationEvidenceError(message);
}

function snapshot(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const { summary_hash, tracked_file_count, dirty_path_count, anchor_object_present } = value;
  if (typeof summary_hash !== "string" || !SHA256.test(summary_hash)) {
    fail(`${label}.summary_hash must be a lowercase sha256 hex string`);
  }
  for (const [key, count] of [["tracked_file_count", tracked_file_count], ["dirty_path_count", dirty_path_count]]) {
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) fail(`${label}.${key} must be a non-negative integer`);
  }
  if (anchor_object_present !== undefined && typeof anchor_object_present !== "boolean") {
    fail(`${label}.anchor_object_present must be a boolean`);
  }
  return {
    summary_hash,
    ...(tracked_file_count === undefined ? {} : { tracked_file_count }),
    ...(dirty_path_count === undefined ? {} : { dirty_path_count }),
    ...(anchor_object_present === undefined ? {} : { anchor_object_present }),
  };
}

function sameSnapshot(a, b) {
  return a.summary_hash === b.summary_hash
    && a.tracked_file_count === b.tracked_file_count
    && a.dirty_path_count === b.dirty_path_count
    && a.anchor_object_present === b.anchor_object_present;
}

export function mutationEvidence(pre, post) {
  const cleanPre = snapshot(pre, "pre");
  const cleanPost = snapshot(post, "post");
  return { pre: cleanPre, post: cleanPost, equivalent: sameSnapshot(cleanPre, cleanPost) };
}
