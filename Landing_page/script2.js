/* ==========================================================================
   PerScope — script.js
   Vanilla JS only. No frameworks.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
  initBeforeAfterSlider();
  initMobileMenu();
  initNavActiveState();
});

/* --------------------------------------------------------------------------
   Before / After redaction slider
   (Preserved from the original inline script — same drag/touch/click logic)
   -------------------------------------------------------------------------- */
function initBeforeAfterSlider() {
  const container = document.getElementById('slider-container');
  const handle = document.getElementById('slider-handle');
  const redactedOverlay = document.getElementById('redacted-overlay');

  if (!container || !handle || !redactedOverlay) return;

  let isDragging = false;

  function setPosition(xPercent) {
    const clamped = Math.max(0, Math.min(100, xPercent));
    handle.style.left = clamped + '%';
    redactedOverlay.style.clipPath = 'polygon(' + clamped + '% 0, 100% 0, 100% 100%, ' + clamped + '% 100%)';
    handle.setAttribute('aria-valuenow', Math.round(clamped));
  }

  function handleMove(e) {
    if (!isDragging) return;
    const rect = container.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const xOffset = clientX - rect.left;
    const xPercent = (xOffset / rect.width) * 100;
    setPosition(xPercent);
  }

  handle.addEventListener('mousedown', function () { isDragging = true; });
  window.addEventListener('mouseup', function () { isDragging = false; });
  window.addEventListener('mousemove', handleMove);

  handle.addEventListener('touchstart', function () { isDragging = true; }, { passive: true });
  window.addEventListener('touchend', function () { isDragging = false; });
  window.addEventListener('touchmove', handleMove, { passive: true });

  container.addEventListener('click', function (e) {
    const rect = container.getBoundingClientRect();
    const xOffset = e.clientX - rect.left;
    const xPercent = (xOffset / rect.width) * 100;
    setPosition(xPercent);
  });

  // Keyboard support for the slider handle (left/right arrow keys)
  handle.addEventListener('keydown', function (e) {
    const current = parseFloat(handle.style.left) || 52;
    if (e.key === 'ArrowLeft') {
      setPosition(current - 5);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      setPosition(current + 5);
      e.preventDefault();
    }
  });
}

/* --------------------------------------------------------------------------
   Mobile menu toggle
   -------------------------------------------------------------------------- */
function initMobileMenu() {
  const toggle = document.getElementById('mobile-menu-toggle');
  const menu = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');

  if (!toggle || !menu) return;

  toggle.addEventListener('click', function () {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    if (icon) icon.textContent = isOpen ? 'close' : 'menu';
  });

  // Close the mobile menu after a nav link is tapped
  menu.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('click', function () {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (icon) icon.textContent = 'menu';
    });
  });

  // Close the mobile menu if the viewport is resized past the desktop breakpoint
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 1024 && menu.classList.contains('is-open')) {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (icon) icon.textContent = 'menu';
    }
  });
}

/* --------------------------------------------------------------------------
   Nav active-state on scroll (highlights the section currently in view)
   Smooth scrolling itself is handled by CSS (html { scroll-behavior: smooth })
   -------------------------------------------------------------------------- */
function initNavActiveState() {
  const sections = ['overview', 'how-it-works', 'verification', 'architecture', 'get-perscope']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  const navLinks = document.querySelectorAll('.nav-link[data-path]');
  if (!sections.length || !navLinks.length) return;

  function setActive(id) {
    navLinks.forEach(function (link) {
      const matches = link.getAttribute('data-path') === id;
      link.classList.toggle('active', matches);
      if (matches) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        setActive(entry.target.id);
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });

  sections.forEach(function (section) { observer.observe(section); });
}
