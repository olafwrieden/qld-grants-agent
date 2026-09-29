import { DIMENSIONS, type DimensionKey, type Dimensions, type RawDimension, type RawServices } from './types.js';

export interface QldClientOptions {
  baseUrl: string;
  apiKey?: string;
  retries?: number;
}

export interface QldSnapshot {
  services: RawServices;
  dimensions: Dimensions;
}

class NonRetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, apiKey: string | undefined, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as T;
      const message = `GET ${url} failed: ${res.status} ${await res.text()}`;
      // Client errors (other than throttling) won't fix themselves on retry.
      if (res.status < 500 && res.status !== 429) throw new NonRetryableError(message);
      lastError = new Error(message);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

/** Fetches the grants fact table and all dimension tables in parallel. */
export async function fetchSnapshot({ baseUrl, apiKey, retries = 3 }: QldClientOptions): Promise<QldSnapshot> {
  const base = baseUrl.replace(/\/+$/, '');
  const dimensionKeys = Object.keys(DIMENSIONS) as DimensionKey[];

  const [services, ...dims] = await Promise.all([
    getJson<RawServices>(`${base}/services.json`, apiKey, retries),
    ...dimensionKeys.map((k) => getJson<RawDimension>(`${base}/${DIMENSIONS[k]}.json`, apiKey, retries)),
  ]);

  const dimensions = Object.fromEntries(dimensionKeys.map((k, i) => [k, dims[i]])) as Dimensions;
  return { services, dimensions };
}
