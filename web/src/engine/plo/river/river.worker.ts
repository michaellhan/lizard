// The river solve's thread. Everything is in run.ts, which can be tested without a browser.
import { serveRiver, type RiverPort } from "./run";

serveRiver(self as unknown as RiverPort);
