-- The explain proxy's tables: the month's spend against the $20 cap, and the rate limits' windows. No request body, answer
-- or raw IP address is stored; the rate keys hold a salted hash of the address (of its /64 for IPv6).
CREATE TABLE IF NOT EXISTS budget (
  month TEXT PRIMARY KEY,
  spent_nano INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
