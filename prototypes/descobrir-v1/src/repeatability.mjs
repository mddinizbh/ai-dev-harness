export class RepeatabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepeatabilityError";
  }
}

const SHA256_RE = /^[a-f0-9]{64}$/;

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new RepeatabilityError(`${label} must be a lowercase SHA-256 hex string`);
  }
}

export function repeatabilityResult(primaryHash, baselineHash) {
  assertSha256(primaryHash, "primaryHash");
  assertSha256(baselineHash, "baselineHash");

  if (primaryHash === baselineHash) {
    return { result: "pass", canonical_graph_hash: primaryHash, baseline_hash: baselineHash };
  }

  return {
    result: "fail",
    canonical_graph_hash: primaryHash,
    baseline_hash: baselineHash,
    details: `canonical_graph_hash mismatch: ${primaryHash} !== ${baselineHash}`,
  };
}
