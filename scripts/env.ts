import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), '.env');

/** Defaults for names that are not deployment outputs. Environment variables override them. */
const DEFAULTS: Record<string, string> = {
  SEARCH_INDEX_NAME: 'grants',
  SEARCH_DATASOURCE_NAME: 'grants-blob',
  SEARCH_SKILLSET_NAME: 'grants-skillset',
  SEARCH_INDEXER_NAME: 'grants-indexer',
  KNOWLEDGE_SOURCE_NAME: 'grants-ks',
  KNOWLEDGE_BASE_NAME: 'grants-kb',
  GRANTS_CONTAINER: 'grants',
};

export function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Pulls the Bicep deployment outputs (UPPER_SNAKE_CASE) and persists them to `.env`. */
function writeEnvFromDeployment(resourceGroup: string, deploymentName: string): void {
  const az = process.platform === 'win32' ? 'az.cmd' : 'az';
  const json = execFileSync(
    az,
    ['deployment', 'group', 'show', '-g', resourceGroup, '-n', deploymentName, '--query', 'properties.outputs', '-o', 'json'],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  const outputs = JSON.parse(json) as Record<string, { value: unknown }>;
  // ARM mangles output-name casing (e.g. `searcH_ENDPOINT`), so normalise back to UPPER_SNAKE_CASE.
  const lines = Object.entries(outputs).map(([k, v]) => `${k.toUpperCase()}=${String(v.value)}`);
  writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);
  console.log(`Wrote ${lines.length} settings from deployment '${deploymentName}' to .env`);
}

/**
 * Loads settings for the helper scripts. Pass `-g <resource-group>` (and optionally `--deployment <name>`)
 * to refresh `.env` from the Bicep deployment outputs first. `AZURE_RESOURCE_GROUP` in the shell does the same
 * when `.env` does not exist yet (handy because npm on PowerShell swallows `-- -g`).
 */
export function loadScriptEnv(): Record<string, string> {
  const rg =
    argValue('-g') ??
    argValue('--resource-group') ??
    (!existsSync(ENV_FILE) ? process.env.AZURE_RESOURCE_GROUP : undefined);
  if (rg) writeEnvFromDeployment(rg, argValue('--deployment') ?? 'main');
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

  const env: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
}

/** Replaces `${NAME}` placeholders in a JSON template with values from `env`. */
export function renderTemplate(file: string, env: Record<string, string>): unknown {
  const raw = readFileSync(file, 'utf8');
  const rendered = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const value = env[name];
    if (value === undefined || value === '') throw new Error(`${file}: missing value for \${${name}}`);
    return value;
  });
  return JSON.parse(rendered);
}

export function requireEnv(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}. Run with -g <resource-group> or set it in .env`);
  return value;
}
