# BEYOND BORING: DEATH MARCH — Social API

The game is static; only the graveyard has a server.

C# .NET 8 isolated-worker Azure Function app backing the global death feed and hall of fame.

**Base URL:** `https://death-march-prod-functions.azurewebsites.net/api`

## Endpoints

### `GET /api/deaths`

Returns the 50 most recent deaths, newest first.

```json
[
  {
    "name": "Pat",
    "cause": "Died of context exhaustion",
    "mile": 847,
    "epitaph": "The estimate was fine. The date was not.",
    "role": "Staff Engineer",
    "days": 63,
    "timestamp": "2026-07-25T13:44:40Z"
  }
]
```

### `POST /api/deaths`

```json
{ "name": "...", "cause": "...", "mile": 847, "epitaph": "...", "role": "Staff Engineer", "days": 63 }
```

Returns `201` with a message, or `400` with `{ "error": "..." }`.

### `GET /api/scores`

Returns the top 100 scores, highest first. Fields: `name`, `score`, `role`, `days`, `miles`, `deadlinesMet`, `deadlinesMissed`, `businessDeadlineMet`, `timestamp`.

### `POST /api/scores`

```json
{
  "name": "...", "score": 12450, "role": "Contractor, 6-Week Statement of Work",
  "days": 118, "miles": 2000, "deadlinesMet": 4, "deadlinesMissed": 3,
  "businessDeadlineMet": true
}
```

## Validation (server-side, all POSTs)

| Rule | Limit |
|---|---|
| `name` | required, ≤ 24 chars |
| `cause` | required, ≤ 90 chars |
| `epitaph` | optional, ≤ 120 chars |
| `role` | one of: `VP of Adjacent Concerns`, `Staff Engineer`, `Contractor, 6-Week Statement of Work` (short forms `VP`, `Contractor` accepted) |
| `mile` / `miles` | integer 0–2000 |
| `days` | positive integer |
| `deadlinesMet` / `deadlinesMissed` | integer 0–1000 |
| Charset | printable ASCII only (0x20–0x7E) |
| Profanity | embedded denylist with leetspeak normalization — rejected, never sanitized |
| Body size | ≤ 4 KB |

All error responses are JSON `{ "error": "..." }` in the game's voice, e.g.
`"epitaph exceeds 120 characters. Even in death there is a character limit."`

## Rate limiting

Max **10 POSTs per hour per IP** (deaths + scores combined), tracked in a Table Storage
counter keyed by hashed IP + UTC hour. Over the limit returns `429`:

> You have filed 10 submissions this hour. The intake board meets again at the top of the hour. Your enthusiasm has been noted and forwarded to no one.

## CORS

Configured on the Function App resource (not just code): `https://kolatts.github.io` and
`http://localhost:5173`. Other origins fail preflight.

## Storage layout

Azure Table Storage, three tables (created on first use):

- `deaths` — PartitionKey `DEATH`, RowKey = inverted ticks + uniquifier → newest-first is a single cheap page query.
- `scores` — PartitionKey `SCORE`, RowKey = inverted offset score + inverted ticks → highest-first is a single cheap page query.
- `ratelimits` — PartitionKey `RATE`, RowKey = `sha256(ip)[..16]-yyyyMMddHH`. Old hour buckets are never read again; storage cost is effectively zero. (No TTL in Table Storage; rows accumulate at fractions of a cent per decade.)

## Azure resources

| Resource | Name |
|---|---|
| Resource group | `death-march-prod` (centralus) |
| Function App | `death-march-prod-functions` (Y1 Windows consumption, dotnet-isolated 8, Functions v4) |
| Storage account | `deathmarchprodstorage` (Standard_LRS — hosts the app + the three tables) |
| Application Insights | `death-march-prod-ai` (workspace-based, adaptive sampling capped at 5 items/sec via host.json) |
| Log Analytics workspace | `death-march-prod-law` (30-day retention, the minimum) |

Estimated cost: effectively $0/month at hobby traffic — consumption plan free grant
(1M executions), Table Storage pennies, App Insights within the 5 GB/month free ingestion tier.

## Local development

```
cd api
func start        # requires Azurite or a real storage connection in local.settings.json
```

## Deploy

```
dotnet publish api/BeyondBoring.DeathMarch.Functions.csproj -c Release -o api/bin/publish
Compress-Archive api/bin/publish/* death-march-api.zip -Force
az functionapp deployment source config-zip -g death-march-prod -n death-march-prod-functions --src death-march-api.zip
```
