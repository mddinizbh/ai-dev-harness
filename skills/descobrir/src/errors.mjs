/**
 * Typed domain errors for the Descobrir skill.
 */

export class DescobrirError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DescobrirError";
  }
}

export class CanonicalIdError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "CanonicalIdError";
  }
}

export class ProvenanceError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ProvenanceError";
  }
}

export class CandidatePackageError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "CandidatePackageError";
  }
}

export class StoreError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "StoreError";
  }
}

export class AcceptanceError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "AcceptanceError";
  }
}

export class InstallConflictError extends DescobrirError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InstallConflictError";
  }
}

/**
 * Sanitize error text for CLI stderr — strip absolute paths.
 * @param {unknown} err
 * @returns {string}
 */
export function sanitizeErrorMessage(err) {
  const name = err instanceof Error ? err.name : "Error";
  const raw = err instanceof Error ? err.message : String(err);
  const scrubbed = raw
    .replace(/\/Users\/[^\s:]+/g, "<path>")
    .replace(/\/home\/[^\s:]+/g, "<path>")
    .replace(/[A-Za-z]:\\[^\s:]+/g, "<path>");
  return `${name}: ${scrubbed}`;
}
