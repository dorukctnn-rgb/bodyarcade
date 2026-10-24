// www.bodyarcade.com -> https://bodyarcade.com (301), path and query kept.
// The apex is served by the "bodyarcade" Worker (static assets); this tiny Worker only answers the www host.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'bodyarcade.com';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
