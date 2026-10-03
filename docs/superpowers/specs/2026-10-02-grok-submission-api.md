# Chicago Pipeline Submission API — Instructions for Grok

**Date:** 2026-10-02
**Status:** Draft for review (the API does not exist yet; build against this once Drew confirms it is live)
**Design:** `2026-10-02-data-platform-design.md`

You (the Chicago Data Bot) send every record you find each day to the Chicago Pipeline API.
Everything you send goes into a review queue; Drew approves it before anything is published.
You do not need to work out what changed — always send the full current version of each record.

## 1. Endpoint and authentication

```
POST https://api.chicagopipeline.com/v1/submissions
Authorization: Bearer <your token>
Idempotency-Key: <run_id>
Content-Type: application/json
```

- Your token is a JWT with role `submitter`. Drew gives it to you once; store it as a secret, never
  log it, never put it in a URL or a file in an output folder. It can only submit records.
- `Idempotency-Key` is the run's `run_id` plus the chunk number when you split a run, e.g.
  `zoning-2026-10-02-1`. Use exactly the same key and body when you retry the same chunk.
- At most **500 records per request**. Split larger runs (and backfills) into chunks.
- Validate first if you like: `GET https://api.chicagopipeline.com/v1/schema/submission.json`
  returns the JSON Schema. `POST /v1/submissions?dry_run=true` checks a request and returns the
  results without saving anything.

## 2. When to send (changes to your daily procedure)

For each program (permits, zoning):

1. Run the program as today; it writes the pending JSON (`out/daily_*.json`, `out/zoning_daily_*.json`).
2. Upload zoning PDFs to Drive and attach Drive links, as today.
3. **POST every record in the pending output** — target-area and citywide rows alike, new and
   updated — in chunks of up to 500.
4. Only if **every** chunk returned `202`: write to Sheets as today (until Drew says to stop), then
   run `commit`, then send the email.
5. If any chunk fails after retries (§6), do **not** run `commit`. The next run's overlap re-sends.

For backfills (`backfill`, `zba-backfill`), send the backfilled records the same way with
`run.program` set to `permits-backfill` or `zoning-backfill`.

## 3. Request body

```json
{
  "run": {
    "program": "zoning",
    "run_id": "zoning-2026-10-02",
    "started_at": "2026-10-02T12:39:00Z",
    "bot_version": "chicago-permits@<git short sha or date>"
  },
  "records": [
    {
      "kind": "zoning_matter",
      "source_key": "O2026-0012345",
      "observed_at": "2026-10-02T12:44:10Z",
      "data": { },
      "field_sources": { "ward": "ocr", "units": "ocr" }
    }
  ]
}
```

| Field | Type | Rule |
|---|---|---|
| `run.program` | string | `permits`, `zoning`, `permits-backfill`, `zoning-backfill` |
| `run.run_id` | string | `<program>-<YYYY-MM-DD>`; add `-2`, `-3`… if you run a program twice in a day |
| `run.started_at`, `observed_at` | string | ISO 8601 UTC timestamp |
| `kind` | string | `permit`, `zoning_matter`, `hearing_item`, `zba_case` (Early Signals are `permit`) |
| `source_key` | string | your dedupe key, see each kind below |
| `data` | object | fields for that kind (§4) |
| `field_sources` | object, optional | where a derived value came from: field name → `ocr`, `ward_map`, `cpc_description`, `permit_text`, `socrata`, `elms`, `minutes`, `decisions`, `resolution` |

**General value rules**

- Dates: `"YYYY-MM-DD"`. Timestamps: ISO 8601 UTC.
- Numbers as JSON numbers, not strings: `220`, not `"220"`. Money in whole dollars: `1250000`.
- Y/N fields as `true` / `false`; `null` when unknown or blank.
- Unknown or unread values: `null`. Never `""`, `"N/A"`, `"—"` or `"unknown"`.
- If a numeric field is not a plain number (e.g. OCR read `approx. 220` or `220-240`), send `null`
  and put the original text in `notes`.
- Send text exactly as the source prints it (addresses, names, PINs with or without dashes). The
  server normalizes formats; do not invent your own normalization.
- Lists: always arrays (`[]` when empty), never comma-joined strings.
- `in_target`: your §0.1 target-area result. `scope`: your scope label text. `notes`: your Notes column.
- Unknown extra fields are rejected — only send the fields listed below.

## 4. Fields for each kind

Required fields are marked **R**; everything else may be `null`.

### 4.1 `permit` (Building Permits 20+ and Early Signals)

`source_key` = the Socrata `permit_` value.

