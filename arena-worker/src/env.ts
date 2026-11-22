// What the Worker is given (wrangler.toml).
export interface Env {
  /** one Durable Object per table, by its 128-bit id */
  TABLES: DoNamespace;
  /** the rate limits' counters: one Durable Object per address, one for everyone */
  LIMITS: DoNamespace;
  /** https://www.michael-han.com: a browser request from anywhere else is refused (a soft signal: a client outside a
   * browser can send any Origin, or none, and the limits are what hold it) */
  SITE_ORIGIN: string;
  /** more origins allowed, comma-separated: local development only (`wrangler dev --var DEV_ORIGINS:...`) */
  DEV_ORIGINS?: string;
}
