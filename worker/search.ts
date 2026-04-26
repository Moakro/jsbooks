/**
 * Semantic search Worker for jsbooks.wiki.
 *
 * GET /api/semantic-search?q=<query>&kind=<filter>&topK=<n>
 *
 * Pipeline:
 *   1. Embed `q` with bge-m3 (Workers AI)
 *   2. Query Vectorize (cosine, top K)
 *   3. Return matches with metadata (title, href, snippet, kind)
 */

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

const MODEL = "@cf/baai/bge-m3";
const ALLOWED_KINDS = new Set([
  "scripture",
  "people",
  "places",
  "dosu",
  "terms",
  "dates",
]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== "GET" && req.method !== "OPTIONS") {
      return json({ error: "method not allowed" }, 405);
    }

    // CORS: Pages and Worker share the same zone, so this is mostly a safety net
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=60",
    };
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const q = (url.searchParams.get("q") ?? "").trim();
    const kindParam = url.searchParams.get("kind");
    const topKParam = parseInt(url.searchParams.get("topK") ?? "12", 10);
    const topK = Math.max(1, Math.min(30, Number.isFinite(topKParam) ? topKParam : 12));

    if (!q) {
      return json({ results: [], note: "empty query" }, 200, corsHeaders);
    }
    if (q.length > 500) {
      return json({ error: "query too long" }, 400, corsHeaders);
    }

    try {
      const embedRes = (await env.AI.run(MODEL, { text: [q] })) as {
        data?: number[][];
      };
      const vector = embedRes.data?.[0];
      if (!vector) {
        return json({ error: "embedding failed" }, 500, corsHeaders);
      }

      const filter =
        kindParam && ALLOWED_KINDS.has(kindParam)
          ? { kind: { $eq: kindParam } }
          : undefined;

      const matches = await env.VECTORIZE.query(vector, {
        topK,
        returnMetadata: "all",
        filter,
      });

      const results = (matches.matches ?? []).map((m) => ({
        id: m.id,
        score: m.score,
        ...(m.metadata as Record<string, unknown>),
      }));

      return json({ q, count: results.length, results }, 200, corsHeaders);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "search failed", detail: msg }, 500, corsHeaders);
    }
  },
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}
