import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const prerender = true;

export const GET: APIRoute = async () => {
  const all = await getCollection("scripture");
  const target = all.find((e) => e.id === "hwaeundang-silgi/02_제2장");
  if (!target) return new Response(JSON.stringify({ found: false }));
  const body = target.body ?? "";
  return new Response(
    JSON.stringify({
      id: target.id,
      bodyType: typeof target.body,
      bodyLength: body.length,
      bodyFirst300: body.slice(0, 300),
      wikilinkCount: (body.match(/\[\[/g) ?? []).length,
      keys: Object.keys(target),
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
};
