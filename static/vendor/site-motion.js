/* Everpure Research — site motion, built on Motion (motion.dev, vanilla build).
 *
 * Progressive enhancement: pages read fine without this file. The inline head snippet
 * (dashboard_theme.motionHead) adds `html.motion` before first paint only when the visitor
 * hasn't asked for reduced motion, which hides the reveal targets listed in window.__mSel
 * until they animate in; it also removes the class after 2.5s if this script never runs.
 *
 * Brand motion rules: custom easing with hard stops, motion only where it carries meaning
 * (things arriving, numbers counting to their value, bars growing to their size, interactive
 * elements answering the pointer), no ornamental loops.
 */
(function () {
  "use strict";
  var root = document.documentElement;
  var M = window.Motion;
  if (!M || !root.classList.contains("motion") || !window.__mSel) {
    root.classList.remove("motion");
    return;
  }
  window.__siteMotion = true;

  var SNAP = [0.08, 0.82, 0.18, 1];
  var LIFT = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 };
  var COUNT = ".stat-value, .stat-chip-value, .kpi-v";
  var NUMBER = /^([^\d–-]*?)(\d+(?:\.\d+)?)([^\d–-]*)$/;

  function countUp(node, delay) {
    if (node.children.length) return;
    var text = node.textContent.trim();
    var m = text.match(NUMBER);
    if (!m) return;
    var to = parseFloat(m[2]);
    var dec = (m[2].split(".")[1] || "").length;
    node.setAttribute("aria-label", text);
    node.textContent = m[1] + (0).toFixed(dec) + m[3];
    M.animate(0, to, {
      duration: 0.9,
      delay: delay,
      ease: SNAP,
      onUpdate: function (v) {
        node.textContent = m[1] + v.toFixed(dec) + m[3];
      },
      onComplete: function () {
        node.textContent = text;
      },
    });
  }

  function grow(el, delay) {
    el.querySelectorAll(".mc-fill, .ccol-bar").forEach(function (bar, i) {
      var vertical = bar.classList.contains("ccol-bar");
      bar.style.transformOrigin = vertical ? "50% 100%" : "0 50%";
      M.animate(bar, vertical ? { scaleY: [0, 1] } : { scaleX: [0, 1] }, {
        duration: 0.7,
        delay: delay + 0.12 + Math.min(i, 24) * 0.012,
        ease: SNAP,
      });
    });
    el.querySelectorAll("svg.spark polyline").forEach(function (line) {
      var len = line.getTotalLength ? line.getTotalLength() : 0;
      if (!len) return;
      line.style.strokeDasharray = String(len);
      M.animate(
        line,
        { strokeDashoffset: [len, 0] },
        { duration: 0.9, delay: delay + 0.2, ease: SNAP }
      );
    });
  }

  function arrive(el, delay) {
    M.animate(el, { opacity: [0, 1], y: [18, 0] }, { duration: 0.6, delay: delay, ease: SNAP });
    el.classList.add("m-in");
    if (el.matches(COUNT)) countUp(el, delay);
    el.querySelectorAll(COUNT).forEach(function (n) {
      countUp(n, delay + 0.08);
    });
    grow(el, delay);
  }

  // Elements entering together arrive as a stagger rather than all at once.
  var queue = [];
  var scheduled = false;
  function flush() {
    scheduled = false;
    queue.splice(0).forEach(function (el, i) {
      arrive(el, Math.min(i, 8) * 0.06);
    });
  }
  M.inView(
    window.__mSel,
    function (a) {
      var el = a && a.target ? a.target : a;
      if (el.classList.contains("m-in")) return;
      queue.push(el);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    },
    { amount: 0.12 }
  );

  // Interactive elements answer the pointer with a short spring; static content stays still.
  var INTERACTIVE = ".issue-hero, a.btn, .filechip, .cmp-link, .ms-toggle, .navlink, .themebtn";
  function lift(el, y) {
    M.animate(el, { y: y }, LIFT);
  }
  document.querySelectorAll(INTERACTIVE).forEach(function (el) {
    var rise = el.classList.contains("issue-hero") ? -4 : -2;
    el.addEventListener("pointerenter", function () {
      lift(el, rise);
    });
    el.addEventListener("pointerleave", function () {
      lift(el, 0);
      M.animate(el, { scale: 1 }, LIFT);
    });
    el.addEventListener("pointerdown", function () {
      M.animate(el, { scale: 0.97 }, LIFT);
    });
    el.addEventListener("pointerup", function () {
      M.animate(el, { scale: 1 }, LIFT);
    });
  });
})();
