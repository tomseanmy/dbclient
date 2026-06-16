/* ============================================================
   AI DB Client — Website interactions
   - Nav scroll state
   - Mobile menu toggle
   - Active nav link (current page)
   - Reveal-on-scroll for sections
   - Docs sidebar: scroll-spy active section
   - Download page: OS detect + GitHub Releases fetch
   - Hero/footer version tag: fetch latest from GitHub
   ============================================================ */

;(function () {
  'use strict'

  const REPO = 'tomseanmy/dbclient'
  const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
  const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

  // ---------- Nav: scrolled state ----------
  const nav = document.querySelector('.nav')
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 8) {
        nav.classList.add('scrolled')
      } else {
        nav.classList.remove('scrolled')
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  // ---------- Mobile menu toggle ----------
  const toggle = document.querySelector('.nav-toggle')
  const links = document.querySelector('.nav-links')
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true'
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true')
      links.classList.toggle('open', !open)
    })

    // close on link click (mobile)
    links.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        toggle.setAttribute('aria-expanded', 'false')
        links.classList.remove('open')
      }
    })
  }

  // ---------- Active nav link (highlight current page) ----------
  ;(function markActiveNav() {
    const navAnchors = document.querySelectorAll('.nav-links a')
    if (!navAnchors.length) return
    let path = location.pathname.split('/').pop() || 'index.html'
    if (path === '') path = 'index.html'
    navAnchors.forEach((a) => {
      const href = a.getAttribute('href') || ''
      if (href === path) a.classList.add('active')
    })
  })()

  // ---------- Reveal on scroll ----------
  const targets = document.querySelectorAll(
    '.section-head, .feature, .stat, .stack-card, .rmap-step, .arch-board, .cta-board, .hero-copy, .hero-visual, .why-card, .cap-card, .platform-card, .rm-item, .pricing-hero-tier, .matrix-wrap, .s-head',
  )
  targets.forEach((el) => el.classList.add('reveal'))

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            // small stagger when several elements come in together
            setTimeout(() => entry.target.classList.add('in'), Math.min(i * 60, 200))
            io.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )
    targets.forEach((el) => io.observe(el))
  } else {
    // fallback: show everything
    targets.forEach((el) => el.classList.add('in'))
  }

  // ---------- Smooth-scroll polyfill for in-page anchors ----------
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href')
      if (id && id.length > 1) {
        const el = document.querySelector(id)
        if (el) {
          e.preventDefault()
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    })
  })

  // ---------- Docs sidebar scroll-spy ----------
  ;(function docsScrollSpy() {
    const sidebarLinks = document.querySelectorAll('.docs-sidebar a')
    if (!sidebarLinks.length) return
    const headings = []
    sidebarLinks.forEach((a) => {
      const id = (a.getAttribute('href') || '').slice(1)
      const h = id && document.getElementById(id)
      if (h) headings.push({ link: a, el: h })
    })
    if (!headings.length) return

    let active = null
    const spy = () => {
      const fromTop = window.scrollY + 120
      let current = headings[0]
      for (const item of headings) {
        if (item.el.offsetTop <= fromTop) current = item
      }
      if (current !== active) {
        if (active) active.link.classList.remove('active')
        current.link.classList.add('active')
        active = current
      }
    }
    spy()
    window.addEventListener('scroll', spy, { passive: true })
  })()

  // ---------- OS detection ----------
  function detectOS() {
    const ua = navigator.userAgent || navigator.platform || ''
    if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'mac'
    if (/Win/.test(ua)) return 'win'
    if (/Linux/.test(ua)) return 'linux'
    return null
  }

  // ---------- Download page: highlight recommended platform ----------
  ;(function downloadRecommend() {
    const os = detectOS()
    if (!os) return
    const card = document.querySelector(`.platform-card[data-os="${os}"]`)
    if (!card) return
    card.classList.add('recommended')
    const badge = document.createElement('span')
    badge.className = 'rec-badge'
    badge.textContent = '推荐你的平台'
    card.appendChild(badge)
  })()

  // ---------- Download page: fetch latest release + render asset links ----------
  ;(function downloadReleases() {
    const container = document.getElementById('release-assets')
    const metaEl = document.getElementById('release-meta')
    if (!container) return // only on download page

    const platformExtMap = {
      mac: [/\.dmg$/i],
      win: [/\.exe$/i, /\.msi$/i],
      linux: [/\.AppImage$/i, /\.deb$/i],
    }

    fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const tag = (data && data.tag_name) || ''
        const published = (data && data.published_at) || ''
        const assets = (data && data.assets) || []

        if (metaEl && tag) {
          const date = published
            ? new Date(published).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : ''
          metaEl.querySelector('.release-tag').textContent = tag
          if (date) metaEl.querySelector('.release-date').textContent = date
          metaEl.hidden = false
        }

        // group assets by platform
        const byPlatform = { mac: [], win: [], linux: [] }
        assets.forEach((a) => {
          for (const [plat, regs] of Object.entries(platformExtMap)) {
            if (regs.some((re) => re.test(a.name))) {
              byPlatform[plat].push(a)
              break
            }
          }
        })

        Object.entries(byPlatform).forEach(([plat, list]) => {
          const card = document.querySelector(`.platform-card[data-os="${plat}"]`)
          if (!card) return
          const linksEl = card.querySelector('.platform-links')
          if (!linksEl) return
          // clear fallback link(s)
          linksEl.innerHTML = ''
          if (!list.length) {
            linksEl.innerHTML = `<a href="${RELEASES_PAGE}" target="_blank" rel="noopener"><span>前往 Release 页</span><span class="file-ext">→</span></a>`
            return
          }
          list.slice(0, 3).forEach((a) => {
            const sizeMb = a.size ? (a.size / 1024 / 1024).toFixed(1) + ' MB' : ''
            const ext = a.name.split('.').pop().toUpperCase()
            const a2 = document.createElement('a')
            a2.href = a.browser_download_url
            a2.target = '_blank'
            a2.rel = 'noopener'
            a2.innerHTML = `<span>${sizeMb ? `下载 ${ext}` : '下载'}</span><span class="file-ext">${ext}${sizeMb ? ' · ' + sizeMb : ''}</span>`
            linksEl.appendChild(a2)
          })
        })
      })
      .catch(() => {
        // keep static fallback links; ensure meta hidden
        if (metaEl) metaEl.hidden = true
      })
  })()

  // ---------- Hero/footer version tag: fetch latest from GitHub ----------
  const versionEls = [
    document.getElementById('brand-version'),
    document.getElementById('footer-version'),
  ].filter(Boolean)
  const dl = document.getElementById('hero-download')
  const dlLabel = document.getElementById('hero-download-label')

  // elements stay hidden by default; only reveal once we have a real tag
  fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      const tag = (data && data.tag_name) || ''
      if (!tag) return
      const display = tag.startsWith('v') ? tag : `v${tag}`
      versionEls.forEach((el) => {
        el.textContent = display
        el.hidden = false
        // restart the reveal animation
        el.classList.remove('is-loaded')
        // force reflow so the animation can replay
        void el.offsetWidth
        el.classList.add('is-loaded')
      })
      if (dlLabel) dlLabel.textContent = `下载 ${display}`
    })
    .catch(() => {
      // silently keep the version tag hidden; download button still works
    })
})()
