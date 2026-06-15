/* ============================================================
   AI DB Client — Website interactions
   - Nav scroll state
   - Mobile menu toggle
   - Reveal-on-scroll for sections
   ============================================================ */

(function () {
  "use strict";

  // ---------- Nav: scrolled state ----------
  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 8) {
        nav.classList.add("scrolled");
      } else {
        nav.classList.remove("scrolled");
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---------- Mobile menu toggle ----------
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      links.classList.toggle("open", !open);
    });

    // close on link click (mobile)
    links.addEventListener("click", (e) => {
      if (e.target.tagName === "A") {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("open");
      }
    });
  }

  // ---------- Reveal on scroll ----------
  const targets = document.querySelectorAll(
    ".section-head, .feature, .stat, .stack-card, .rmap-step, .arch-board, .cta-board, .hero-copy, .hero-visual"
  );
  targets.forEach((el) => el.classList.add("reveal"));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            // small stagger when several elements come in together
            setTimeout(() => entry.target.classList.add("in"), Math.min(i * 60, 200));
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    targets.forEach((el) => io.observe(el));
  } else {
    // fallback: show everything
    targets.forEach((el) => el.classList.add("in"));
  }

  // ---------- Smooth-scroll polyfill for older browsers ----------
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (id.length > 1) {
        const el = document.querySelector(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });

  // ---------- Hero download button + version tag: fetch latest from GitHub ----------
  const REPO = "tomseanmy/dbclient";
  const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

  const versionEls = [
    document.getElementById("brand-version"),
    document.getElementById("footer-version"),
  ].filter(Boolean);
  const dl = document.getElementById("hero-download");
  const dlLabel = document.getElementById("hero-download-label");

  // elements stay hidden by default; only reveal once we have a real tag
  fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      const tag = (data && data.tag_name) || "";
      if (!tag) return;
      const display = tag.startsWith("v") ? tag : `v${tag}`;
      versionEls.forEach((el) => {
        el.textContent = display;
        el.hidden = false;
        // restart the reveal animation
        el.classList.remove("is-loaded");
        // force reflow so the animation can replay
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add("is-loaded");
      });
    })
    .catch(() => {
      // silently keep the version tag hidden; download button still works
    });
})();
