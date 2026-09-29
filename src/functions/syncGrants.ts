import { app, type HttpRequest, type InvocationContext, type Timer } from '@azure/functions';
import { loadConfig } from '../lib/config.js';
import { runSync } from '../lib/sync.js';

/** Weekly pull: refresh the blob staging area, then kick the Azure AI Search indexer. */
app.timer('syncGrantsTimer', {
  // CRON is evaluated in UTC: Saturday 16:00 UTC = Sunday 02:00 AEST.
  schedule: '%SYNC_SCHEDULE%',
  runOnStartup: false,
  handler: async (_timer: Timer, context: InvocationContext) => {
    const summary = await runSync(loadConfig(), (m) => context.log(m));
    context.log(`Sync complete: ${JSON.stringify(summary)}`);
  },
});

/** On-demand sync for testing / backfills. Protected by a function key. */
app.http('syncGrants', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'sync',
  handler: async (_request: HttpRequest, context: InvocationContext) => {
    const summary = await runSync(loadConfig(), (m) => context.log(m));
    return { status: 200, jsonBody: summary };
  },
});
