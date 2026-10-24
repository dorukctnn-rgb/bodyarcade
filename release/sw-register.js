// Registers the service worker (release build; added to every page of the app by release/build.ts) and recovers a
// page that was opened before a deploy: a new build replaces the hashed files, so such a page can fail to load a game
// chunk; it reloads once to get the new build instead of showing a broken round.
(function () {
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !local) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(function () { /* private mode, blocked storage */ });
    });
  }
  addEventListener('vite:preloadError', function (e) {
    var key = 'ba.reloaded-for';
    try {
      if (sessionStorage.getItem(key) === location.pathname) return;
      sessionStorage.setItem(key, location.pathname);
    } catch (err) {
      return;
    }
    e.preventDefault();
    location.reload();
  });
})();
