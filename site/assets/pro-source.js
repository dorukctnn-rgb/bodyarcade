// Which kind of site sent a visitor, so each Pro sale in Gumroad shows its channel. The same rules as Peak Apps Tools'
// /assets/pro-source.js and ColoringPageMaker; only CAMPAIGN and OWN below belong to this site.
// On every page the visitor's source is sorted into one word: google, bing, other-search, ai-assistant, pinterest, social,
// referral or direct.
//  1. A tag on the address the visitor landed on (utm_source, then ref, then source; for example ChatGPT's
//     utm_source=chatgpt.com) wins over the referrer. A tag naming a site this script does not know counts as referral.
//  2. Otherwise the host of document.referrer is sorted. This site and Gumroad are ignored, and android-app://<package>
//     referrers are sorted by app.
//  3. Only the word is kept, never an address: for this tab in sessionStorage (pro-source:visit, the first word of the
//     visit), and in localStorage (pro-source:first) the first word other than direct ever seen in this browser, written
//     once and never replaced.
// Nothing leaves the browser until the visitor follows a Pro link (https://dorukctn.gumroad.com/l/<permalink>). At that
// moment (mousedown, touchstart or click, in the capture phase) the link gets utm_source=<the first word, else this
// visit's word, else direct>, utm_medium=<organic|referral|social|none> and utm_campaign=bodyarcade, and Gumroad records
// the three with the sale. The link's other query parameters stay as they are, and a link that already carries a
// utm_source is left alone. The page as served, and any crawler reading it, keeps the plain link. If anything here
// fails, the plain link is followed.
(function () {
  'use strict';
  var CAMPAIGN = 'bodyarcade';
  var OWN = /(^|\.)bodyarcade\.com$/;
  var VISIT = 'pro-source:visit';
  var FIRST = 'pro-source:first';
  var PRO = /^https:\/\/dorukctn\.gumroad\.com\/l\/([A-Za-z0-9_-]+)(?:[\/?#]|$)/;
  // the categories, and the utm_medium each one is reported with
  var MEDIUM = {
    'google': 'organic', 'bing': 'organic', 'other-search': 'organic', 'ai-assistant': 'referral',
    'pinterest': 'social', 'social': 'social', 'referral': 'referral', 'direct': 'none'
  };
  // Tested in this order against a host, so Gemini on google.com counts as an AI assistant.
  var SITES = [
    ['ai-assistant', /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|copilot\.microsoft\.com|gemini\.google\.com|claude\.ai|you\.com|phind\.com|chat\.deepseek\.com|grok\.com|meta\.ai|duck\.ai|chat\.mistral\.ai|poe\.com)$/],
    ['google', /^((www|m|images)\.)?google\.(com?\.)?[a-z]{2,3}$/],
    ['bing', /(^|\.)bing\.com$/],
    ['other-search', /(^|\.)(duckduckgo\.com|search\.yahoo\.(com|co\.jp)|yandex\.(com?\.)?[a-z]{2,3}|ya\.ru|ecosia\.org|search\.brave\.com|search\.naver\.com|search\.seznam\.cz|qwant\.com|startpage\.com)$/],
    ['other-search', /^((www|m)\.)?baidu\.com$/],
    ['pinterest', /(^|\.)(pinterest\.(com?\.)?[a-z]{2,3}|pin\.it)$/],
    ['social', /(^|\.)(reddit\.com|redd\.it|facebook\.com|fb\.com|instagram\.com|x\.com|t\.co|twitter\.com|youtube\.com|youtu\.be|tiktok\.com|threads\.net|threads\.com|linkedin\.com|lnkd\.in|quora\.com)$/]
  ];
  // Android apps send android-app://<package>/ as the referrer. Any other app counts as a referral.
  var APPS = {
    'com.google.android.googlequicksearchbox': 'google',
    'com.microsoft.bing': 'bing',
    'com.duckduckgo.mobile.android': 'other-search',
    'com.openai.chatgpt': 'ai-assistant',
    'ai.perplexity.app.android': 'ai-assistant',
    'com.anthropic.claude': 'ai-assistant',
    'com.google.android.apps.bard': 'ai-assistant',
    'com.microsoft.copilot': 'ai-assistant',
    'com.pinterest': 'pinterest',
    'com.reddit.frontpage': 'social',
    'com.facebook.katana': 'social',
    'com.facebook.lite': 'social',
    'com.instagram.android': 'social',
    'com.instagram.barcelona': 'social',
    'com.twitter.android': 'social',
    'com.zhiliaoapp.musically': 'social',
    'com.ss.android.ugc.trill': 'social',
    'com.google.android.youtube': 'social',
    'com.linkedin.android': 'social',
    'com.quora.android': 'social'
  };
  // Tag values that name a site rather than give its address: utm_source=chatgpt, ref=reddit, source=fb_ads.
  var NAMES = [
    ['ai-assistant', /^(chatgpt|openai|perplexity|copilot|gemini|bard|claude|deepseek|grok|metaai|mistral|lechat|poe|phind)$/],
    ['google', /^google$/],
    ['bing', /^bing$/],
    ['other-search', /^(duckduckgo|ddg|yahoo|yandex|ecosia|brave|baidu|naver|qwant|startpage|seznam)$/],
    ['pinterest', /^pinterest$/],
    ['social', /^(reddit|facebook|fb|instagram|ig|x|twitter|youtube|yt|tiktok|threads|linkedin|quora)$/]
  ];
  function own(map, k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : ''; }
  // this site (whatever host it is served from) and Gumroad
  function ours(host, ownHost) {
    return host === String(ownHost || '').toLowerCase() || OWN.test(host) || /(^|\.)(gumroad\.com|gum\.co)$/.test(host);
  }
  function siteOf(host) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i][1].test(host)) return SITES[i][0];
    return '';
  }

  // The kind of site a referrer belongs to. '' means "do not record": this site, Gumroad, or nothing readable.
  function classify(referrer, ownHost) {
    if (!referrer) return 'direct';
    var m = /^([a-z][a-z0-9+.\-]*):\/\/(?:[^@\/?#]*@)?(\[[^\]]*\]|[^\/?#:]*)/i.exec(String(referrer));
    if (!m) return '';
    var scheme = m[1].toLowerCase(), host = m[2].toLowerCase().replace(/\.$/, '');
    if (scheme === 'android-app') return host ? (own(APPS, host) || 'referral') : '';
    if ((scheme !== 'http' && scheme !== 'https') || !host) return '';
    if (ours(host, ownHost)) return '';
    return siteOf(host) || 'referral';
  }

  // The kind of site one tag value names. '' when it names this site or Gumroad (then the referrer decides).
  function tagKind(value, ownHost) {
    var v = String(value).trim().toLowerCase();
    if (own(MEDIUM, v)) return v;
    var m = /^(?:[a-z][a-z0-9+.\-]*:\/\/)?(?:[^@\/?#]*@)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?:[:\/?#]|$)/.exec(v);
    if (m) return ours(m[1], ownHost) ? '' : (siteOf(m[1]) || 'referral');
    var whole = v.replace(/[^a-z0-9]+/g, ''), head = v.split(/[^a-z0-9]+/)[0];
    if (whole === 'gumroad' || whole === CAMPAIGN.replace(/[^a-z0-9]+/g, '')) return '';
    for (var i = 0; i < NAMES.length; i++) if (NAMES[i][1].test(whole) || NAMES[i][1].test(head)) return NAMES[i][0];
    return 'referral';
  }
  // The landing address's tag: utm_source, then ref, then source. '' when there is none to go by.
  function fromTags(search, ownHost) {
    var q = new URLSearchParams(search || '');
    var v = (q.get('utm_source') || '').trim() || (q.get('ref') || '').trim() || (q.get('source') || '').trim();
    return v ? tagKind(v, ownHost) : '';
  }

  // The link with the source added. '' when it is not a Pro link or already has a utm_source.
  function tag(href, source) {
    var m = PRO.exec(href);
    if (!m || !own(MEDIUM, source)) return '';
    var hash = '', at = href.indexOf('#');
    if (at > -1) { hash = href.slice(at); href = href.slice(0, at); }
    var qs = href.indexOf('?'), base = qs > -1 ? href.slice(0, qs) : href;
    var params = qs > -1 ? href.slice(qs + 1).split('&').filter(Boolean) : [];
    var has = function (k) { for (var i = 0; i < params.length; i++) if (params[i] === k || params[i].indexOf(k + '=') === 0) return true; return false; };
    if (has('utm_source')) return '';
    params.push('utm_source=' + source);
    if (!has('utm_medium')) params.push('utm_medium=' + MEDIUM[source]);
    if (!has('utm_campaign')) params.push('utm_campaign=' + encodeURIComponent(CAMPAIGN));
    return base + '?' + params.join('&') + hash;
  }

  function read(area, key) {
    try { var v = window[area].getItem(key); return own(MEDIUM, v) ? v : ''; } catch (e) { return ''; }
  }
  function readFirst() { var v = read('localStorage', FIRST); return v === 'direct' ? '' : v; }

  var here = '';
  try { here = fromTags(location.search, location.hostname) || classify(document.referrer, location.hostname); } catch (e) {}
  var visit = read('sessionStorage', VISIT) || here;
  var first = readFirst() || (here === 'direct' ? '' : here);
  var remember = function () {
    try { if (here && !read('sessionStorage', VISIT)) window.sessionStorage.setItem(VISIT, here); } catch (e) {}
    try { if (here && here !== 'direct' && !readFirst()) window.localStorage.setItem(FIRST, here); } catch (e) {}
  };
  // A page Chrome prerenders in the background is only counted once the visitor opens it.
  if (here) { if (document.prerendering) document.addEventListener('prerenderingchange', remember); else remember(); }

  // what a Pro click reports: the first word in this browser (another tab may have written it since this page loaded),
  // else this visit's word, else direct
  function source() { return readFirst() || first || visit || 'direct'; }

  // The link changes only as the visitor follows it (mouse, touch, keyboard, or a new tab), so the page as served keeps the
  // plain product link.
  function swap(e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || !PRO.test(a.href)) return;
      var next = tag(a.href, source());
      if (next) a.href = next;
    } catch (err) {}
  }
  if (document.addEventListener) {
    document.addEventListener('mousedown', swap, true);
    document.addEventListener('touchstart', swap, { capture: true, passive: true });
    document.addEventListener('click', swap, true);
  }
  window.proSource = { source: source, classify: classify, fromTags: fromTags, tag: tag };
})();
