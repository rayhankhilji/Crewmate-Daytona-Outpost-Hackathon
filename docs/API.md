# API: Crewmate

> Endpoint contracts. Data shapes reference DATA_MODEL.md; module boundaries are in ARCHITECTURE.md.
> This is the interface the three agents build against independently — it is frozen alongside `contract/`.

## Conventions

- Base URL: `http://127.0.0.1:8000`. No version prefix — single-user local app.
- Auth: none. The server binds to loopback only. Do not add an auth layer.
- CORS: allow `http://localhost:5173` only (the Vite dev server).
- Errors: always `{ "error": { "code": "string", "message": "string" } }`. Never leak a stack trace or a raw exception string to a client.
- Status codes: 200 success · 201 created · 202 accepted (work started in background) · 400 validation · 404 missing · 409 conflict · 422 semantic · 500 server.
- Timestamps in responses are ISO-8601 UTC strings.

## Endpoints

### POST /recordings

- **Purpose:** accept an uploaded screen recording from the overlay.
- **Auth:** none.
- **Request:** `multipart/form-data`
  - `video` — file, MP4, required
  - `task_name` — string, required, 1–200 chars
  - `duration_seconds` — number, required
- **Response 201:**
```json
{ "id": "uuid", "task_name": "string", "duration_seconds": 0.0, "status": "uploaded", "created_at": "iso8601" }
```
- **Errors:** 400 if `video` is missing, not MP4, or zero bytes; 400 if `task_name` is empty; 500 on write failure. A failed write must not leave a recordings row behind.

### GET /recordings

- **Purpose:** list recordings for the dashboard's home view, newest first.
- **Auth:** none.
- **Response 200:**
```json
{ "recordings": [ { "id": "uuid", "task_name": "string", "duration_seconds": 0.0, "status": "uploaded|comprehending|comprehended|failed", "brief_id": "uuid | null", "created_at": "iso8601" } ] }
```

### GET /recordings/{id}/video

- **Purpose:** serve the MP4 for playback in the speedrun view.
- **Auth:** none.
- **Response 200:** `video/mp4` with byte-range support. Range support is required — the speedrun view seeks.
- **Errors:** 404 if the recording or its file is missing.

### POST /recordings/{id}/comprehend

- **Purpose:** start comprehension. Returns immediately; work continues in the background.
- **Auth:** none.
- **Request:** empty body.
- **Response 202:**
```json
{ "recording_id": "uuid", "status": "comprehending" }
```
- **Errors:** 404 unknown recording; 409 if already `comprehending` or `comprehended`.
- **Progress:** consume `GET /recordings/{id}/events`.

### GET /recordings/{id}/events

- **Purpose:** SSE stream of comprehension progress, so the dashboard can show work happening rather than a spinner.
- **Auth:** none.
- **Response 200:** `text/event-stream`. Event types:
```
event: progress   data: { "stage": "sampling|analysing|validating", "detail": "string" }
event: complete   data: { "brief_id": "uuid" }
event: error      data: { "code": "string", "message": "string" }
```
Stream closes after `complete` or `error`.

### GET /briefs/{id}

- **Purpose:** fetch a Brief for review, editing, or launch.
- **Auth:** none.
- **Response 200:**
```json
{ "id": "uuid", "recording_id": "uuid", "version": 1, "content": { "…Brief JSON — schema in DATA_MODEL.md…" }, "created_at": "iso8601", "updated_at": "iso8601" }
```
- **Errors:** 404 unknown brief.

### PATCH /briefs/{id}

- **Purpose:** save an edited Brief.
- **Auth:** none.
- **Request:** the complete Brief object — not a partial patch. The client sends the whole thing; the server replaces it and increments `version`.
```json
{ "content": { "…full Brief JSON…" } }
```
- **Response 200:** same shape as `GET /briefs/{id}`.
- **Errors:** 400 with the specific schema validation failure in `message` if `content` is not a valid Brief. The invalid Brief is not persisted and `version` does not increment.

### POST /runs

- **Purpose:** launch a Brief against many input rows. One worker per row.
- **Auth:** none.
- **Request:**
```json
{
  "brief_id": "uuid",
  "rows": [ { "column_name": "value" } ]
}
```
`rows` must be a non-empty array of flat objects with identical keys. Every `source_column` named in the Brief's `variables` must be present as a key.
- **Response 202:**
```json
{ "id": "uuid", "brief_id": "uuid", "status": "pending", "worker_count": 8, "created_at": "iso8601" }
```
- **Errors:** 404 unknown brief; 400 if `rows` is empty, ragged, or missing a column the Brief's variables require — name the missing column in `message`; 409 if `len(rows)` exceeds `MAX_PARALLEL_WORKERS`; 500 if the Daytona API is unreachable. Nothing is created on a 500 — the run does not start partially.

### GET /runs/{id}

- **Purpose:** full run state, including every worker. Used on load and after reconnection.
- **Auth:** none.
- **Response 200:**
```json
{
  "id": "uuid",
  "brief_id": "uuid",
  "snapshot_name": "string",
  "status": "pending|running|complete|failed",
  "started_at": "iso8601 | null",
  "finished_at": "iso8601 | null",
  "workers": [
    {
      "id": "uuid",
      "row_index": 0,
      "row_data": {},
      "status": "pending|running|complete|failed|skipped",
      "current_step_id": 3,
      "error": "string | null"
    }
  ]
}
```
`last_screenshot` is deliberately excluded here — it is large and arrives over SSE instead.

### GET /runs/{id}/events

- **Purpose:** SSE stream driving the live grid. The dashboard's primary data source during a run.
- **Auth:** none.
- **Response 200:** `text/event-stream`. Event types:
```
event: worker    data: { "worker_id": "uuid", "row_index": 0, "status": "…", "current_step_id": 3, "screenshot": "base64 jpeg | null", "error": "string | null" }
event: step      data: { "worker_id": "uuid", "step_id": 3, "status": "ok|retried|failed|skipped", "duration_ms": 0 }
event: run       data: { "status": "running|complete|failed", "finished_at": "iso8601 | null" }
```
`worker` events fire at least every 3 seconds per running worker. Screenshots are compressed JPEG at scale 0.4, quality 60 — never full resolution on this path. Stream closes when the run reaches `complete` or `failed`.

### GET /runs/{id}/results

- **Purpose:** the final results table.
- **Auth:** none.
- **Response 200:**
```json
{
  "run_id": "uuid",
  "results": [
    {
      "row_index": 0,
      "row_data": {},
      "status": "complete|failed|skipped",
      "steps_completed": 7,
      "steps_total": 9,
      "error": "string | null"
    }
  ]
}
```
- **Errors:** 409 if the run is still `pending` or `running`.

### GET /health

- **Purpose:** startup check the dashboard and overlay call before showing a ready state.
- **Response 200:**
```json
{ "ok": true, "daytona": true, "snapshot": "string", "vision_model": "string" }
```
`daytona` is false when the API key is missing or the API is unreachable. The dashboard shows a visible degraded state rather than failing at launch time — but a run started while `daytona` is false must still fail fast per `POST /runs`.

## Webhooks

None. Daytona webhooks are not consumed in v1.