| Field | Type | From |
|---|---|---|
| `permit_number` **R** | string | `permit_` (same as `source_key`) |
| `classification` **R** | string | `qualifying_20plus` or `early_signal` |
| `issue_date` **R** | date | Issue Date |
| `permit_type` | string | Permit Type |
| `address` **R** | string | Address as printed |
| `zip` | string | ZIP |
| `community_area` | string | Community Area as printed (`"32 Loop"`) |
| `ward` | integer | Socrata ward |
| `lat`, `lon` | number | Latitude, Longitude |
| `units` | object | `{ "total": int, "dwelling": int, "efficiency": int, "affordable": int }`, each nullable |
| `unit_flag` | string | Unit Count Flag (e.g. `Ambiguous: …`) |
| `reported_cost` | integer | Reported Cost, whole dollars |
| `contacts` | array | `[{ "role": "Owner", "name": "…" }]` from Contacts |
| `short_description` | string | Short Description |
| `work_description` | string | Work Description |
| `permit_status` | string | Socrata permit status |
| `permit_condition` | string | Socrata `permit_condition`, verbatim (ordinance and APP numbers are read from it) |
| `pin_list` | array of strings | Socrata PINs, as printed |
| `portal_url` | string | Portal Link |
| `scope` | string | Scope |
| `in_target` **R** | boolean | target-area result |
| `notes` | string | Notes |

### 4.2 `zoning_matter` (eLMS)

