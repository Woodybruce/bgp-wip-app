-- Migration 0015 — document_design_preferences
--
-- Free-text "house style" preferences that flow into Claude-driven
-- document generation (Why Buy decks initially; KYC Clouseau, PLA briefs,
-- Property Imagery composers later).
--
-- Each row is one preference, scoped to a document type. Active rows are
-- prepended to the generation prompt as "House preferences (from team)"
-- so Claude designs the doc fresh each time but follows accumulated
-- preferences automatically. No rigid override schema — Nick says "always
-- use the brochure hero on the cover", we INSERT one row, every future
-- deck respects it. To change a preference, INSERT a newer one or
-- disable the old one.
--
-- ChatBGP can already manage this table via sql_write (no dedicated
-- tool needed); the Pathway UI also exposes add/remove buttons for
-- non-chat editing.

CREATE TABLE IF NOT EXISTS document_design_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,                     -- 'why_buy' | 'kyc_clouseau' | 'pla_brief' | ...
  preference      TEXT NOT NULL,                     -- the free-text instruction itself
  category        TEXT,                              -- optional grouping: 'cover' | 'comps' | 'branding' | ...
  enabled         BOOLEAN NOT NULL DEFAULT true,
  added_by        TEXT,                              -- user id (text, matches existing user id format)
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at     TIMESTAMPTZ,
  notes           TEXT                               -- optional context: "Nick asked, 2026-05-10"
);

CREATE INDEX IF NOT EXISTS document_design_preferences_scope_active_idx
  ON document_design_preferences (scope)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS document_design_preferences_added_at_idx
  ON document_design_preferences (added_at DESC);
