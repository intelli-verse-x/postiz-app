-- Phase 1: Organization.appId for brand multi-tenancy
-- Safe to run once on Postgres (Postiz).

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "appId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_appId_key"
  ON "Organization" ("appId")
  WHERE "appId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Organization_appId_idx"
  ON "Organization" ("appId");
