interface Connectable { connect(): Promise<unknown>; end(): Promise<unknown> }

/** Connects with a new client per attempt (a pg.Client cannot reconnect after a failed connect). */
export async function connectWithRetry<C extends Connectable>(make: () => C, opts: { attempts: number; delayMs: number }): Promise<C> {
  for (let attempt = 1; ; attempt++) {
    const client = make();
    try {
      await client.connect();
      return client;
    } catch (e) {
      await client.end().catch(() => {});
      if (attempt >= opts.attempts) throw e;
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }
}
