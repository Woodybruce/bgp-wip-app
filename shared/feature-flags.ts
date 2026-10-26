// App-wide switches for features that are built but paused.

// Brucey Bonus prize wheel + the Watch House awards board (perks). Hidden
// and no longer allocating prizes — Woody, 2026-10-26: "watch house board
// is no longer but still allocating prizes — hide those but keep the
// concept as I want to work out what to do". Peer kudos stay on.
export const PERKS_ENABLED = false;

// Lettings cleanup (Woody, 2026-10-26, docs/letting-cleanup-thoughts.md §7
// Q10 "Freeze now? Yep"): the overlapping admin repair tools — Settings →
// Data Health "Sync Tracker → Leasing Schedule", "Renumber Units (test)",
// "Rename Legacy Teams", the firm-wide Re-sync (POST
// /api/admin/resync-mirror-all) and the property page's "Promote orphans to
// tenancy" — are hidden and their routes answer 409 while the cleanup runs,
// so the data stops moving under it. Not deleted: flip this back on to
// restore them.
export const LETTING_REPAIR_TOOLS_ENABLED = false;
export const LETTING_REPAIR_PAUSED = "Paused during the lettings cleanup";
