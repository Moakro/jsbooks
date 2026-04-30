import type { APIRoute } from "astro";

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ user: null }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