`source_key` = `matter_key` (record # with the leading `S` removed).

| Field | Type | From |
|---|---|---|
| `record_number` **R** | string | Record # (current, as printed) |
| `matter_id` | string | eLMS matter GUID |
| `dpd_app_no` | string | DPD App # |
| `title` | string | matter title |
| `filed_date` | date | Filed date |
| `introduced_date` | date | Introduced date |
| `hearing_date` | date | Hearing date (latest Committee on Zoning action date, or linked CPC hearing) |
| `address` | string | Address as printed (first address if several; others in `additional_addresses`) |
| `additional_addresses` | array of strings | other parsed title addresses |
| `zip` | string | ZIP |
| `community_area` | string | Community Area |
| `ward` | integer | Ward |
| `lat`, `lon` | number | trusted geocode only (score ≥ 90), else `null` |
| `applicant`, `owner`, `attorney` | string | as read (OCR artifacts included); `"Same as applicant"` → send the applicant's name |
| `zoning_from`, `zoning_to` | string | Current Zoning, Proposed Zoning |
| `lot_size_sqft` | integer | Lot Size |
| `units` | integer | Units |
| `height_ft` | number | Height |
| `parking` | integer | Parking spaces |
| `aro` | boolean | ARO |
| `pd` | boolean | PD |
| `aldermanic` | boolean | aldermanic or City-initiated matter |
| `status` **R** | string | Status, exactly as eLMS shows it now |
| `flag` | string | Flag |
| `source_url` **R** | string | official eLMS / PDF source link |
| `drive_pdf_url` | string | PDF (Drive) |
| `in_target` **R** | boolean | target-area result |
| `notes` | string | Notes |

### 4.3 `hearing_item` (Plan Commission)

`source_key` = `"<hearing_date>|<dpd_app_no>"`, your existing key (address slug in place of the app # when there is none).

| Field | Type | From |
|---|---|---|
| `body` **R** | string | always `"cpc"` |
| `hearing_date` **R** | date | hearing date |
| `dpd_app_no` | string | DPD App # |
| `matter_key` | string | linked eLMS `matter_key`, when you linked it |
| `address` **R** | string | Address |
| `zip`, `community_area` | string | |
| `ward` | integer | |
| `lat`, `lon` | number | trusted geocode only |
| `applicant` | string | Applicant |
| `request` | string | item description |
| `zoning_from`, `zoning_to` | string | when stated |
| `units` | integer | |
| `height_ft` | number | |
| `parking` | integer | |
| `pd` | boolean | |
| `source_url` **R** | string | hearing page or PDF link |
| `in_target` **R** | boolean | |
| `notes` | string | |

### 4.4 `zba_case`

`source_key` = Case # (e.g. `420-24-S`). One record per case, carrying its full hearing history.

| Field | Type | From |
|---|---|---|
| `case_no` **R** | string | Case # |
| `request_type` | string | Request Type (e.g. `Special use`, `Variation`) |
| `first_hearing` | date | First Hearing |
| `hearing_date` | date | latest Hearing Date |
| `address` **R** | string | Address |
| `zip`, `community_area` | string | |
| `ward` | integer | Ward |
| `lat`, `lon` | number | trusted geocode only |
| `applicant`, `owner`, `attorney` | string | `"Same as applicant"` → send the applicant's name |
| `zoning_district` | string | Zoning District |
| `request` | string | Request text |
| `units` | integer | Units |
| `residential` | boolean | Residential |
| `outcome` | string | Decision / Outcome |
| `vote` | string | Vote (e.g. `4-0`) |
| `decision_date` | date | Decision Date |
| `hearings` | array | `[{ "date": date, "outcome": string, "vote": string\|null, "continued_to": date\|null, "source_url": string }]` from `zba_cases[case].hearings` |
| `source_pdf_url` | string | Source PDF (minutes/decisions/agenda) |
| `resolution_pdf_url` | string | Resolution PDF |
| `flag` | string | Flag |
| `in_target` **R** | boolean | Target Area |
| `notes` | string | Notes |

## 5. Example request (one record of each kind; values illustrative)

```json
{
  "run": { "program": "zoning", "run_id": "zoning-2026-10-02", "started_at": "2026-10-02T12:39:00Z", "bot_version": "chicago-permits@2026-10-01" },
  "records": [
    {
      "kind": "zoning_matter",
      "source_key": "O2026-0012345",
      "observed_at": "2026-10-02T12:44:10Z",
      "data": {
        "record_number": "O2026-0012345", "matter_id": null, "dpd_app_no": "23020", "title": null,
        "filed_date": "2026-03-02", "introduced_date": "2026-03-18", "hearing_date": "2026-06-17",
        "address": "100-120 W. Madison Street", "additional_addresses": [], "zip": "60602",
        "community_area": "32 Loop", "ward": 42, "lat": 41.8819, "lon": -87.6306,
        "applicant": "Example Owner LLC", "owner": "Example Owner LLC", "attorney": null,
        "zoning_from": "DC-16", "zoning_to": "PD", "lot_size_sqft": null, "units": 220,
        "height_ft": null, "parking": null, "aro": true, "pd": true, "aldermanic": false,
        "status": "In Committee - Referred", "flag": null,
        "source_url": "https://chicityclerkelms.chicago.gov/Matter/?matterId=…",
        "drive_pdf_url": null, "in_target": true, "notes": null
      },
      "field_sources": { "units": "ocr", "ward": "ocr" }
    },
    {
      "kind": "zba_case",
      "source_key": "420-24-S",
      "observed_at": "2026-10-02T12:51:02Z",
      "data": {
        "case_no": "420-24-S", "request_type": "Special use", "first_hearing": "2024-10-18",
        "hearing_date": "2024-10-18", "address": "3642 W. Oakdale Avenue", "zip": "60618",
        "community_area": "21 Avondale", "ward": 35, "lat": null, "lon": null,
        "applicant": "4645 North Clark, LLC", "owner": "4645 North Clark, LLC", "attorney": "Ximena Castro",
        "zoning_district": "B3-2",
        "request": "Application for a special use to establish residential use below the second floor …",
        "units": 4, "residential": true, "outcome": "Approved", "vote": "4-0", "decision_date": "2024-10-18",
        "hearings": [ { "date": "2024-10-18", "outcome": "Approved", "vote": "4-0", "continued_to": null,
                        "source_url": "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf" } ],
        "source_pdf_url": "https://www.chicago.gov/content/dam/city/depts/zlup/Administrative_Reviews_and_Approvals/Agendas/ZBA_Oct_2024_Minutes.pdf",
        "resolution_pdf_url": null, "flag": null, "in_target": true, "notes": null
      }
    }
  ]
}
```

A `permit` record and a `hearing_item` record follow the same pattern with the fields in §4.1 and §4.3.

## 6. Responses, errors and retries

**`202 Accepted`** — the request was processed. Check each result:

```json
{
  "submission_id": 812,
  "results": [
    { "index": 0, "source_key": "O2026-0012345", "outcome": "queued_update", "queue_item_id": 4410, "changed": ["status"] },
    { "index": 1, "source_key": "420-24-S", "outcome": "no_change" }
  ]
}
```

| `outcome` | Meaning | What you do |
|---|---|---|
| `queued_create` | new record, waiting for review | nothing |
| `queued_update` | changed record, waiting for review; `changed` lists fields | nothing |
| `no_change` | identical (after normalization) to what is accepted, pending, or was rejected | nothing |
| `invalid` | record rejected; `errors: [{ path, message }]` | log it and include it in your daily email; fix the code; it will be re-sent next run |

A `202` with some `invalid` results still counts as success for running `commit`.

| Status | Meaning | Retry? |
|---|---|---|
| `400` | the envelope is malformed (missing `run`, `records` not an array…) | no — fix the code |
| `401` | token missing, invalid or revoked | no — tell Drew |
| `403` | token is not allowed to submit | no — tell Drew |
| `409` | this `Idempotency-Key` was already used with a different body | no — you changed a chunk while retrying; use a new key only for genuinely new data |
| `413` | more than 500 records | no — split into smaller chunks |
| `429` | rate limited | yes, after the `Retry-After` seconds |
| `5xx`, timeout, network error | server problem | yes |

**Retry schedule:** up to 4 attempts after 1, 5, 15 and 30 minutes, with the **same key and same body**.
A retry of a request that already succeeded returns the original response, so retrying is always safe.
If all attempts fail, skip `commit`, and mention the failure (status and response text) in the daily email.

## 7. Don'ts

- Don't send only changed records — send everything the run found.
- Don't reformat values (PINs, addresses, names); send them as the source prints them.
- Don't send records from `/workspace/zoning-sources` prototypes or `cache/pipeline_projects.json`.
- Don't put the token in logs, emails, URLs or output files.
