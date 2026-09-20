/**
 * brand-profile-suggestions.test.ts — pending contact suggestions repair.
 *
 * Problem A: the company-profile endpoint expanded crm_interactions.participants
 * (jsonb) with unnest(), which only works on Postgres arrays — the query threw
 * and a bare catch {} swallowed it, so suggestions were always empty. The fix
 * uses jsonb_array_elements_text with a jsonb_typeof guard, lowercases both
 * sides of the already-a-contact exclusion, and ignores future-dated rows.
 *
 * Run with: node --import tsx --test server/brand-profile-suggestions.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandParticipants, PENDING_CONTACT_SUGGESTIONS_SQL } from "./brand-profile-suggestions";

describe("expandParticipants", () => {
  it("expands a jsonb array, trimming and lowercasing", () => {
    assert.deepEqual(expandParticipants(["Alice@Example.com", " bob@example.com "]), ["alice@example.com", "bob@example.com"]);
  });

  it("de-duplicates case-insensitively", () => {
    assert.deepEqual(expandParticipants(["a@x.com", "A@X.COM", "b@x.com"]), ["a@x.com", "b@x.com"]);
  });

  it("handles a legacy bare-string participants value", () => {
    assert.deepEqual(expandParticipants("Solo@Example.com"), ["solo@example.com"]);
  });

  it("returns [] for null/undefined", () => {
    assert.deepEqual(expandParticipants(null), []);
    assert.deepEqual(expandParticipants(undefined), []);
  });

  it("returns [] for non-string jsonb values and skips non-string entries", () => {
    assert.deepEqual(expandParticipants(42), []);
    assert.deepEqual(expandParticipants({ email: "a@x.com" }), []);
    assert.deepEqual(expandParticipants(["a@x.com", 7, null, "", "  "]), ["a@x.com"]);
  });
});

describe("PENDING_CONTACT_SUGGESTIONS_SQL", () => {
  it("expands participants with jsonb_array_elements_text, never unnest", () => {
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /jsonb_array_elements_text\(participants\)/i);
    assert.doesNotMatch(PENDING_CONTACT_SUGGESTIONS_SQL, /\bunnest\s*\(/i);
  });

  it("guards legacy scalar/null jsonb rows with jsonb_typeof", () => {
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /jsonb_typeof\(participants\)\s*=\s*'array'/i);
  });

  it("lowercases the participant on both sides of the CRM-contact exclusion", () => {
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /LOWER\(p\) NOT IN \(\s*SELECT LOWER\(email\) FROM crm_contacts/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /SELECT LOWER\(p\) AS email/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /GROUP BY LOWER\(p\)/i);
  });

  it("ignores future-dated interactions", () => {
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /interaction_date <= NOW\(\)/i);
  });

  it("keeps the domain ILIKE filter, BGP-staff exclusion, ordering and limit", () => {
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /p ILIKE \$1/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /p NOT ILIKE '%@brucegillinghampollard\.com'/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /company_id = \$2/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /ORDER BY touches DESC, last_touch DESC/i);
    assert.match(PENDING_CONTACT_SUGGESTIONS_SQL, /LIMIT 20/i);
  });
});
