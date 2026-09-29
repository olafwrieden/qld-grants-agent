import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AppConfig } from './config.js';
import { fetchSnapshot } from './qldClient.js';
import { SearchRestClient } from './searchClient.js';
import { syncGrantsToBlob, type BlobSyncStats } from './blobStore.js';
import { buildGrantDocuments } from './transform.js';

export interface SyncSummary {
  fetched: number;
  duplicatesRemoved: number;
  documents: number;
  open: number;
  blob: BlobSyncStats;
  indexer: 'started' | 'alreadyRunning' | 'skipped' | 'notConfigured';
  durationMs: number;
}

export async function runSync(
  config: AppConfig,
  log: (message: string) => void = console.log,
): Promise<SyncSummary> {
  const started = Date.now();
  const now = new Date();
  const credential = new DefaultAzureCredential();

  const snapshot = await fetchSnapshot({ baseUrl: config.qldApiBaseUrl, apiKey: config.qldApiKey });
  const { fetched, documents, duplicatesRemoved } = buildGrantDocuments(snapshot, now);
  log(`Fetched ${fetched} grants, ${duplicatesRemoved} duplicates collapsed → ${documents.length} documents.`);

  const container = new BlobServiceClient(config.storageAccountUrl, credential).getContainerClient(config.container);
  const blob = await syncGrantsToBlob(container, documents, { now, retentionDays: config.softDeleteRetentionDays });
  log(`Blob sync: ${JSON.stringify(blob)}`);

  const changed = blob.created + blob.updated + blob.softDeleted;
  let indexer: SyncSummary['indexer'] = 'notConfigured';
  if (config.searchEndpoint) {
    indexer = changed > 0
      ? await new SearchRestClient(config.searchEndpoint, credential).runIndexer(config.indexerName)
      : 'skipped';
    log(`Indexer '${config.indexerName}': ${indexer}`);
  }

  return {
    fetched,
    duplicatesRemoved,
    documents: documents.length,
    open: documents.filter((d) => d.isOpen).length,
    blob,
    indexer,
    durationMs: Date.now() - started,
  };
}
