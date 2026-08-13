// Server-side proxy for opencode.ai's Zen model catalog.
//
// opencode.ai's /zen/v1/models endpoint doesn't send CORS headers, so a
// browser fetch from ohnoai.xyz gets blocked client-side. Fetching it here
// (server-to-server) sidesteps CORS entirely, and we hand the same JSON
// shape back to the browser from our own origin.
//
// Consumed by tools/roll-call/index.html's loadLiveModelCatalog().

const UPSTREAM_URL = 'https://opencode.ai/zen/v1/models';
const UPSTREAM_TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(UPSTREAM_URL, { signal: controller.signal });

    if (!upstream.ok) {
      res.status(502).json({ error: 'Upstream error', status: upstream.status });
      return;
    }

    const json = await upstream.json();

    // Cache at the edge for a few minutes - the catalog doesn't change often
    // and this keeps us from hammering opencode.ai on every page load.
    // CORS * so the plain/portable Roll Call zip can load catalogs when hosted
    // off ohnoai.xyz (or opened via a local static server).
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(json);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    res.status(502).json({ error: timedOut ? 'Upstream timeout' : 'Fetch failed' });
  } finally {
    clearTimeout(timeout);
  }
};
