import { dedupeGrants } from './dedupe.js';
import { buildDimensionLookup, normalizeGrant } from './normalize.js';
import type { QldSnapshot } from './qldClient.js';

/** Pure transformation: raw API snapshot → normalized, deduplicated, index-ready documents. */
export function buildGrantDocuments(snapshot: QldSnapshot, now = new Date()) {
  const lookup = buildDimensionLookup(snapshot.dimensions);
  const normalized = Object.values(snapshot.services).map((raw) => normalizeGrant(raw, lookup, now));
  return { fetched: normalized.length, ...dedupeGrants(normalized) };
}
