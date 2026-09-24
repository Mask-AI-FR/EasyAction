import { parseEnv, type PiplinerEnv } from "../../server/config/env.ts";

type Handler = (request: Request) => Response | Promise<Response>;

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

/**
 * Faux GitHub : un vrai serveur HTTP local sur un port libre (motif `tests/support/upstreams.ts` des
 * services Org/Billing), plutôt qu'un `fetch` simulé. Chaque test programme les réponses et relit
 * les appels reçus. Une route non programmée répond 599, pour qu'un appel imprévu se voie.
 */
export class FakeGitHub {
  readonly calls: RecordedCall[] = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => this.dispatch(request),
  });

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  /** Configuration de Pipliner pointée sur ce faux GitHub. */
  env(): PiplinerEnv {
    return parseEnv({ ...process.env, GITHUB_WEB_URL: this.url, GITHUB_API_URL: this.url });
  }

  respond(method: string, path: string, handler: Handler): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path === path);
  }

  reset(): void {
    this.calls.length = 0;
    this.handlers.clear();
  }

  stop(): void {
    void this.server.stop(true);
  }

  private async dispatch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    this.calls.push({
      method: request.method,
      path,
      headers: request.headers,
      body: await request.clone().text(),
    });
    const handler = this.handlers.get(`${request.method} ${path}`);
    return handler ? handler(request) : new Response("not programmed", { status: 599 });
  }
}
