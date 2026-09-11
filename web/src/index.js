// Kerf hosted Worker — serves the static app/ with a few safety headers.
// No /api here: a browser can't reach the cutter, so the hosted edition is
// export / Save-to-stick only (the app hides the LAN panel automatically).
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
