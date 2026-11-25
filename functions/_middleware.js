// Every deployment keeps its own address, such as abc12345.dssite-public.pages.dev, so
// older versions of the site would stay readable. Send anyone who opens one of those
// addresses to the live site instead. The main address and any custom domain are untouched.
const LIVE_HOST = "dssite-public.pages.dev";

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname.endsWith(`.${LIVE_HOST}`)) {
    return new Response(null, {
      status: 308,
      headers: { location: `https://${LIVE_HOST}${url.pathname}${url.search}`, "cache-control": "no-store" },
    });
  }
  return next();
}
