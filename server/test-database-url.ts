// For tests whose imports reach ./db, which refuses to load without a
// DATABASE_URL. Import this FIRST: imports run in order, so the address is
// set before ./db is read. Nothing connects to it; a test that needs a real
// database names its own variable and skips without it.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
