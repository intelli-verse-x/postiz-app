# Postiz multi-tenant by `appId` — Phase 0 freeze + roadmap

## Freeze rules (do not break)

1. **Tenant = one Organization per `appId`.** Never put two brands in one org.
2. **No shared flagship org** for pinned Admin / Content Factory brand users.
3. **`appId` sources:** Admin pin / `?app=` · header/cookie `x-app-id` / `appid` · CF session · MCP scope `postiz__<appId>`.
4. **Provision only** for brand orgs (internal API). Prefer `DISABLE_REGISTRATION=true` in prod once brands are onboarded via provision.
5. **Data isolation** stays on `organizationId`; `appId` is the brand key that *selects* the org.

Canonical `appId` values (mirror Admin `APP_REGISTRY`):

`quizverse` · `questx` · `intelliverse` · `toba` · `contentx` · `foundrly` · `kioskx`

## Inventory (run on prod DB)

```sql
SELECT id, name, "apiKey" IS NOT NULL AS has_key, "createdAt"
FROM "Organization"
ORDER BY "createdAt";
```

After Phase 1 migration, backfill:

```sql
-- Example: map existing orgs by name (edit before running)
-- UPDATE "Organization" SET "appId" = 'foundrly' WHERE id = '<uuid>';
SELECT id, name, "appId" FROM "Organization";
```

## Phase status

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 Freeze | Done (this doc) | Rules + inventory SQL |
| 1 Schema | Done (code + SQL) | `Organization.appId` unique — **apply `pnpm prisma-db-push` or SQL on prod** |
| 2 Provision | Done (code) | `POST /internal/brands/provision` + `GET /internal/brands/:appId` |
| 3 Session bind | Done (code) | `x-app-id` / `appid` forces org; `change-org` membership + appId check |
| 4 CF → Postiz | Pending | Push with appId |
| 5 Admin + MCP | Pending | `postiz__appId` hard bind |
| 6 Hardening | Pending | Cutover / runbook |

## Provision API (Phase 2)

```http
POST /internal/brands/provision
Authorization: Bearer $POSTIZ_INTERNAL_TOKEN
Content-Type: application/json

{
  "appId": "foundrly",
  "label": "Foundrly",
  "ownerEmail": "ops+foundrly@intelli-verse-x.ai",
  "password": "optional-min-8-chars"
}
```

Idempotent: same `appId` returns existing org (`created: false`). On create, response includes `apiKey` + `ownerPassword` once for `TOOL_POSTIZ_*__FOUNDRLY` secrets.

```http
GET /internal/brands/foundrly
Authorization: Bearer $POSTIZ_INTERNAL_TOKEN
```

## Ops apply schema

```bash
# From postiz-app root (uses db push, same as repo scripts)
pnpm prisma-db-push
# or run docs/sql/add_organization_app_id.sql on Postgres
```

## Env

```
POSTIZ_INTERNAL_TOKEN=<long random secret>   # Bearer for /internal/brands/*
```
