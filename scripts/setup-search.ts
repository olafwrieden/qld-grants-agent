/**
 * Creates or updates all Azure AI Search data-plane objects from the JSON templates in /search:
 * index → data source → skillset → indexer → knowledge source → knowledge base.
 *
 *   npm run setup:search -- -g <resource-group>      # refresh .env from deployment outputs, then apply
 *   npm run setup:search -- --run                    # also trigger an indexer run afterwards
 *   npm run setup:search -- --reset                  # reset indexer change tracking (full re-index)
 */
import { DefaultAzureCredential } from '@azure/identity';
import { resolve } from 'node:path';
import { SearchRestClient } from '../src/lib/searchClient.js';
import { loadScriptEnv, renderTemplate, requireEnv } from './env.js';

const env = loadScriptEnv();
const search = new SearchRestClient(requireEnv(env, 'SEARCH_ENDPOINT'), new DefaultAzureCredential());
const tpl = (name: string) => renderTemplate(resolve('search', name), env);

const steps: [label: string, collection: string, name: string, file: string][] = [
  ['Index', 'indexes', env.SEARCH_INDEX_NAME, 'index.json'],
  ['Data source', 'datasources', env.SEARCH_DATASOURCE_NAME, 'datasource.json'],
  ['Skillset', 'skillsets', env.SEARCH_SKILLSET_NAME, 'skillset.json'],
  ['Indexer', 'indexers', env.SEARCH_INDEXER_NAME, 'indexer.json'],
  ['Knowledge source', 'knowledgesources', env.KNOWLEDGE_SOURCE_NAME, 'knowledge-source.json'],
  ['Knowledge base', 'knowledgebases', env.KNOWLEDGE_BASE_NAME, 'knowledge-base.json'],
];

for (const [label, collection, name, file] of steps) {
  const { status } = await search.request('PUT', `/${collection}/${encodeURIComponent(name)}`, tpl(file));
  console.log(`✔ ${label.padEnd(17)} ${name} (${status === 201 ? 'created' : 'updated'})`);
}

const indexer = env.SEARCH_INDEXER_NAME;
if (process.argv.includes('--reset')) {
  await search.request('POST', `/indexers/${indexer}/reset`);
  console.log(`↺ Indexer ${indexer} reset – next run re-processes every blob.`);
}
if (process.argv.includes('--run')) {
  console.log(`▶ Indexer ${indexer}: ${await search.runIndexer(indexer)}`);
}
