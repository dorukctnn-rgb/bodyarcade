/* BodyArcade landing: small, dependency-free interactions. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Nav border once the page scrolls, and the phone menu.
  const nav = document.querySelector('[data-nav]');
  const menu = document.querySelector('[data-menu]');
  const onScroll = () => nav && nav.classList.toggle('is-stuck', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (menu) {
    menu.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', open);
    });
    nav.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }));
  }

  // Reveal on scroll.
  const items = document.querySelectorAll('.rv');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    items.forEach((el, i) => { el.style.transitionDelay = (i % 5) * 60 + 'ms'; io.observe(el); });
  }

  // Sticky play button on phones once the hero CTA scrolls away.
  const sticky = document.querySelector('[data-mobile-play]');
  const heroCta = document.querySelector('.hero-cta');
  if (sticky && heroCta && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => sticky.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(heroCta);
  }

  // Analytics events for the main actions (Plausible, if loaded).
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-event]');
    if (a && window.plausible) window.plausible(a.dataset.event, { props: { where: a.dataset.where || '' } });
  });

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
