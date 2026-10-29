// Which kind of site sent a visitor, so each web sale of Pro in Gumroad shows its channel. The same rules as Peak Apps
// Tools' /assets/pro-source.js and ColoringPageMaker; CAMPAIGN, OWN and APP below belong to this site.
// The release build (release/site.ts SOURCE_TAG) loads it with defer on every page of the site, the app's and the content pages.
// On every page the visitor's source is sorted into one word: google, bing, other-search, ai-assistant, pinterest, social,
// referral or direct.
//  1. A tag on the address the visitor landed on (utm_source, then ref, then source; for example ChatGPT's
//     utm_source=chatgpt.com) wins over the referrer. A tag naming a site this script does not know counts as referral.
//  2. Otherwise the host of document.referrer is sorted. This site, Gumroad and the BodyArcade Android app are ignored,
//     and other android-app://<package> referrers are sorted by app.
//  3. Only the word is kept, never an address: for this tab in sessionStorage (pro-source:visit, the first word of the
//     visit), and in localStorage (pro-source:first) the first word other than direct ever seen in this browser, written
//     once and never replaced.
// This file sends nothing. When a player presses a buy button of the web paywall, the app (packages/web/src/app/pro-source.ts)
// reads the word and adds utm_source=<the first word, else this visit's word, else direct>, utm_medium=<organic|referral|
// social|none> and utm_campaign=bodyarcade to the Gumroad address it opens; Gumroad keeps the three with the order.
// If anything here fails, nothing is kept and the plain address is opened.
(function () {
  'use strict';
  var CAMPAIGN = 'bodyarcade';
  var OWN = /(^|\.)bodyarcade\.com$/;
  // the Android app (a Trusted Web Activity of this site): its pages are this site, and it sells through Google Play only
  var APP = 'com.peakapps.bodyarcade';
  var VISIT = 'pro-source:visit';
  var FIRST = 'pro-source:first';
  // the words, and the utm_medium each one is reported with (pro-source.ts has the same table)
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

  // The kind of site a referrer belongs to. '' means "do not record": this site, Gumroad, the app, or nothing readable.
  function classify(referrer, ownHost) {
    if (!referrer) return 'direct';
    var m = /^([a-z][a-z0-9+.\-]*):\/\/(?:[^@\/?#]*@)?(\[[^\]]*\]|[^\/?#:]*)/i.exec(String(referrer));
    if (!m) return '';
    var scheme = m[1].toLowerCase(), host = m[2].toLowerCase().replace(/\.$/, '');
    if (scheme === 'android-app') return host && host !== APP ? (own(APPS, host) || 'referral') : '';
    if ((scheme !== 'http' && scheme !== 'https') || !host) return '';
    if (ours(host, ownHost)) return '';
    return siteOf(host) || 'referral';
  }

  // The kind of site one tag value names. '' when it names this site, Gumroad or the Android app (then the referrer decides).
  function tagKind(value, ownHost) {
    var v = String(value).trim().toLowerCase();
    if (own(MEDIUM, v)) return v;
    var m = /^(?:[a-z][a-z0-9+.\-]*:\/\/)?(?:[^@\/?#]*@)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?:[:\/?#]|$)/.exec(v);
    if (m) return ours(m[1], ownHost) || m[1] === APP ? '' : (siteOf(m[1]) || 'referral');
    var whole = v.replace(/[^a-z0-9]+/g, ''), head = v.split(/[^a-z0-9]+/)[0];
    if (whole === 'gumroad' || whole === CAMPAIGN || whole === 'twa' || whole === 'androidapp') return '';
    for (var i = 0; i < NAMES.length; i++) if (NAMES[i][1].test(whole) || NAMES[i][1].test(head)) return NAMES[i][0];
    return 'referral';
  }
  // The landing address's tag: utm_source, then ref, then source. '' when there is none to go by.
  function fromTags(search, ownHost) {
    var q = new URLSearchParams(search || '');
    var v = (q.get('utm_source') || '').trim() || (q.get('ref') || '').trim() || (q.get('source') || '').trim();
    return v ? tagKind(v, ownHost) : '';
  }

  function read(area, key) {
    try { var v = window[area].getItem(key); return own(MEDIUM, v) ? v : ''; } catch (e) { return ''; }
  }

  var here = '';
  try { here = fromTags(location.search, location.hostname) || classify(document.referrer, location.hostname); } catch (e) { here = ''; }
  function remember() {
    try { if (here && !read('sessionStorage', VISIT)) window.sessionStorage.setItem(VISIT, here); } catch (e) { /* storage blocked */ }
    try {
      var first = read('localStorage', FIRST);
      if (here && here !== 'direct' && (!first || first === 'direct')) window.localStorage.setItem(FIRST, here);
    } catch (e) { /* storage blocked */ }
  }
  // A page Chrome prerenders in the background is only counted once the visitor opens it.
  try {
    if (here) { if (document.prerendering) document.addEventListener('prerenderingchange', remember, { once: true }); else remember(); }
  } catch (e) { /* nothing kept */ }
})();
