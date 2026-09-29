# QLD Grants Agent

Queensland Government grants in **Azure AI Search (FoundryIQ)**, ready for keyword, vector, semantic and hybrid search and for **agentic retrieval**, with a **Foundry prompt agent** that helps anyone find a grant.

A weekly TypeScript Azure Function pulls the [Grants Finder](https://www.grants.services.qld.gov.au/) API. It joins the dimension tables, removes duplicates and stages one JSON document per grant in Blob Storage. An AI Search **pull indexer** then embeds the title and description with a Microsoft Foundry `text-embedding-3-small` deployment. The results go into a faceted `grants` index, which a FoundryIQ **knowledge base** (`gpt-5.4-mini`) is layered over. The **Queensland Grants Finder agent** (`agents/grants-agent.yaml`) calls that knowledge base through MCP.

> No UI yet. Explore the index through the Search REST API (see [Querying](#querying)) and talk to the agent from the terminal or the Foundry portal (see [Grants agent](#grants-agent)).

---

## Architecture

```mermaid
flowchart LR
    subgraph QLD["QLD Grants Finder API (X-Api-Key)"]
        S[services.json<br/><i>fact</i>]
        D[application_type · category ·<br/>client_group_1 · funding_type ·<br/>business_activities<br/><i>dimensions</i>]
    end

    subgraph FN["Azure Function (Flex Consumption, Node 22)"]
        T[⏰ weekly timer<br/>+ POST /api/sync]
        N[normalize + join dims]
        X[dedupe + content hash]
    end

    B[(Blob Storage<br/>grants/&lt;id&gt;.json)]

    subgraph SRCH["Azure AI Search · Serverless"]
        I[Blob indexer<br/>on demand + daily safety net]
        K[Skillset<br/>2× AzureOpenAIEmbedding]
        IDX[(grants index<br/>BM25 + HNSW + semantic)]
        KS[Knowledge source] --> KB[Knowledge base]
    end

    subgraph AIF["Microsoft Foundry"]
        E[text-embedding-3-small]
        C[gpt-5.4-mini]
        AG[🤖 qld-grants-agent<br/>prompt agent]
    end

    S & D --> T --> N --> X -->|write only if changed<br/>soft-delete if removed| B
    X -. run indexer .-> I
    B --> I --> K --> IDX
    K -. embed .-> E
    IDX --> KS
    KB -. query planning / answers .-> C
    IDX -. query-time vectorizer .-> E
    AG -->|MCP knowledge_base_retrieve| KB
    AG -. reasoning .-> C
```

**Why stage in Blob?** AI Search pull indexers can't call an HTTP endpoint or Function directly. Blob is the simplest supported source. It gives change detection (`LastModified`), soft-delete detection (`IsDeleted` metadata) and a free audit trail of exactly what was indexed.

| Resource | Notes |
|---|---|
| **Azure AI Search** `serverless` (preview), `2026-09-01-preview` | Semantic ranker and agentic retrieval (`knowledgeRetrieval`) enabled, system-assigned MI, Entra ID + key auth |
| **Microsoft Foundry** (AIServices) + project, `2026-09-15-preview` | `text-embedding-3-small` (1536d) and `gpt-5.4-mini` GlobalStandard deployments; project connections to Search (`grants-search`) and to the knowledge base MCP endpoint (`grants-kb-mcp`, `RemoteTool`, project managed identity) |
| **Function App** Flex Consumption, `2026-08-01` | Node 22, system MI, identity-based `AzureWebJobsStorage` |
| **Storage** `2026-09-01` | Shared keys disabled. Containers: `grants` and `app-package` |
| Log Analytics + App Insights | Function telemetry |
| RBAC `2026-07-01-preview` | Keyless everywhere (see [Security](#security)) |

---

## Data model

The API returns a fact table (`services.json`, about 580 records keyed by id) plus five checkbox-style dimension tables. Each grant's `tags` hold ids from all five dimensions, and the id prefix identifies the dimension:

| Tag prefix | Dimension endpoint | Index field |
|---|---|---|
| `1xxx` | `application_type` | `applicantTypes` |
| `2xxx` | `category` | `categories` |
| `3xxx` | `client_group_1` | `clientGroups` |
| `4xxx` | `funding_type` | `fundingTypes` |
| `5xxx` | `business_activities` | `businessActivities` |

Lookups use the dimension tables, so new dimension values are picked up automatically. "Select all" options (negative keys) are ignored.

### Index `grants`

| Field | Type | S | F | Fa | So | Source / notes |
|---|---|:-:|:-:|:-:|:-:|---|
| `id` | key | | ✓ | | | upstream id (lowest id when duplicates are merged) |
| `title` | string | ✓ | | | ✓ | `"{sub_program_title} – {name}"`, because many records are named only "Round 1" |
| `programName`, `roundName` | string | ✓ | ✓ | ✓ | ✓ | |
| `summary` | string | ✓ | | | | `grant_summary` (the "description") |
| `eligibility`, `howToApply`, `successNotification` | string | ✓ | | | | |
| `status` | string | | ✓ | ✓ | | `Open` / `Closed` |
| `isOpen` | bool | | ✓ | ✓ | | Open **and** closing date not passed *at sync time* |
| `openingDate`, `closingDate` | DateTimeOffset | | ✓ | ✓ | ✓ | parsed from 6 mixed formats, QLD time (+10:00) |
| `amount` | double | | ✓ | ✓ | ✓ | |
| `issuingAgency`, `deliveredBy`, `assistanceType`, `financialYearBudget` | string | ✓ | ✓ | ✓ | | |
| `applicantTypes`, `categories`, `clientGroups`, `fundingTypes`, `businessActivities` | string[] | ✓ | ✓ | ✓ | | joined from the dimensions |
| `url` | string | | | | | |
| `tagIds`, `sourceIds`, `contentHash`, `lastChangedAt` | – | | ✓ | | | lineage and change tracking |
| `titleVector`, `descriptionVector` | 1536 × single | ✓ | | | | HNSW (cosine), Foundry vectorizer for query-time embedding |

S = searchable, F = filterable, Fa = facetable, So = sortable. The semantic configuration `grants-semantic` uses `title` as the title field, then `summary`, `eligibility` and `successNotification` as content, and the audience and category collections as keywords. `en.microsoft` analyzers are used throughout.

### Deduplication and updates

1. **Key = upstream id.** A grant that changes upstream keeps its id, so the index document is **updated in place**.
2. **Identical content → one document.** Each normalized record gets a SHA-256 fingerprint that excludes its id. Records with the same fingerprint are merged into the lowest id, and every original id goes into `sourceIds`. In the live feed, for example, 5 identical *Australian Teletrial Program* records become 1.
3. **Only write what changed.** Each blob stores a `contenthash` in its metadata. The sync lists the container once, rewrites only the grants whose hash changed, and leaves everything else alone. The indexer's change detection therefore re-embeds only changed grants, which keeps embedding cost close to zero on quiet weeks.
4. **Removals.** A grant that disappears (or is merged into another id) gets blob metadata `IsDeleted=true`, and the indexer's soft-delete policy removes it from the index. Soft-deleted blobs are purged after 30 days (`SOFT_DELETE_RETENTION_DAYS`).
5. The Function triggers the indexer only when something changed. The indexer also has its own daily schedule as a safety net.

---

## Repository layout

```
infra/                  Bicep: main.bicep (+ .bicepparam) and small modules
  modules/              search · foundry · function · storage · monitoring · roles
src/
  functions/syncGrants.ts   weekly timer + POST /api/sync
  lib/                      qldClient · normalize · dates · dedupe · transform · blobStore · searchClient · sync
search/                 JSON definitions (templated with ${VARS}): index, datasource, skillset,
                        indexer, knowledge-source, knowledge-base
agents/                 Foundry agent definitions (YAML, templated with ${VARS}): grants-agent.yaml
scripts/                setup-search.ts · setup-agent.ts · chat.ts · query.ts · preview-grants.ts · env.ts · foundry.ts
test/                   vitest unit tests + small real-data fixtures
```

---

## Deploy

**Prerequisites:** Azure CLI (with Bicep ≥ 0.47), Node 22, Azure Functions Core Tools v4, a QLD Grants API key, and quota for `text-embedding-3-small` and `gpt-5.4-mini` (GlobalStandard) in the target region.

The region must support the **Serverless** tier, **semantic ranker** and **agentic retrieval**. `australiaeast` (the default) supports all three. See [region support](https://learn.microsoft.com/azure/search/search-region-support).

```powershell
az login
$env:QLD_API_KEY        = '<your X-Api-Key>'
$env:AZURE_PRINCIPAL_ID = az ad signed-in-user show --query id -o tsv   # grants you data-plane roles for the scripts
# $env:STORAGE_POLICY_OPT_OUT = 'true'   # only if an org policy forces storage public network access off (adds tag SecurityControl=Ignore)

# 1. Infrastructure
az group create -n rg-qld-grants -l australiaeast
az deployment group create -g rg-qld-grants -n main -p infra/main.bicepparam

# 2. Function code (ARM returns output names with odd casing, hence functioN_APP_NAME)
npm ci
npm run build
$app = az deployment group show -g rg-qld-grants -n main --query properties.outputs.functioN_APP_NAME.value -o tsv
func azure functionapp publish $app

# 3. Search objects (index, data source, skillset, indexer, knowledge source, knowledge base)
#    AZURE_RESOURCE_GROUP pulls the deployment outputs into .env for all later script runs
#    (or: npx tsx scripts/setup-search.ts -g rg-qld-grants to force a refresh)
$env:AZURE_RESOURCE_GROUP = 'rg-qld-grants'
npm run setup:search

# 4. First sync (or wait for the weekly timer)
$key = az functionapp function keys list -g rg-qld-grants -n $app --function-name syncGrants --query default -o tsv
Invoke-RestMethod -Method Post "https://$app.azurewebsites.net/api/sync?code=$key"

# 5. Watch the indexer, then query
npm run query -- status

# 6. Grants agent (Foundry prompt agent from agents/*.yaml), then chat with it
npm run setup:agent
npm run chat
```

> Bicep may warn `BCP081 … does not have types available` for the newest API versions (Bicep's type definitions lag behind ARM). ARM still validates these at deploy time. `az deployment group validate` passes with this template.

### Configuration

| App setting | Default | Purpose |
|---|---|---|
| `QLD_API_KEY` | *(Bicep secure param)* | `X-Api-Key` header for the Grants API |
| `QLD_API_BASE_URL` | `https://api.jus-checklist.services.qld.gov.au/v1/api/legacy/resources/grants` | |
| `SYNC_SCHEDULE` | `0 0 16 * * 6` | NCRONTAB in **UTC**: Sat 16:00 UTC = Sun 02:00 AEST |
| `GRANTS_STORAGE_ACCOUNT_URL` / `GRANTS_CONTAINER` | deployment output / `grants` | staging area |
| `SEARCH_ENDPOINT` / `SEARCH_INDEXER_NAME` | deployment output / `grants-indexer` | indexer run after sync |
| `SOFT_DELETE_RETENTION_DAYS` | `30` | purge soft-deleted blobs after N days |

The indexer's own schedule (`search/indexer.json`) is `P1D`, the longest interval AI Search allows. Blob change detection means runs with no changed blobs process nothing, so the effective cadence is the weekly Function, which triggers the indexer as soon as it writes changes.

---

## Local development

```powershell
npm ci
npm test                        # unit tests (dates, normalization, dedupe, blob sync)
$env:QLD_API_KEY = '<key>'
npm run preview                 # live API -> normalized/deduped docs, no Azure needed
npm run preview -- --out grants.preview.json
```

To run the Function locally, copy `local.settings.sample.json` to `local.settings.json`, start Azurite, then run `npm start`. Blob and Search access use your `az login` identity through `DefaultAzureCredential`.

---

## Querying

`scripts/query.ts` runs ready-made scenarios against the index (Entra ID auth, API `2026-08-01-preview`):

```powershell
npm run query -- status                                           # indexer status + index stats
npm run query -- keyword  "fishing"                               # BM25 only
npm run query -- vector   "help for farmers in financial hardship" # pure vector (title + description)
npm run query -- hybrid   "funding for a community sports club"    # BM25 + vector (RRF) + facets
npm run query -- semantic "I want to export my product overseas"   # hybrid + semantic reranker, captions, answers
npm run query -- facets                                           # facet overview of the whole index
npm run query -- filtered "innovation"                            # open + business applicants + grant/loan + amount ≥ 10k
npm run query -- agentic  "What open grants can a small business get for hiring apprentices?"
# add --raw for the full JSON response
```

**Open grants.** `isOpen` is exact at sync time. For an always-current view, filter at query time:

```
status eq 'Open' and (closingDate eq null or closingDate ge 2026-09-29T00:00:00Z)
```

**Raw REST example** (hybrid + semantic + facets):

```http
POST https://<search>.search.windows.net/indexes/grants/docs/search?api-version=2026-08-01-preview
Authorization: Bearer {{az account get-access-token --scope https://search.azure.com/.default}}
Content-Type: application/json

{
  "search": "grants for regional tourism businesses",
  "vectorQueries": [{ "kind": "text", "text": "grants for regional tourism businesses", "fields": "titleVector,descriptionVector", "k": 50 }],
  "queryType": "semantic",
  "semanticConfiguration": "grants-semantic",
  "captions": "extractive",
  "answers": "extractive|count-3",
  "filter": "isOpen eq true and categories/any(c: c eq 'Business and industry')",
  "facets": ["categories,count:20", "applicantTypes", "assistanceType", "amount,values:10000|50000|100000|500000", "closingDate,interval:month"],
  "select": "id,title,status,closingDate,amount,issuingAgency,url",
  "top": 10,
  "count": true
}
```

**Agentic retrieval (FoundryIQ):**

```http
POST https://<search>.search.windows.net/knowledgebases/grants-kb/retrieve?api-version=2026-08-01-preview

{ "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Which open grants support First Nations community groups?" }] }] }
```

The knowledge base (`grants-kb`) is also exposed as an MCP server at `/knowledgebases/grants-kb/mcp`, which the grants agent uses.

---

## Grants agent

`agents/grants-agent.yaml` defines **`qld-grants-agent`**, a Foundry Agent Service **prompt agent** on `gpt-5.4-mini`. Its instructions tell it to:

- always ground answers in the knowledge base, and never invent programs, amounts, dates or links;
- work out who is applying (individual, business, community group, council or researcher) and what they need, asking at most one clarifying question;
- prefer open grants and rank by fit, then by how soon they close;
- present each grant with its status, closing date, amount, agency, who can apply, a plain-English description and the official link, plus citations;
- stay in scope and never ask for personal information.

```yaml
name: qld-grants-agent
definition:
  kind: prompt
  model: ${CHAT_DEPLOYMENT}
  instructions: |
    You are the Queensland Grants Finder ...
  tools:
    - type: mcp
      server_label: qld_grants_kb
      server_url: ${SEARCH_ENDPOINT}/knowledgebases/${KNOWLEDGE_BASE_NAME}/mcp?api-version=2026-08-01-preview
      project_connection_id: ${KB_MCP_CONNECTION_NAME}
      require_approval: never
      allowed_tools: [knowledge_base_retrieve]
```

**How it's wired (all as code):**

1. **Bicep** creates the project connection `grants-kb-mcp`: category `RemoteTool`, auth `ProjectManagedIdentity`, audience `https://search.azure.com/`, target = the knowledge base MCP endpoint. It also grants the project identity **Search Index Data Reader**.
2. **`npm run setup:agent`** renders every `agents/*.yaml` with the deployment outputs in `.env`. It then publishes a new agent version via `POST {project}/agents/{name}/versions?api-version=v1`. The `definition` block maps 1:1 to the REST body, so fields such as `temperature` or `structured_inputs` can be added in YAML. Re-running it publishes a new version.
3. **`npm run chat`** starts a conversation through the project's OpenAI-compatible Responses API (`agent_reference`). It shows each `knowledge_base_retrieve` call.

```powershell
npm run chat                                                        # interactive, multi-turn
npm run chat -- "I run a small cafe in Townsville and want to hire an apprentice. Any funding?"
npm run chat -- --debug "grants for a community sports club"        # include the raw tool calls/output
```

The agent also appears in the **Foundry portal** (project `proj-qldgrants` → Agents), where you can use the playground, view traces and publish it to channels such as Teams or Microsoft 365 Copilot.

---

## Security

- **Keyless by default.** Every hop uses managed identity and Entra ID RBAC:
  - Function → Storage (Blob Data Owner) and Search (Service Contributor, to run the indexer)
  - Search → Storage (Blob Data Reader) and Foundry (Cognitive Services OpenAI User)
  - Foundry project → Search (Index Data Reader + Service Contributor), used by the agent's MCP connection
  - The deploying user (optional `principalId`) gets the data-plane roles needed by the scripts, including Azure AI User to publish and run agents.
- Storage has shared-key access disabled, and Foundry has local (key) auth disabled.
- The QLD API key is passed as a `@secure()` Bicep parameter into a Function app setting. It is never committed. `.env` and `local.settings.json` are git-ignored.

---

## Limitations & notes

- **The Serverless tier is in public preview.** There's no SLA, no migration to or from dedicated tiers, and no index aliases, debug sessions or private networking for indexers. Indexers run under a daily execution quota. See [pricing tiers](https://learn.microsoft.com/azure/search/search-sku-tier).
- The QLD API has no "last modified" field, so changes are detected by content hash.
- `howToApply` is currently empty in the source data. Opening/closing dates and amounts are present for only about 100 grants.
- Agency fields are upstream acronyms (e.g. `QH`, `DETSI`).

## Next steps

- Tune relevance: add scoring profiles (e.g. boost closing-soon grants), synonym maps for agency acronyms, and query rewrite.
- Add evaluation queries with expected results (for both the index and the agent), e.g. with Foundry evaluations.
- Put a UI on the agent, or publish it to Teams / Microsoft 365 Copilot from the Foundry portal.
