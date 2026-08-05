/**
 * SQLite store for L2 journey specs + bind results.
 * Shares the same DB file as L0/L1; does not modify L0 packages or L1 edges.
 */

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stablePretty, stableStringify } from "../../explorer-l0/src/stable-json.mjs";

export class JourneyStoreError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JourneyStoreError";
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS journey_specs (
  system_namespace TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  spec_revision TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (system_namespace, journey_id, spec_revision)
);

CREATE TABLE IF NOT EXISTS journey_binds (
  bind_id TEXT PRIMARY KEY,
  system_namespace TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  spec_revision TEXT NOT NULL,
  journey_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_bound INTEGER NOT NULL,
  steps_gap INTEGER NOT NULL,
  members_json TEXT NOT NULL,
  bind_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journey_binds_ns_id
  ON journey_binds(system_namespace, journey_id, created_at DESC);

CREATE TABLE IF NOT EXISTS journey_step_edges (
  bind_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  step_status TEXT NOT NULL,
  PRIMARY KEY (bind_id, step_id, edge_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_step_edges_edge
  ON journey_step_edges(edge_id);

CREATE TABLE IF NOT EXISTS journey_current (
  system_namespace TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  bind_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (system_namespace, journey_id)
);
`;

/**
 * @param {string} dbPath
 */
export function openJourneyStore(dbPath) {
  if (typeof dbPath !== "string" || dbPath === "") {
    throw new JourneyStoreError("dbPath required");
  }
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // best-effort
  }
  return {
    _db: db,
    dbPath,
    close() {
      db.close();
    },
  };
}

/**
 * Content hash of the journey spec (stable JSON).
 * @param {object} spec
 */
export function specRevisionOf(spec) {
  const material = {
    id: spec.id,
    system_namespace: spec.system_namespace,
    members: spec.members ?? [],
    description: spec.description ?? "",
    steps: (spec.steps ?? []).map((s) => ({
      id: s.id,
      trigger: s.trigger,
      from: s.from ?? null,
      to: s.to ?? null,
      contract_prefix: s.contract_prefix ?? null,
      contract_key: s.contract_key ?? null,
      description: s.description ?? null,
    })),
  };
  return createHash("sha256").update(stableStringify(material)).digest("hex").slice(0, 32);
}

/**
 * @param {string} systemNamespace
 * @param {string} journeyId
 * @param {string} journeyHash
 */
export function makeBindId(systemNamespace, journeyId, journeyHash) {
  return `${systemNamespace}:${journeyId}:${journeyHash}`;
}

/**
 * Persist spec + bind result; upsert journey_current to this bind.
 *
 * @param {ReturnType<typeof openJourneyStore>} store
 * @param {{
 *   spec: object,
 *   bind: object,
 *   set_current?: boolean,
 * }} input
 */
export function persistJourneyBind(store, input) {
  const spec = input?.spec;
  const bind = input?.bind;
  if (!spec?.id || !spec.system_namespace) {
    throw new JourneyStoreError("spec.id and spec.system_namespace required");
  }
  if (!bind?.journey_id || !bind.journey_hash || !bind.system_namespace) {
    throw new JourneyStoreError("bind.journey_id, journey_hash, system_namespace required");
  }
  if (spec.id !== bind.journey_id) {
    throw new JourneyStoreError("spec.id must match bind.journey_id");
  }
  if (spec.system_namespace !== bind.system_namespace) {
    throw new JourneyStoreError("spec.system_namespace must match bind.system_namespace");
  }

  const specRevision = specRevisionOf(spec);
  const bindId = makeBindId(bind.system_namespace, bind.journey_id, bind.journey_hash);
  const now = new Date().toISOString();
  const setCurrent = input.set_current !== false;

  const insertSpec = store._db.prepare(`
    INSERT OR IGNORE INTO journey_specs (
      system_namespace, journey_id, spec_revision, spec_json, created_at
    ) VALUES (?,?,?,?,?)
  `);
  const insertBind = store._db.prepare(`
    INSERT OR IGNORE INTO journey_binds (
      bind_id, system_namespace, journey_id, spec_revision, journey_hash,
      status, steps_bound, steps_gap, members_json, bind_json, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const deleteSteps = store._db.prepare(
    `DELETE FROM journey_step_edges WHERE bind_id = ?`,
  );
  const insertStep = store._db.prepare(`
    INSERT INTO journey_step_edges (bind_id, step_id, edge_id, step_status)
    VALUES (?,?,?,?)
  `);
  const upsertCurrent = store._db.prepare(`
    INSERT INTO journey_current (system_namespace, journey_id, bind_id, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(system_namespace, journey_id) DO UPDATE SET
      bind_id = excluded.bind_id,
      updated_at = excluded.updated_at
  `);

  const begin = store._db.prepare("BEGIN");
  const commit = store._db.prepare("COMMIT");
  const rollback = store._db.prepare("ROLLBACK");

  begin.run();
  try {
    const specIns = insertSpec.run(
      spec.system_namespace,
      spec.id,
      specRevision,
      stablePretty(spec),
      now,
    );
    const bindIns = insertBind.run(
      bindId,
      bind.system_namespace,
      bind.journey_id,
      specRevision,
      bind.journey_hash,
      bind.status ?? "partial",
      bind.steps_bound ?? 0,
      bind.steps_gap ?? 0,
      stablePretty(bind.members ?? spec.members ?? []),
      stablePretty(bind),
      now,
    );

    // Always refresh step index for this bind_id (idempotent re-persist).
    deleteSteps.run(bindId);
    let stepEdges = 0;
    for (const step of bind.bound ?? []) {
      const status = step.status === "bound" ? "bound" : "gap";
      const edgeIds =
        status === "bound" && Array.isArray(step.edge_ids) && step.edge_ids.length > 0
          ? step.edge_ids
          : ["__gap__"];
      for (const edgeId of edgeIds) {
        insertStep.run(bindId, step.step_id, edgeId, status);
        stepEdges += 1;
      }
    }

    if (setCurrent) {
      upsertCurrent.run(bind.system_namespace, bind.journey_id, bindId, now);
    }

    commit.run();
    return {
      bind_id: bindId,
      journey_id: bind.journey_id,
      system_namespace: bind.system_namespace,
      spec_revision: specRevision,
      journey_hash: bind.journey_hash,
      status: bind.status,
      steps_bound: bind.steps_bound,
      steps_gap: bind.steps_gap,
      step_edge_rows: stepEdges,
      spec_created: specIns.changes === 1,
      bind_created: bindIns.changes === 1,
      set_current: setCurrent,
      created_at: now,
    };
  } catch (err) {
    rollback.run();
    throw new JourneyStoreError("persistJourneyBind failed", { cause: err });
  }
}

/**
 * @param {ReturnType<typeof openJourneyStore>} store
 * @param {string} systemNamespace
 */
export function listJourneys(store, systemNamespace) {
  if (!systemNamespace) throw new JourneyStoreError("systemNamespace required");
  const rows = store._db
    .prepare(
      `
      SELECT c.journey_id, c.bind_id, c.updated_at,
             b.status, b.steps_bound, b.steps_gap, b.journey_hash, b.spec_revision, b.created_at
      FROM journey_current c
      JOIN journey_binds b ON b.bind_id = c.bind_id
      WHERE c.system_namespace = ?
      ORDER BY c.journey_id ASC
    `,
    )
    .all(systemNamespace);
  return rows.map((r) => ({
    journey_id: r.journey_id,
    bind_id: r.bind_id,
    status: r.status,
    steps_bound: r.steps_bound,
    steps_gap: r.steps_gap,
    journey_hash: r.journey_hash,
    spec_revision: r.spec_revision,
    bind_created_at: r.created_at,
    current_updated_at: r.updated_at,
  }));
}

/**
 * @param {ReturnType<typeof openJourneyStore>} store
 * @param {{ system_namespace: string, journey_id: string, bind_id?: string }} q
 */
export function showJourney(store, q) {
  if (!q.system_namespace || !q.journey_id) {
    throw new JourneyStoreError("system_namespace and journey_id required");
  }
  let bindId = q.bind_id;
  if (!bindId) {
    const cur = store._db
      .prepare(
        `SELECT bind_id FROM journey_current
         WHERE system_namespace = ? AND journey_id = ?`,
      )
      .get(q.system_namespace, q.journey_id);
    bindId = cur?.bind_id;
  }
  if (!bindId) {
    return null;
  }
  const row = store._db
    .prepare(`SELECT * FROM journey_binds WHERE bind_id = ?`)
    .get(bindId);
  if (!row) return null;
  const spec = store._db
    .prepare(
      `SELECT spec_json FROM journey_specs
       WHERE system_namespace = ? AND journey_id = ? AND spec_revision = ?`,
    )
    .get(row.system_namespace, row.journey_id, row.spec_revision);
  const steps = store._db
    .prepare(
      `SELECT step_id, edge_id, step_status FROM journey_step_edges
       WHERE bind_id = ? ORDER BY step_id, edge_id`,
    )
    .all(bindId);
  return {
    bind_id: row.bind_id,
    system_namespace: row.system_namespace,
    journey_id: row.journey_id,
    spec_revision: row.spec_revision,
    journey_hash: row.journey_hash,
    status: row.status,
    steps_bound: row.steps_bound,
    steps_gap: row.steps_gap,
    members: JSON.parse(row.members_json),
    bind: JSON.parse(row.bind_json),
    spec: spec ? JSON.parse(spec.spec_json) : null,
    step_edges: steps,
    created_at: row.created_at,
  };
}

/**
 * Journeys (current bind) that include this L1 edge_id.
 * @param {ReturnType<typeof openJourneyStore>} store
 * @param {{ system_namespace?: string, edge_id: string }} q
 */
export function journeysForEdge(store, q) {
  if (!q.edge_id) throw new JourneyStoreError("edge_id required");
  let sql = `
    SELECT se.step_id, se.edge_id, se.step_status,
           b.bind_id, b.journey_id, b.system_namespace, b.status,
           b.steps_bound, b.steps_gap, b.journey_hash,
           CASE WHEN c.bind_id IS NOT NULL THEN 1 ELSE 0 END AS is_current
    FROM journey_step_edges se
    JOIN journey_binds b ON b.bind_id = se.bind_id
    LEFT JOIN journey_current c
      ON c.bind_id = b.bind_id
     AND c.system_namespace = b.system_namespace
     AND c.journey_id = b.journey_id
    WHERE se.edge_id = ? AND se.step_status = 'bound'
  `;
  /** @type {unknown[]} */
  const params = [q.edge_id];
  if (q.system_namespace) {
    sql += ` AND b.system_namespace = ?`;
    params.push(q.system_namespace);
  }
  sql += ` ORDER BY is_current DESC, b.journey_id ASC`;
  return store._db.prepare(sql).all(...params).map((r) => ({
    journey_id: r.journey_id,
    bind_id: r.bind_id,
    system_namespace: r.system_namespace,
    step_id: r.step_id,
    edge_id: r.edge_id,
    status: r.status,
    steps_bound: r.steps_bound,
    steps_gap: r.steps_gap,
    journey_hash: r.journey_hash,
    is_current: r.is_current === 1,
  }));
}

/**
 * @param {ReturnType<typeof openJourneyStore>} store
 * @param {string} systemNamespace
 */
export function journeyStats(store, systemNamespace) {
  const specs = store._db
    .prepare(
      `SELECT COUNT(*) AS n FROM journey_specs WHERE system_namespace = ?`,
    )
    .get(systemNamespace);
  const binds = store._db
    .prepare(
      `SELECT COUNT(*) AS n FROM journey_binds WHERE system_namespace = ?`,
    )
    .get(systemNamespace);
  const current = store._db
    .prepare(
      `SELECT COUNT(*) AS n FROM journey_current WHERE system_namespace = ?`,
    )
    .get(systemNamespace);
  return {
    system_namespace: systemNamespace,
    specs: specs?.n ?? 0,
    binds: binds?.n ?? 0,
    current: current?.n ?? 0,
  };
}
