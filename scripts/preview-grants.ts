/**
 * Local dry run – no Azure needed. Fetches the live QLD API, normalizes + dedupes and prints a summary.
 *   QLD_API_KEY=... npm run preview [-- --out grants.preview.json]
 */
import { writeFileSync } from 'node:fs';
import { fetchSnapshot } from '../src/lib/qldClient.js';
import { buildGrantDocuments } from '../src/lib/transform.js';
import { argValue, loadScriptEnv } from './env.js';

const env = loadScriptEnv();
const snapshot = await fetchSnapshot({
  baseUrl: env.QLD_API_BASE_URL ?? 'https://api.jus-checklist.services.qld.gov.au/v1/api/legacy/resources/grants',
  apiKey: env.QLD_API_KEY,
});
const { fetched, documents, duplicatesRemoved } = buildGrantDocuments(snapshot);

const count = (values: (string | null)[]) =>
  Object.fromEntries(
    Object.entries(values.reduce<Record<string, number>>((acc, v) => ((acc[v ?? '(none)'] = (acc[v ?? '(none)'] ?? 0) + 1), acc), {}))
      .sort((a, b) => b[1] - a[1]),
  );

console.log({
  fetched,
  duplicatesRemoved,
  documents: documents.length,
  open: documents.filter((d) => d.isOpen).length,
  status: count(documents.map((d) => d.status)),
  assistanceType: count(documents.map((d) => d.assistanceType)),
  withClosingDate: documents.filter((d) => d.closingDate).length,
  withAmount: documents.filter((d) => d.amount !== null).length,
  withoutSummary: documents.filter((d) => !d.summary).length,
  mergedDuplicates: documents.filter((d) => d.sourceIds.length > 1).map((d) => d.sourceIds),
});
console.log('Sample document:', JSON.stringify(documents.find((d) => d.isOpen) ?? documents[0], null, 2));

const out = argValue('--out');
if (out) {
  writeFileSync(out, JSON.stringify(documents, null, 2));
  console.log(`Wrote ${documents.length} documents to ${out}`);
}
