// The equity job's thread. Everything is in equityRun.ts, which can be tested without a browser.
import { serveEquity, type EquityPort } from "./equityRun";

serveEquity(self as unknown as EquityPort);
