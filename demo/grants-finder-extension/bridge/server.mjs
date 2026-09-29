// Local "agent bridge" for the Grants Finder AI Companion demo extension.
//
// The extension never holds Azure credentials. This zero-dependency Node server (localhost only) gets an Entra ID
// token from the Azure CLI (`az login`), and relays two calls to the Foundry project's OpenAI-compatible API:
//   POST /v1/conversations -> {project}/openai/v1/conversations
//   POST /v1/responses     -> {project}/openai/v1/responses (streamed, pinned to AGENT_NAME)
//
// Usage:  FOUNDRY_PROJECT_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project> node bridge/server.mjs

import http from 'node:http';
import { exec } from 'node:child_process';

const PROJECT = (process.env.FOUNDRY_PROJECT_ENDPOINT ?? '').replace(/\/+$/, '');
const AGENT_NAME = process.env.AGENT_NAME ?? 'qld-grants-agent';
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 64 * 1024;

if (!/^https:\/\/[^/]+\/api\/projects\/[^/]+$/.test(PROJECT)) {
  console.error('Set FOUNDRY_PROJECT_ENDPOINT to your Foundry project endpoint, e.g.');
  console.error('  https://<account>.services.ai.azure.com/api/projects/<project>');
  process.exit(1);
}

let cached = { token: '', expiresAt: 0 };
async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 5 * 60_000) return cached.token;
  const out = await new Promise((resolve, reject) =>
    exec('az account get-access-token --resource https://ai.azure.com -o json', { windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(`Azure CLI token request failed - run "az login". ${stderr || err.message}`)) : resolve(stdout),
    ),
  );
  const t = JSON.parse(out);
  cached = { token: t.accessToken, expiresAt: t.expires_on ? t.expires_on * 1000 : Date.parse(t.expiresOn) };
  return cached.token;
}

// Only browser extensions (or non-browser clients) may call the bridge; web pages can't drive it cross-origin.
const allowedOrigin = (origin) => !origin || /^(chrome|moz|safari-web)-extension:\/\//.test(origin);

function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function foundry(path, body) {
  return fetch(`${PROJECT}/openai/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return send(res, 403, { error: 'Origin not allowed' });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      await getToken();
      return send(res, 200, { ok: true, agent: AGENT_NAME, project: new URL(PROJECT).hostname }, origin);
    }

    if (req.method === 'POST' && req.url === '/v1/conversations') {
      const upstream = await foundry('/conversations', {});
      const data = await upstream.json();
      return send(res, upstream.status, upstream.ok ? { id: data.id } : data, origin);
    }

    if (req.method === 'POST' && req.url === '/v1/responses') {
      const { conversation, input } = await readJson(req);
      if (typeof conversation !== 'string' || typeof input !== 'string' || !input.trim() || input.length > 8000) {
        return send(res, 400, { error: 'Expected { conversation: string, input: string }' }, origin);
      }
      const upstream = await foundry('/responses', {
        conversation,
        input,
        stream: true,
        agent_reference: { type: 'agent_reference', name: AGENT_NAME },
      });
      if (!upstream.ok || !upstream.body) {
        return send(res, upstream.status, { error: await upstream.text() }, origin);
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      });
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }

    send(res, 404, { error: 'Not found' }, origin);
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) send(res, err.status ?? 502, { error: err.message }, origin);
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Grants agent bridge listening on http://localhost:${PORT}`);
  console.log(`  agent:   ${AGENT_NAME}`);
  console.log(`  project: ${PROJECT}`);
});
