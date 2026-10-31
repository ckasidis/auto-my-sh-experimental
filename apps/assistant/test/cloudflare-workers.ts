/**
 * `cloudflare:workers` for tests in Node, resolved through the alias in `vite.config.ts`: the `DurableObject` base
 * class keeps `ctx` and `env`, the only parts the objects under test use. `exports` is empty: the tests build tools over
 * their own stores.
 */
export const exports = {};

export class DurableObject<E = Env> {
  protected readonly ctx: DurableObjectState;
  protected readonly env: E;

  constructor(ctx: DurableObjectState, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
