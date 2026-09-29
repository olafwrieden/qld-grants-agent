/**
 * Publishes the Foundry prompt agent(s) defined in /agents/*.yaml as a new agent version.
 *
 *   npm run setup:agent                       # all agents in /agents
 *   npx tsx scripts/setup-agent.ts agents/grants-agent.yaml -g <resource-group>
 */
import { DefaultAzureCredential } from '@azure/identity';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadScriptEnv, renderTemplate, requireEnv } from './env.js';
import { FoundryProjectClient, type AgentFile } from './foundry.js';

const env = loadScriptEnv();
const client = new FoundryProjectClient(requireEnv(env, 'FOUNDRY_PROJECT_ENDPOINT'), new DefaultAzureCredential());

const explicit = process.argv.slice(2).filter((a) => /\.ya?ml$/i.test(a));
const files = explicit.length ? explicit : readdirSync('agents').filter((f) => /\.ya?ml$/i.test(f)).map((f) => join('agents', f));

for (const file of files) {
  const agent = renderTemplate(file, env) as AgentFile;
  if (!agent?.name || !agent.definition?.kind) throw new Error(`${file}: expected 'name' and 'definition.kind'`);
  const version = await client.createAgentVersion(agent);
  console.log(`✔ Agent ${version.name} v${version.version} (${agent.definition.kind}, model ${agent.definition.model}) from ${file}`);
}
