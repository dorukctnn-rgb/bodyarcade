// Marks a content page that is open inside the BodyArcade Android app (a Trusted Web Activity), the way the app itself
// tells (packages/core/entitlements/billing-env.ts, the strong hint): the start address ?src=twa, a referrer of
// android-app://com.peakapps.bodyarcade, or the flag the app's first page left in sessionStorage. content.css then hides
// how to pay on the web and makes the web shop's links plain text: in the app Google Play is the only way to buy
// (Google Play payments policy). Loaded in the head, before the page is drawn; it sends nothing and sets no cookie.
(function () {
  var strong = false;
  try { strong = /[?&]src=twa(?:&|$)/.test(window.location.search); } catch (e) { /* no location */ }
  try { if (!strong && document.referrer.indexOf('android-app://com.peakapps.bodyarcade') === 0) strong = true; } catch (e) { /* no referrer */ }
  try { if (!strong && window.sessionStorage.getItem('ba_twa') === '1') strong = true; } catch (e) { /* storage blocked */ }
  if (!strong) return;
  document.documentElement.classList.add('twa');
  try { window.sessionStorage.setItem('ba_twa', '1'); } catch (e) { /* storage blocked */ }
})();
