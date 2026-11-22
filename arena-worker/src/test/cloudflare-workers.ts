// A stand-in for the runtime's "cloudflare:workers" module, for the tests on Node (vitest.config.ts): the base class a
// Durable Object extends, which only keeps its state and env.
export class DurableObject<Env = unknown> {
  protected ctx: DoState;
  protected env: Env;
  constructor(ctx: DoState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
