/**
 * AireyAI Animation Toolkit
 * Drop-in premium motion for any website.
 *
 * Includes: scroll reveals, parallax, text splitting, magnetic buttons,
 * smooth counters, tilt cards, and page load sequences.
 *
 * Dependencies: GSAP + ScrollTrigger (loaded via CDN)
 * Usage: Add this script after GSAP in your HTML, then add data attributes.
 */

(function () {
  'use strict';

  // ─── Wait for GSAP ───────────────────────────────────────────────
  function init() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      return setTimeout(init, 50);
    }
    gsap.registerPlugin(ScrollTrigger);
    setupScrollReveals();
    setupParallax();
    setupTextSplit();
    setupMagneticButtons();
    setupCounters();
    setupTiltCards();
    setupSmoothAppear();
    setupStaggerGroups();
    setupHorizontalScroll();
  }

  // ─── 1. Scroll Reveals ──────────────────────────────────────────
  // Usage: <div data-reveal="fade-up | fade-down | fade-left | fade-right | zoom | flip">
  function setupScrollReveals() {
    const presets = {
      'fade-up':    { y: 60, opacity: 0 },
      'fade-down':  { y: -60, opacity: 0 },
      'fade-left':  { x: 80, opacity: 0 },
      'fade-right': { x: -80, opacity: 0 },
      'zoom':       { scale: 0.85, opacity: 0 },
      'flip':       { rotateX: 15, opacity: 0, transformPerspective: 800 },
    };

    document.querySelectorAll('[data-reveal]').forEach((el, i) => {
      const type = el.dataset.reveal || 'fade-up';
      const from = presets[type] || presets['fade-up'];
      const delay = parseFloat(el.dataset.revealDelay) || 0;

      gsap.from(el, {
        ...from,
        duration: 1,
        delay,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          toggleActions: 'play none none none',
        },
      });
    });
  }

  // ─── 2. Parallax ───────────────────────────────────────────────
  // Usage: <div data-parallax="-100"> (px offset on scroll)
  function setupParallax() {
    document.querySelectorAll('[data-parallax]').forEach(el => {
      const speed = parseFloat(el.dataset.parallax) || -80;
      gsap.to(el, {
        y: speed,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1,
        },
      });
    });
  }

  // ─── 3. Text Split Animations ──────────────────────────────────
  // Usage: <h1 data-split="chars | words | lines">
  function setupTextSplit() {
    document.querySelectorAll('[data-split]').forEach(el => {
      const mode = el.dataset.split || 'chars';
      const text = el.textContent;
      el.style.overflow = 'hidden';

      if (mode === 'chars') {
        el.innerHTML = text.split('').map(c =>
          c === ' ' ? ' ' : `<span style="display:inline-block">${c}</span>`
        ).join('');
        gsap.from(el.querySelectorAll('span'), {
          y: '110%',
          opacity: 0,
          duration: 0.6,
          ease: 'power4.out',
          stagger: 0.025,
          scrollTrigger: { trigger: el, start: 'top 85%' },
        });
      } else if (mode === 'words') {
        el.innerHTML = text.split(' ').map(w =>
          `<span style="display:inline-block; margin-right:0.25em">${w}</span>`
        ).join('');
        gsap.from(el.querySelectorAll('span'), {
          y: '100%',
          opacity: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.06,
          scrollTrigger: { trigger: el, start: 'top 85%' },
        });
      } else if (mode === 'lines') {
        gsap.from(el, {
          y: 40,
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%' },
        });
      }
    });
  }

  // ─── 4. Magnetic Buttons ───────────────────────────────────────
  // Usage: <button data-magnetic>
  function setupMagneticButtons() {
    document.querySelectorAll('[data-magnetic]').forEach(btn => {
      const strength = parseFloat(btn.dataset.magnetic) || 0.35;

      btn.addEventListener('mousemove', e => {
        const rect = btn.getBoundingClientRect();
        const x = (e.clientX - rect.left - rect.width / 2) * strength;
        const y = (e.clientY - rect.top - rect.height / 2) * strength;
        gsap.to(btn, { x, y, duration: 0.4, ease: 'power2.out' });
      });

      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      });
    });
  }

  // ─── 5. Smooth Counters ────────────────────────────────────────
  // Usage: <span data-counter="1500" data-counter-suffix="+">0</span>
  function setupCounters() {
    document.querySelectorAll('[data-counter]').forEach(el => {
      const target = parseFloat(el.dataset.counter);
      const suffix = el.dataset.counterSuffix || '';
      const prefix = el.dataset.counterPrefix || '';
      const decimals = (el.dataset.counterDecimals || '0') | 0;

      const obj = { val: 0 };
      gsap.to(obj, {
        val: target,
        duration: 2,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%' },
        onUpdate: () => {
          el.textContent = prefix + obj.val.toFixed(decimals) + suffix;
        },
      });
    });
  }

  // ─── 6. Tilt Cards ────────────────────────────────────────────
  // Usage: <div data-tilt>
  function setupTiltCards() {
    document.querySelectorAll('[data-tilt]').forEach(card => {
      const max = parseFloat(card.dataset.tiltMax) || 8;
      card.style.transformStyle = 'preserve-3d';
      card.style.willChange = 'transform';

      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / rect.width - 0.5;
        const yRatio = (e.clientY - rect.top) / rect.height - 0.5;
        gsap.to(card, {
          rotateY: xRatio * max,
          rotateX: -yRatio * max,
          duration: 0.5,
          ease: 'power2.out',
          transformPerspective: 800,
        });
      });

      card.addEventListener('mouseleave', () => {
        gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
      });
    });
  }

  // ─── 7. Page Load Sequence ─────────────────────────────────────
  // Usage: <div data-appear data-appear-delay="0.2">
  function setupSmoothAppear() {
    const els = document.querySelectorAll('[data-appear]');
    if (!els.length) return;

    const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.8 } });
    els.forEach(el => {
      const delay = parseFloat(el.dataset.appearDelay) || 0;
      tl.from(el, { y: 30, opacity: 0 }, delay);
    });
  }

  // ─── 8. Stagger Groups ────────────────────────────────────────
  // Usage: <div data-stagger-parent> <div data-stagger-child>...</div> </div>
  function setupStaggerGroups() {
    document.querySelectorAll('[data-stagger-parent]').forEach(parent => {
      const children = parent.querySelectorAll('[data-stagger-child]');
      if (!children.length) return;

      gsap.from(children, {
        y: 50,
        opacity: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: {
          trigger: parent,
          start: 'top 85%',
        },
      });
    });
  }

  // ─── 9. Horizontal Scroll Section ─────────────────────────────
  // Usage: <section data-horizontal-scroll> <div>panel1</div> <div>panel2</div> </section>
  function setupHorizontalScroll() {
    document.querySelectorAll('[data-horizontal-scroll]').forEach(section => {
      const panels = gsap.utils.toArray(section.children);
      if (panels.length < 2) return;

      gsap.to(panels, {
        xPercent: -100 * (panels.length - 1),
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          pin: true,
          scrub: 1,
          end: () => '+=' + section.scrollWidth,
        },
      });
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
