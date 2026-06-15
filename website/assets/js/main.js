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

  // ---------- Hero download button: detect platform from UA ----------
  const dl = document.getElementById("hero-download");
  const dlLabel = document.getElementById("hero-download-label");
  if (dl && dlLabel) {
    const ua = navigator.userAgent || "";
    const plat = /Windows/i.test(ua)
      ? "win"
      : /Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)
      ? "mac"
      : /Linux/i.test(ua) && !/Android/i.test(ua)
      ? "linux"
      : "all";
    const labelMap = {
      win: "下载 v0.1 (Windows)",
      mac: "下载 v0.1 (macOS)",
      linux: "下载 v0.1 (Linux)",
      all: "下载 v0.1",
    };
    dl.setAttribute("data-platform", plat);
    dlLabel.textContent = labelMap[plat];
  }

  // ---------- Hero platforms dropdown ----------
  const dropdown = document.getElementById("hero-platforms");
  if (dropdown) {
    const trigger = dropdown.querySelector(".btn-dropdown");
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.classList.toggle("open");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", () => {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });
    dropdown.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        dropdown.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      });
    });
  }
})();
