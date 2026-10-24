// Muster site: small progressive enhancements. Everything works without it.
document.documentElement.classList.add('js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

// Repository link: derived from the Pages URL (owner.github.io/repo), or set data-repo on <html>.
(() => {
  let repo = document.documentElement.dataset.repo;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!repo && m) repo = `https://github.com/${m[1]}/${location.pathname.split('/').filter(Boolean)[0] || m[1] + '.github.io'}`;
  document.querySelectorAll('[data-repo-link]').forEach((a) => {
    if (repo) a.href = repo + (a.dataset.repoLink || '');
    else if (a.dataset.repoLink === '') a.hidden = true;
  });
  document.querySelectorAll('[data-repo-clone]').forEach((el) => {
    el.textContent = `git clone ${repo ? repo + '.git' : '<your-fork-url>'}`;
  });
})();

// Top bar border once the page scrolls; mobile menu.
const top = document.querySelector('.top');
const onScroll = () => top && top.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
const menu = document.querySelector('.menu-btn'), nav = document.querySelector('.nav');
if (menu && nav) {
  menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });
}

// Copy buttons: copy the text of the element named by data-copy (or the nearest <pre>).
document.querySelectorAll('.copy').forEach((b) => {
  b.addEventListener('click', async () => {
    const host = b.closest('.cmd, .term, pre');
    const src = b.dataset.copy ? document.querySelector(b.dataset.copy)
      : host?.matches('.term') ? host.querySelector('pre:not([hidden])') : host?.querySelector('code') || host;
    const txt = (src?.innerText || '').split('\n').filter((l) => !l.trim().startsWith('#')).map((l) => l.replace(/^\$ /, '')).join('\n').trim();
    try { await navigator.clipboard.writeText(txt); } catch { return; }
    b.dataset.done = ''; const label = b.getAttribute('aria-label');
    b.setAttribute('aria-label', 'Copied');
    setTimeout(() => { delete b.dataset.done; b.setAttribute('aria-label', label); }, 1600);
  });
});

// Hero film: muted autoplay loop, pause and sound controls; no autoplay under reduced motion.
const video = document.querySelector('.film video');
if (video) {
  const play = document.querySelector('[data-film="play"]'), sound = document.querySelector('[data-film="sound"]');
  const sync = () => {
    play.setAttribute('aria-pressed', String(video.paused));
    play.setAttribute('aria-label', video.paused ? 'Play the film' : 'Pause the film');
    sound.setAttribute('aria-pressed', String(!video.muted));
    sound.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
  };
  if (!reduce.matches) video.play().catch(() => {});
  else video.removeAttribute('autoplay');
  play.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
  sound.addEventListener('click', () => { video.muted = !video.muted; if (!video.muted && video.paused) video.play(); sync(); });
  ['play', 'pause', 'volumechange'].forEach((ev) => video.addEventListener(ev, sync));
  // pause when scrolled away, resume when back (if the viewer hadn't paused it)
  let userPaused = false;
  play.addEventListener('click', () => { userPaused = video.paused; });
  new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) video.pause();
    else if (!userPaused && !reduce.matches) video.play().catch(() => {});
  }, { threshold: 0.2 }).observe(video);
  sync();
}

// Install tabs.
document.querySelectorAll('.term').forEach((t) => {
  const tabs = t.querySelectorAll('[role="tab"]');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === b)); document.getElementById(x.getAttribute('aria-controls')).hidden = x !== b; });
  }));
});

// Reveal on scroll.
const rise = document.querySelectorAll('.rise');
if ('IntersectionObserver' in window && !reduce.matches) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  rise.forEach((el) => io.observe(el));
} else rise.forEach((el) => el.classList.add('in'));

// Docs: highlight the section in view.
const toc = document.querySelectorAll('.toc a[href^="#"]');
if (toc.length) {
  const map = new Map([...toc].map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { toc.forEach((a) => a.classList.remove('active')); map.get(e.target.id)?.classList.add('active'); } });
  }, { rootMargin: '-15% 0px -75% 0px' });
  map.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
}
