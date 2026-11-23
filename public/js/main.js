/* Scroll effects are CSS scroll-driven animations (css/main.css). This file only
   prepares markup for them and provides a fallback where they are unsupported. */
(function () {
  var nav = document.querySelector('.mast__nav');
  if (nav) {
    var wide = window.matchMedia('(min-width: 900px)');
    var sync = function () { nav.open = wide.matches; };
    sync();
    wide.addEventListener('change', sync);
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var hasTimelines = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');

  if (hasTimelines) {
    // Wrap each word of lead paragraphs so CSS can light them one by one as they scroll past.
    document.querySelectorAll('.fill').forEach(function (el) {
      var words = el.textContent.trim().split(/\s+/);
      el.textContent = '';
      words.forEach(function (w, i) {
        var s = document.createElement('span');
        s.className = 'w';
        s.style.setProperty('--i', i);
        s.textContent = w;
        el.appendChild(s);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      });
    });
    return;
  }

  // Fallback: simple one-shot reveal.
  var targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (t) { t.classList.add('is-in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  targets.forEach(function (t) { io.observe(t); });
})();
