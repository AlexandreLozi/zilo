/*
 * Prototype harness (T05). Not production code.
 * - Injects the inline SVG icon sprite (no external assets).
 * - Builds the "Prototype controls" bar from window.PROTO.controls.
 * - Reads/writes state from the URL query (?state=…&theme=…), so the axe check can visit each state.
 * - Provides focus-trap, live-region and copy helpers that mirror the a11y spec.
 */
(function () {
  "use strict";

  /* ---------- Icons (24x24, stroke) ---------- */
  const ICONS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    "rotate-left": '<path d="M4 10a8 8 0 1 1 2.3 7.7"/><path d="M4 4v6h6"/>',
    "rotate-right": '<path d="M20 10a8 8 0 1 0-2.3 7.7"/><path d="M20 4v6h-6"/>',
    "arrow-left": '<path d="M15 6l-6 6 6 6"/>',
    "arrow-right": '<path d="M9 6l6 6-6 6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    scanner: '<path d="M3 14h18v5H3z"/><path d="M5 14l2-8h10l2 8"/><path d="M7 17h4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    "alert-triangle": '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
    "alert-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>',
    usb: '<path d="M12 3v14M9 6l3-3 3 3M8 11v2l4 3 4-3v-3"/><circle cx="12" cy="19" r="2"/>',
    network: '<path d="M4 9a12 12 0 0 1 16 0M7 12.5a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0"/><path d="M12 19.5v.01"/>',
    flask: '<path d="M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  };

  function injectSprite() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    svg.innerHTML = Object.entries(ICONS)
      .map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${d}</symbol>`)
      .join("");
    document.body.prepend(svg);
  }

  /** Icon markup. Icons are decorative; the control carries the accessible name. */
  function icon(name, extra) {
    return `<svg class="z-icon ${extra || ""}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  }

  /* ---------- URL state ---------- */
  function params() {
    return Object.fromEntries(new URLSearchParams(location.search));
  }
  function setParam(name, value) {
    const p = new URLSearchParams(location.search);
    p.set(name, value);
    history.replaceState(null, "", "?" + p.toString());
  }

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.querySelectorAll(".zilo").forEach((el) => el.setAttribute("data-zilo-theme", theme));
    document.documentElement.setAttribute("data-proto-theme", theme);
  }

  /* ---------- Controls bar ---------- */
  function buildBar(cfg) {
    const bar = document.createElement("header");
    bar.className = "proto-bar";
    const controls = [
      ...(cfg.controls || []),
      { name: "theme", label: "Theme", options: [["light", "Light"], ["dark", "Dark"], ["auto", "System"]] },
    ];
    bar.innerHTML = `
      <a class="proto-bar__home" href="index.html">Zilo prototypes</a>
      <h1 class="proto-bar__title">${cfg.title}</h1>
      <nav class="proto-bar__controls" aria-label="Prototype controls">
        ${controls.map((c) => `
          <label class="proto-bar__control">
            <span>${c.label}</span>
            <select data-param="${c.name}">
              ${c.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
            </select>
          </label>`).join("")}
      </nav>`;
    document.body.prepend(bar);
    const p = params();
    bar.querySelectorAll("select").forEach((sel) => {
      const name = sel.dataset.param;
      const ctl = controls.find((c) => c.name === name);
      sel.value = p[name] && ctl.options.some(([v]) => v === p[name]) ? p[name] : ctl.options[0][0];
      sel.addEventListener("change", () => {
        setParam(name, sel.value);
        render();
      });
    });
  }

  function render() {
    const p = params();
    const cfg = window.PROTO;
    const values = {};
    (cfg.controls || []).forEach((c) => {
      values[c.name] = p[c.name] && c.options.some(([v]) => v === p[c.name]) ? p[c.name] : c.options[0][0];
    });
    values.theme = ["light", "dark", "auto"].includes(p.theme) ? p.theme : "light";
    cfg.render(values);
    applyTheme(values.theme);
    if (cfg.autofocus !== false) focusInitial();
  }

  /* ---------- Focus management ---------- */
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

  function focusables(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el.getClientRects().length > 0
    );
  }

  /** Focus [data-autofocus] inside the topmost open dialog, else its first focusable. */
  function focusInitial() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(
      (d) => d.getClientRects().length > 0 && !d.closest("[hidden]")
    );
    const top = dialogs[dialogs.length - 1];
    if (!top) return;
    const target = top.querySelector("[data-autofocus]:not([disabled])") || focusables(top)[0] || top;
    if (target === top) top.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  /** Tab / Shift+Tab wrap inside the topmost dialog (mirrors the production focus trap). */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')]
      .filter((d) => d.getClientRects().length > 0);
    const top = dialogs[dialogs.length - 1];
    if (!top || !top.contains(document.activeElement)) return;
    const items = focusables(top);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- Live region ---------- */
  function announce(text, politeness) {
    const id = politeness === "assertive" ? "z-live-assertive" : "z-live-polite";
    const region = document.getElementById(id);
    if (!region) return;
    region.textContent = "";
    setTimeout(() => { region.textContent = text; }, 50);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.Z = { icon, announce, focusInitial, focusables, esc, params, setParam, rerender: render };

  document.addEventListener("DOMContentLoaded", () => {
    injectSprite();
    buildBar(window.PROTO);
    render();
  });
})();
