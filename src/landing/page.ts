/**
 * Server-rendered landing page. Single HTML string returned from `GET /`.
 * No SPA, no build step, no external image assets beyond Google Fonts.
 *
 * Design reference: era.app layout — sticky navbar, balanced hero with
 * primary "Add to Claude" pill, dimmed partners carousel, 15/6/3 dark
 * feature cards, and an accordion FAQ. Dark theme (#0e0f0c surface,
 * #f3f3f1 text) tinted with the shopdeals amber (#f26b3a).
 *
 * Live counts (deals / merchants / freshness) come from `loadLandingStats`
 * so the page always looks alive even with a small catalog.
 */

export interface LandingData {
  dealCount?: number;
  merchantCount?: number;
  lastIngestHoursAgo?: number;
}

export function landingHtml(data: LandingData = {}): string {
  const dealCount = formatThousands(data.dealCount);
  const merchantCount = formatThousands(data.merchantCount);
  const ingestStatus = formatIngestStatus(data.lastIngestHoursAgo);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>shopdeals — the MCP server for shopping</title>
<meta name="description" content="shopdeals is an MCP server that gives Claude, ChatGPT, and Cursor the ability to shop. It finds the best deal across trusted sellers, watches prices, and applies coupon codes that actually work." />
<meta property="og:title" content="shopdeals — the MCP server for shopping" />
<meta property="og:description" content="Make Claude find the best deal. An MCP server that compares sellers, watches prices, and applies working coupons." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g fill='none' stroke='%23f26b3a'><circle cx='42' cy='42' r='28' stroke-width='8'/><line x1='62' y1='62' x2='86' y2='86' stroke-width='9' stroke-linecap='round'/></g><path d='M42 24 L54 24 L54 58 L42 70 L30 58 L30 36 Z' fill='%23f26b3a'/><circle cx='42' cy='34' r='3' fill='%230e0f0c'/></svg>" />
<style>
  :root {
    --bg: #0e0f0c;
    --surface: #191a17;
    --surface-2: #1f201d;
    --text: #f3f3f1;
    --text-dim: rgba(243,243,241,0.6);
    --text-dimmer: rgba(243,243,241,0.4);
    --line: rgba(243,243,241,0.08);
    --line-strong: rgba(243,243,241,0.14);
    --brand: #f26b3a;
    --brand-2: #ff8757;
    --brand-soft: #ffd9c4;
    --claude: #d97757;
    --pink-card: linear-gradient(155deg, #ffd9c4 0%, #fff1e3 55%, #fff7ee 100%);
    --teal-card: #1f2b29;
    --radius: 12px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    overflow-x: hidden;
  }
  a { color: inherit; text-decoration: none; }
  ::selection { background: var(--brand); color: white; }

  .container { max-width: 1240px; margin: 0 auto; padding: 0 32px; position: relative; z-index: 1; }

  /* ---------- Global scroll-reveal ---------- */
  .reveal {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1);
    will-change: opacity, transform;
  }
  .reveal.in { opacity: 1; transform: none; }
  .reveal.d1 { transition-delay: 60ms; }
  .reveal.d2 { transition-delay: 120ms; }
  .reveal.d3 { transition-delay: 180ms; }
  .reveal.d4 { transition-delay: 240ms; }
  @media (prefers-reduced-motion: reduce) {
    .reveal, .reveal.in { opacity: 1; transform: none; transition: none; }
  }

  /* ---------- Ambient hero glow (static, no drift) ---------- */
  .hero-glow {
    position: absolute; inset: -120px -120px auto auto;
    width: 640px; height: 640px;
    background: radial-gradient(closest-side, rgba(242,107,58,0.16), rgba(242,107,58,0) 70%);
    pointer-events: none;
    z-index: 0;
  }

  /* ---------- Brand mark ---------- */
  .brand-mark { width: 28px; height: 28px; flex-shrink: 0; display: inline-grid; place-items: center; color: var(--brand); }
  .brand-mark.lg { width: 56px; height: 56px; }
  .brand-mark svg { width: 100%; height: 100%; }

  /* ---------- Navbar ---------- */
  .nav-wrap {
    position: sticky; top: 0; z-index: 50;
    background: rgba(14,15,12,0.62);
    backdrop-filter: saturate(140%) blur(14px);
    -webkit-backdrop-filter: saturate(140%) blur(14px);
    border-bottom: 1px solid transparent;
    transition: background .25s ease, border-color .25s ease, box-shadow .25s ease;
  }
  .nav-wrap.scrolled {
    background: rgba(14,15,12,0.88);
    border-bottom-color: var(--line);
    box-shadow: 0 10px 30px rgba(0,0,0,0.18);
  }
  nav.bar {
    display: flex; align-items: center; justify-content: space-between;
    height: 64px; gap: 24px;
  }
  .logo {
    display: inline-flex; align-items: center; gap: 10px;
    font-size: 17px; font-weight: 600; letter-spacing: -0.01em;
    color: var(--text);
  }
  .nav-right { display: flex; align-items: center; gap: 8px; }
  .nav-link {
    padding: 8px 14px; font-size: 14px; color: var(--text-dim);
    border-radius: 999px;
  }
  .nav-link:hover { color: var(--text); }
  .nav-cta {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px;
    background: var(--brand); color: white;
    font-size: 14px; font-weight: 600;
    border-radius: 999px;
    transition: background .14s ease;
  }
  .nav-cta:hover { background: var(--brand-2); }
  .nav-cta svg { width: 14px; height: 14px; }
  @media (max-width: 720px) {
    .nav-link.docs { display: none; }
  }

  /* ---------- Hero ---------- */
  .hero { padding: 96px 0 64px; position: relative; overflow: hidden; }
  .hero-grid {
    display: grid; grid-template-columns: 15fr 9fr; gap: 64px;
    align-items: center;
  }
  @media (max-width: 960px) { .hero-grid { grid-template-columns: 1fr; gap: 36px; } }

  h1.hero-title {
    font-weight: 600;
    font-size: clamp(40px, 5.6vw, 56px);
    line-height: 1.04;
    letter-spacing: -1.12px;
    margin: 0;
    color: var(--text);
    text-wrap: balance;
  }
  .hero-right { display: flex; flex-direction: column; gap: 24px; max-width: 440px; }
  .hero-sub {
    font-size: 20px;
    line-height: 1.45;
    color: var(--text-dim);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .hero-ctas { display: flex; flex-wrap: wrap; gap: 10px; }
  .btn {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 12px 22px;
    font-family: inherit; font-size: 15px; font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: transform .14s ease, background .14s ease, border-color .14s ease;
    text-decoration: none;
  }
  .btn-primary {
    background: var(--brand); color: white;
  }
  .btn-primary:hover { background: var(--brand-2); }
  .btn-primary .leaf { color: var(--claude); }
  .btn-secondary {
    background: rgba(243,243,241,0.06); color: var(--text);
    border-color: rgba(243,243,241,0.10);
  }
  .btn-secondary:hover { background: rgba(243,243,241,0.10); border-color: rgba(243,243,241,0.18); }
  .btn svg { width: 16px; height: 16px; }

  .hero-meta {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text-dimmer);
  }
  .hero-meta .tri {
    width: 0; height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid var(--text-dimmer);
  }
  .hero-foot { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .ghost-link {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--text-dim);
    transition: color .14s ease;
  }
  .ghost-link svg { width: 14px; height: 14px; }
  .ghost-link:hover { color: var(--text); }

  /* ---------- MCP URL row (replaces the giant CTAs) ---------- */
  .url-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px 12px 16px;
    cursor: pointer;
    transition: border-color .14s ease, background .14s ease;
  }
  .url-row:hover { border-color: var(--line-strong); background: var(--surface-2); }
  .url-row .url-label {
    font-size: 11px; font-weight: 600;
    color: var(--text-dimmer); letter-spacing: 0.08em;
    text-transform: uppercase;
    padding-right: 10px;
    border-right: 1px solid var(--line);
  }
  .url-row .url-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .url-row .url-copy {
    display: inline-flex; align-items: center; gap: 6px;
    background: transparent;
    color: var(--text-dim);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 10px;
    font-family: inherit; font-size: 13px; font-weight: 500;
    cursor: pointer;
    transition: color .14s ease, border-color .14s ease, background .14s ease;
  }
  .url-row .url-copy:hover { color: var(--text); border-color: var(--line-strong); background: var(--surface); }
  .url-row .url-copy svg { width: 13px; height: 13px; }
  .url-row.copied { border-color: rgba(43,189,126,0.5); }
  .url-row.copied .url-copy { color: #2bbd7e; border-color: rgba(43,189,126,0.5); }

  /* ---------- Search demo (mock agent conversation) ---------- */
  .demo { padding: 56px 0 64px; }
  .demo-eyebrow {
    text-align: center;
    color: var(--text-dimmer);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0 auto 22px;
  }
  .demo-window {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 30px 80px -20px rgba(0,0,0,0.55);
    overflow: hidden;
    max-width: 880px;
    margin: 0 auto;
  }
  .demo-chrome {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    font-size: 12px; color: var(--text-dim);
  }
  .demo-chrome .dots { display: inline-flex; gap: 6px; }
  .demo-chrome .dots span {
    width: 11px; height: 11px; border-radius: 50%;
    background: rgba(243,243,241,0.14);
  }
  .demo-chrome .title {
    flex: 1; text-align: center;
    font-weight: 500; color: var(--text); font-size: 13px;
  }
  .demo-chrome .title .pill {
    font-size: 10.5px; font-weight: 600;
    color: var(--text-dim);
    background: rgba(243,243,241,0.05);
    border: 1px solid var(--line);
    padding: 2px 7px; border-radius: 999px;
    margin-left: 8px;
    letter-spacing: 0.02em;
  }
  .demo-chrome .model {
    color: var(--text-dimmer);
    font-size: 11.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .demo-body {
    padding: 24px 28px 28px;
    display: flex; flex-direction: column; gap: 22px;
    background:
      radial-gradient(800px 200px at 50% -40px, rgba(217,119,87,0.06), transparent 60%),
      var(--surface);
  }
  @media (max-width: 720px) { .demo-body { padding: 18px 16px; } }

  .msg { display: flex; gap: 14px; align-items: flex-start; }
  .msg .avatar {
    width: 30px; height: 30px; border-radius: 50%;
    flex-shrink: 0;
    display: inline-grid; place-items: center;
    font-size: 12.5px; font-weight: 600;
    letter-spacing: 0.02em;
    margin-top: 1px;
  }
  .msg.user .avatar {
    background: linear-gradient(135deg, #565970 0%, #3a3c4f 100%);
    color: white;
  }
  .msg.assistant .avatar {
    background: linear-gradient(135deg, #d97757 0%, #b65d40 100%);
    color: white;
  }
  .msg.assistant .avatar svg { width: 14px; height: 14px; fill: currentColor; }
  .msg .col { flex: 1; min-width: 0; }
  .msg .who {
    font-size: 13px; font-weight: 600; color: var(--text);
    margin-bottom: 6px;
    display: flex; align-items: center; gap: 10px;
  }
  .msg .who .tag {
    font-size: 11px; font-weight: 500;
    color: var(--text-dimmer);
  }
  .msg .text {
    font-size: 15px; line-height: 1.6; color: var(--text);
    letter-spacing: -0.005em;
  }
  .msg .text + .text { margin-top: 8px; }
  .msg .text strong { font-weight: 600; color: var(--text); }
  .msg .text a { color: var(--brand); text-decoration: none; border-bottom: 1px solid rgba(242,107,58,0.4); }
  .msg .text a:hover { border-bottom-color: var(--brand); }
  .msg.user .text { color: rgba(243,243,241,0.92); }
  .msg .text .inline-code {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 1px 6px; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    color: var(--text);
  }
  .msg .meta-line {
    font-size: 12.5px; color: var(--text-dim);
    margin: 8px 0;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .msg .meta-line .spinner {
    width: 11px; height: 11px;
    border: 1.5px solid var(--text-dimmer);
    border-top-color: var(--text);
    border-radius: 50%;
    animation: spin .8s linear infinite;
    display: inline-block;
  }
  .msg .meta-line .check { color: #2bbd7e; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .msg .meta-line .spinner { animation: none; } }

  /* Tool-call block — collapsible */
  .tool-call {
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    margin-top: 8px;
  }
  .tool-call .tc-head {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px;
    background: rgba(243,243,241,0.02);
    border-bottom: 1px solid var(--line);
    color: var(--text-dim);
    font-size: 12px;
  }
  .tool-call .tc-head .chev {
    width: 12px; height: 12px;
    color: var(--text-dimmer);
  }
  .tool-call .tc-head .name { color: var(--text); font-weight: 600; }
  .tool-call .tc-head .arrow-svg { width: 10px; height: 10px; color: var(--text-dimmer); }
  .tool-call .tc-head .upstream { color: var(--text-dimmer); }
  .tool-call .tc-head .ms { margin-left: auto; color: var(--text-dimmer); font-size: 11.5px; }
  .tool-call .tc-body { padding: 12px 14px; color: var(--text-dim); line-height: 1.55; }
  .tool-call .tc-body .k { color: rgba(243,243,241,0.55); }
  .tool-call .tc-body .s { color: #9ecbff; }
  .tool-call .tc-body .n { color: #ffb86b; }
  .tool-call .tc-body .b { color: #c0a3ff; }

  /* Tool-result table */
  .deal-table {
    width: 100%;
    border-collapse: separate; border-spacing: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    margin-top: 8px;
  }
  .deal-table thead th {
    text-align: left;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dimmer);
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    font-weight: 600;
  }
  .deal-table tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    color: var(--text-dim);
    font-size: 13px;
  }
  .deal-table tbody tr.best td { color: var(--text); background: rgba(242,107,58,0.06); }
  .deal-table tbody tr.best td:first-child {
    color: var(--brand);
    font-weight: 600;
    border-left: 2px solid var(--brand);
    padding-left: 10px;
  }
  .deal-table .star { color: var(--brand); margin-right: 4px; }
  .deal-table .strike { color: var(--text-dimmer); text-decoration: line-through; margin-right: 4px; font-size: 11.5px; }
  .deal-table .save { color: #2bbd7e; font-weight: 600; }

  /* Typing dots (kept subtle, ~1.4s loop) */
  .typing { display: inline-flex; gap: 4px; padding: 8px 0; }
  .typing span {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-dimmer);
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.18s; }
  .typing span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes typing {
    0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-2px); }
  }
  @media (prefers-reduced-motion: reduce) { .typing span { animation: none; opacity: 0.7; } }

  /* ---------- Partners carousel ---------- */
  .partners {
    padding: 56px 0 64px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    overflow: hidden;
  }
  .partners-eyebrow {
    text-align: center;
    color: var(--text-dimmer);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0 0 28px;
  }
  .marquee {
    display: flex; gap: 64px;
    width: max-content;
    animation: marquee 36s linear infinite;
  }
  .marquee:hover { animation-play-state: paused; }
  .marquee-track-outer { overflow: hidden; mask-image: linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%); -webkit-mask-image: linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%); }
  .marquee .logo-item {
    display: inline-flex; align-items: center; gap: 10px;
    color: rgba(243,243,241,0.45);
    font-size: 15px; font-weight: 500;
    letter-spacing: -0.005em;
    white-space: nowrap;
    transition: color .2s ease;
  }
  .marquee .logo-item:hover { color: rgba(243,243,241,0.85); }
  .marquee .logo-glyph {
    display: inline-grid; place-items: center;
    width: 22px; height: 22px;
  }
  .marquee .logo-glyph svg { width: 100%; height: 100%; fill: currentColor; }
  @keyframes marquee {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

  /* ---------- Feature cards ---------- */
  .features { padding: 96px 0 64px; }
  .features-header { margin-bottom: 44px; max-width: 720px; }
  .features-eyebrow {
    color: var(--brand);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 14px;
  }
  .features-title {
    font-size: clamp(32px, 4vw, 44px);
    font-weight: 600;
    letter-spacing: -0.88px;
    line-height: 1.08;
    margin: 0;
    text-wrap: balance;
  }
  .features-grid {
    display: grid;
    grid-template-columns: 15fr 6fr 6fr;
    gap: 14px;
    align-items: stretch;
    transition: grid-template-columns .5s cubic-bezier(.2,.7,.2,1);
  }
  /* Re-weight the grid when a non-default card is the active one. */
  .features-grid[data-active="watch"] { grid-template-columns: 6fr 15fr 6fr; }
  .features-grid[data-active="codes"] { grid-template-columns: 6fr 6fr 15fr; }
  @media (max-width: 1080px) { .features-grid { grid-template-columns: 1fr; } }

  .fcard {
    border-radius: var(--radius);
    padding: 24px;
    display: flex; flex-direction: column;
    min-height: 440px;
    position: relative;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    transition: background .4s ease, color .4s ease, border-color .2s ease;
  }
  .fcard:hover { border-color: var(--line-strong); }
  .fcard:not(.expanded) { cursor: pointer; user-select: none; }
  .fcard:focus-visible { outline: 2px solid var(--brand); outline-offset: 4px; }
  .fcard:focus { outline: none; }
  .fcard.expanded { padding: 32px; }
  .fcard.expanded.theme-pink { background: var(--pink-card); color: #1a120c; border-color: transparent; }
  .fcard.expanded.theme-pink .fc-pill { background: rgba(26,18,12,0.08); color: #1a120c; }
  .fcard.expanded.theme-pink .fc-eyebrow { color: rgba(26,18,12,0.55); }
  .fcard.expanded.theme-pink .fc-body { color: rgba(26,18,12,0.72); }
  .fcard.expanded.theme-pink .fc-cta { color: #1a120c; }
  .fcard.expanded.theme-pink .fc-cta:hover { background: rgba(26,18,12,0.08); }
  .fcard.expanded.theme-pink .fc-icon { background: rgba(26,18,12,0.08); }
  .fcard.expanded.theme-dark { background: var(--surface-2); }
  .fcard.expanded.theme-teal { background: var(--teal-card); border-color: transparent; }
  .fcard.expanded.theme-teal .fc-body { color: rgba(243,243,241,0.75); }

  /* Collapsed: hide body + cta, render compact */
  .fcard:not(.expanded) .fc-body,
  .fcard:not(.expanded) .fc-cta {
    display: none;
  }
  .fcard:not(.expanded) .fc-title { font-size: 22px; }
  .fcard:not(.expanded) .fc-eyebrow { margin-bottom: 6px; }
  @media (max-width: 1080px) {
    .fcard:not(.expanded) .fc-body { display: block; }
    .fcard:not(.expanded) .fc-cta { display: inline-flex; }
  }

  .fc-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
  .fc-icon {
    width: 44px; height: 44px; border-radius: 10px;
    display: inline-grid; place-items: center;
    background: rgba(26,18,12,0.08);
  }
  .fcard.dark .fc-icon, .fcard.teal .fc-icon { background: rgba(243,243,241,0.08); }
  .fc-icon svg { width: 22px; height: 22px; }
  .fc-pill {
    display: inline-flex; align-items: center;
    padding: 6px 12px; border-radius: 999px;
    font-size: 11.5px; font-weight: 600;
    letter-spacing: 0.02em;
  }
  .fc-eyebrow {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 10px;
    color: var(--text-dim);
  }
  .fc-title {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.5px;
    line-height: 1.12;
    margin: 0 0 14px;
    text-wrap: balance;
  }
  .fc-body { font-size: 15px; line-height: 1.55; margin: 0 0 14px; }
  .fc-body + .fc-body { margin-top: 0; }
  .fc-spacer { flex: 1; }
  .fc-cta {
    align-self: flex-start;
    margin-top: 24px;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 14px; font-weight: 600;
    transition: background .14s ease;
  }
  .fc-cta:hover { background: rgba(243,243,241,0.08); }
  .fc-cta svg { width: 14px; height: 14px; }


  /* ---------- Install ---------- */
  .install-band {
    padding: 80px 0 64px;
    border-top: 1px solid var(--line);
  }
  .install-band h2 {
    font-size: clamp(28px, 3.4vw, 36px);
    font-weight: 600;
    letter-spacing: -0.7px;
    margin: 0 0 12px;
    text-wrap: balance;
  }
  .install-band p.lede { color: var(--text-dim); font-size: 16px; margin: 0 0 32px; max-width: 600px; }
  .install-band .install-foot {
    color: var(--text-dim); font-size: 13.5px;
    margin: 22px 0 0; max-width: 600px;
  }
  .install-band .install-foot code {
    background: var(--surface); border: 1px solid var(--line);
    padding: 1px 7px; border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px; color: var(--text);
  }
  .install-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  @media (max-width: 880px) { .install-grid { grid-template-columns: 1fr; } }
  button.install-card {
    text-align: left;
    font-family: inherit;
    font-size: inherit;
    width: 100%;
  }
  .install-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 18px 20px;
    display: flex; align-items: center; gap: 14px;
    cursor: pointer;
    position: relative;
    transition: border-color .15s ease, background .15s ease;
    color: inherit;
    text-decoration: none;
  }
  .install-card:hover { border-color: var(--line-strong); background: var(--surface-2); }
  .install-card .arrow { transition: transform .15s ease; color: var(--text-dimmer); }
  .install-card:hover .arrow { transform: translateX(2px); color: var(--text-dim); }
  .install-card.copied { border-color: rgba(43,189,126,0.6); }
  .install-card .ico {
    width: 36px; height: 36px;
    border-radius: 8px;
    background: rgba(243,243,241,0.04);
    border: 1px solid var(--line);
    display: inline-grid; place-items: center;
    flex-shrink: 0;
    color: var(--text);
  }
  .install-card .ico svg { width: 20px; height: 20px; }
  .install-card .text { flex: 1; min-width: 0; }
  .install-card .label { font-size: 15px; font-weight: 600; color: var(--text); display: block; }
  .install-card .sub { font-size: 12.5px; color: var(--text-dim); display: block; margin-top: 3px; }
  .install-card .badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
    color: var(--brand);
    background: rgba(242,107,58,0.10);
    border: 1px solid rgba(242,107,58,0.22);
    padding: 2px 6px; border-radius: 999px;
    margin-left: 8px;
    vertical-align: 2px;
    text-transform: uppercase;
  }

  /* Snippet modal */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: none;
    align-items: center; justify-content: center;
    z-index: 200;
    padding: 24px;
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    max-width: 560px; width: 100%;
    overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,0.5);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }
  .modal .m-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
  }
  .modal .m-head .m-title {
    display: flex; align-items: center; gap: 10px;
    font-size: 14px; font-weight: 600; color: var(--text);
  }
  .modal .m-head .m-title .ico {
    width: 24px; height: 24px; border-radius: 6px;
    background: rgba(243,243,241,0.04);
    border: 1px solid var(--line);
    display: inline-grid; place-items: center;
  }
  .modal .m-head .m-title .ico svg { width: 14px; height: 14px; }
  .modal .m-close {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 22px; line-height: 1;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 6px;
  }
  .modal .m-close:hover { background: rgba(243,243,241,0.06); color: var(--text); }
  .modal .m-body { padding: 18px; }
  .modal .m-step { font-size: 13px; color: var(--text-dim); margin: 0 0 8px; }
  .modal .m-step strong { color: var(--text); font-weight: 600; }
  .modal ol.m-list {
    margin: 0 0 16px; padding-left: 20px;
    color: var(--text-dim); font-size: 13.5px; line-height: 1.7;
  }
  .modal ol.m-list strong { color: var(--text); font-weight: 600; }
  .modal ol.m-list code {
    background: var(--bg); border: 1px solid var(--line);
    padding: 1px 6px; border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    color: var(--text);
  }
  .modal pre {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 16px;
    margin: 6px 0 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    color: var(--text);
    overflow-x: auto;
    line-height: 1.55;
  }
  .modal .m-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .modal .m-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--brand); color: white;
    border: none;
    border-radius: 8px;
    padding: 9px 14px;
    font-size: 13px; font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
    transition: background .14s ease;
  }
  .modal .m-btn:hover { background: var(--brand-2); }
  .modal .m-btn svg { width: 13px; height: 13px; }
  .modal .m-btn.secondary {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--line);
  }
  .modal .m-btn.secondary:hover { background: var(--surface-2); border-color: var(--line-strong); }
  .modal .m-btn.secondary.copied { color: #2bbd7e; border-color: rgba(43,189,126,0.5); }

  /* ---------- FAQ ---------- */
  .faq { padding: 96px 0 64px; }
  .faq-head { display: grid; grid-template-columns: 1fr 2fr; gap: 64px; margin-bottom: 48px; align-items: end; }
  @media (max-width: 880px) { .faq-head { grid-template-columns: 1fr; gap: 16px; } }
  .faq-eyebrow {
    color: var(--brand);
    font-size: 13px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase;
    margin: 0 0 12px;
  }
  .faq h2 {
    font-size: clamp(32px, 4vw, 44px);
    font-weight: 600;
    letter-spacing: -0.88px;
    line-height: 1.08;
    margin: 0;
    text-wrap: balance;
  }
  .faq-list { border-top: 1px solid var(--line); }
  details.faq-item {
    border-bottom: 1px solid var(--line);
    padding: 22px 0;
  }
  details.faq-item summary {
    list-style: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.2px;
    color: var(--text);
  }
  details.faq-item summary::-webkit-details-marker { display: none; }
  details.faq-item .sign {
    width: 24px; height: 24px;
    display: inline-grid; place-items: center;
    color: var(--text-dim);
    transition: transform .2s ease;
    flex-shrink: 0;
  }
  details.faq-item[open] .sign { transform: rotate(45deg); color: var(--text); }
  details.faq-item .answer {
    margin-top: 14px;
    color: var(--text-dim);
    font-size: 15.5px;
    line-height: 1.6;
    max-width: 760px;
  }
  details.faq-item .answer p { margin: 0 0 12px; }
  details.faq-item .answer p:last-child { margin-bottom: 0; }
  details.faq-item .answer code {
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 1px 6px; border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--text);
  }
  details.faq-item .answer pre {
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 14px 16px; border-radius: 10px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--text);
    margin: 12px 0 0;
  }

  /* ---------- Footer ---------- */
  footer {
    padding: 56px 0 48px;
    border-top: 1px solid var(--line);
    color: var(--text-dim);
    font-size: 13px;
  }
  footer .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
  footer .col-brand { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
  footer .col-brand .logo { color: var(--text); }
  footer .col-brand .tag { color: var(--text-dim); font-size: 13px; }
  footer .col-brand .live-pill {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text-dim);
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    width: fit-content;
  }
  footer .col-brand .live-pill .dot {
    width: 6px; height: 6px; border-radius: 50%; background: #2bbd7e;
  }
  footer .links { display: flex; gap: 22px; flex-wrap: wrap; }
  footer .links a { color: var(--text-dim); }
  footer .links a:hover { color: var(--text); }
  footer .disclosure {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
    font-size: 12px; color: var(--text-dimmer);
    line-height: 1.6; max-width: 880px;
  }
  footer .disclosure strong { color: var(--text-dim); }

  /* ---------- Toast for copied snippets ---------- */
  .toast {
    position: fixed; bottom: 32px; left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    color: var(--text);
    padding: 12px 20px;
    border-radius: 999px;
    font-size: 14px; font-weight: 500;
    opacity: 0; pointer-events: none;
    transition: opacity .2s ease, transform .2s ease;
    z-index: 100;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

</style>
</head>
<body>

<!-- Reusable brand-mark SVG (price tag inside magnifying glass).
     Uses currentColor so it tints with whatever color the parent sets. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="sd-mark" viewBox="0 0 100 100">
      <circle cx="42" cy="42" r="28" fill="none" stroke="currentColor" stroke-width="8"/>
      <line x1="62" y1="62" x2="86" y2="86" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
      <path d="M42 24 L54 24 L54 58 L42 70 L30 58 L30 36 Z" fill="currentColor"/>
      <circle cx="42" cy="34" r="3" fill="#0e0f0c"/>
    </symbol>
  </defs>
</svg>

<div class="nav-wrap">
  <div class="container">
    <nav class="bar">
      <a class="logo" href="/">
        <span class="brand-mark"><svg><use href="#sd-mark"/></svg></span>
        shopdeals
      </a>
      <div class="nav-right">
        <a class="nav-link" href="#features">Tools</a>
        <a class="nav-link docs" href="#faq">Docs</a>
        <a class="nav-link" href="https://github.com/idanmann10/shopdeals" target="_blank" rel="noopener">GitHub</a>
        <a class="nav-cta" href="#install">Get the URL</a>
      </div>
    </nav>
  </div>
</div>

<section class="hero">
  <div class="hero-glow" aria-hidden="true"></div>
  <div class="container">
    <div class="hero-grid">
      <div>
        <h1 class="hero-title reveal in">Make Claude find the best deal.</h1>
      </div>
      <div class="hero-right reveal d1 in">
        <p class="hero-sub">An MCP server that gives your AI the ability to shop — compare sellers, watch prices, and apply coupons that actually work.</p>
        <div class="url-row" id="url-row" title="Click to copy">
          <span class="url-label">MCP server</span>
          <code class="url-value">https://mcp.shopdeals.sh/mcp</code>
          <button class="url-copy" type="button" aria-label="Copy MCP server URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span class="url-copy-label">Copy</span>
          </button>
        </div>
        <div class="hero-foot">
          <span class="hero-meta">
            <span class="tri"></span>
            Compatible with any MCP client · 60 calls/min · no API key
          </span>
          <a class="ghost-link" href="https://github.com/idanmann10/shopdeals" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.17-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.17 1.82 1.17 3.07 0 4.4-2.69 5.36-5.25 5.65.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="demo" id="search-demo">
  <div class="container">
    <p class="demo-eyebrow reveal">A real example</p>
    <div class="demo-window reveal">
      <div class="demo-chrome">
        <span class="dots"><span></span><span></span><span></span></span>
        <span class="title">Claude<span class="pill">shopdeals MCP</span></span>
        <span class="model">claude-opus-4.7</span>
      </div>
      <div class="demo-body">

        <div class="msg user">
          <span class="avatar">IM</span>
          <div class="col">
            <div class="who">You</div>
            <div class="text">Find me the best deal on Sony WH-1000XM5 headphones. Stay under $300 if you can, and double-check that any coupon you find actually works at checkout.</div>
          </div>
        </div>

        <div class="msg assistant">
          <span class="avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/></svg></span>
          <div class="col">
            <div class="who">Claude</div>
            <div class="text">I'll compare live sellers, then verify the best coupon for the winner.</div>

            <div class="tool-call">
              <div class="tc-head">
                <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
                <span class="name">find_best_deal</span>
                <svg class="arrow-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                <span class="upstream">shopdeals · MCP</span>
                <span class="ms">412 ms</span>
              </div>
              <div class="tc-body">
                <div>{</div>
                <div style="padding-left: 16px;"><span class="k">query</span>: <span class="s">"Sony WH-1000XM5"</span>,</div>
                <div style="padding-left: 16px;"><span class="k">alternatives</span>: <span class="n">3</span></div>
                <div>}</div>
              </div>
            </div>

            <div class="meta-line"><span class="check">✓</span> 3 sellers · 49 trusted merchants checked · prices verified 4 min ago</div>

            <table class="deal-table" role="table">
              <thead>
                <tr><th>Seller</th><th>Price</th><th>Total</th><th>Code</th></tr>
              </thead>
              <tbody>
                <tr><td>Best Buy</td><td>$349.99</td><td>$349.99</td><td>—</td></tr>
                <tr class="best">
                  <td><span class="star">★</span>Amazon</td>
                  <td><span class="strike">$399</span>$323.00</td>
                  <td>$298.00</td>
                  <td><span class="save">SAVE25</span></td>
                </tr>
                <tr><td>Target</td><td>$329.99</td><td>$349.98</td><td>—</td></tr>
              </tbody>
            </table>

            <div class="text" style="margin-top: 16px;">Amazon looks best. Let me double-check the SAVE25 coupon before I recommend it.</div>

            <div class="tool-call">
              <div class="tc-head">
                <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
                <span class="name">get_code_for_url</span>
                <svg class="arrow-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                <span class="upstream">shopdeals · MCP</span>
                <span class="ms">128 ms</span>
              </div>
              <div class="tc-body">
                <div>{</div>
                <div style="padding-left: 16px;"><span class="k">url</span>: <span class="s">"https://www.amazon.com/dp/B09XS7JWHH"</span>,</div>
                <div style="padding-left: 16px;"><span class="k">limit</span>: <span class="n">3</span></div>
                <div>}</div>
              </div>
            </div>

            <div class="meta-line"><span class="check">✓</span> SAVE25 — 92% success rate over 421 agent reports in the last 30 days</div>

            <div class="text" style="margin-top: 16px;">
              The best deal is <strong>Amazon at $298.00</strong> after the <span class="inline-code">SAVE25</span> code — $51 below Best Buy and comfortably under your $300 cap. The coupon is verified working at checkout (92% success rate, agents have run it 421 times in the last month). Ships free with Prime.
            </div>
            <div class="text" style="margin-top: 12px;">
              <a href="#install">Open the buy link →</a>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</section>

<section class="partners">
  <div class="container">
    <p class="partners-eyebrow">Works with the agents you already use</p>
  </div>
  <div class="marquee-track-outer">
    <div class="marquee" id="marquee">
      ${partnersRow()}
      ${partnersRow()}
    </div>
  </div>
</section>

<section class="features" id="features">
  <div class="container">
    <div class="features-header reveal">
      <p class="features-eyebrow">Built for AI agents</p>
      <h2 class="features-title">Ten MCP tools that turn any chat into a shopping copilot.</h2>
    </div>
    <div class="features-grid reveal" data-active="best">

      <article class="fcard expanded theme-pink" data-key="best">
        <div class="fc-top">
          <span class="fc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </span>
          <span class="fc-pill">find_best_deal</span>
        </div>
        <p class="fc-eyebrow">MCP tool</p>
        <h3 class="fc-title">Always the lowest price.</h3>
        <p class="fc-body">Across Amazon, Best Buy, Walmart, Target and more. The agent compares total cost (price + shipping + tax) and returns the cheapest with a direct affiliate link.</p>
        <p class="fc-body">Live across ${merchantCount} merchants and ${dealCount} deals — updated continuously so the answer is fresh by the time the model answers.</p>
        <div class="fc-spacer"></div>
        <a class="fc-cta" href="#search-demo">
          See it in action
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
      </article>

      <article class="fcard theme-dark" data-key="watch">
        <div class="fc-top">
          <span class="fc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 3v18h18"/>
              <path d="M7 14l4-4 4 4 5-5"/>
            </svg>
          </span>
          <span class="fc-pill">Realtime</span>
        </div>
        <p class="fc-eyebrow">watch_price</p>
        <h3 class="fc-title">Never miss a drop.</h3>
        <p class="fc-body">Set a target price on anything. We'll email you when it hits, with the buy link ready to go.</p>
        <p class="fc-body">Price history backs every watch — the agent can show you how the deal compares to the last 90 days.</p>
        <div class="fc-spacer"></div>
        <a class="fc-cta" href="#install">
          Add to your client
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
      </article>

      <article class="fcard theme-teal" data-key="codes">
        <div class="fc-top">
          <span class="fc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4z"/>
              <path d="M9 9h.01M15 15h.01M14 10l-4 4"/>
            </svg>
          </span>
          <span class="fc-pill">362K codes</span>
        </div>
        <p class="fc-eyebrow">get_code_for_url</p>
        <h3 class="fc-title">Every code that actually works.</h3>
        <p class="fc-body">Built on 362K coupons across 82 affiliate networks. The agent picks the best stacking code for any cart.</p>
        <p class="fc-body">Telemetry from every agent run kills dead codes automatically — so the next request gets a working one.</p>
        <div class="fc-spacer"></div>
        <a class="fc-cta" href="#install">
          Add to your client
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
      </article>

    </div>
  </div>
</section>

<section class="install-band" id="install">
  <div class="container">
    <h2 class="reveal">Add it to your AI workspace.</h2>
    <p class="lede reveal d1">Free, open, rate-limited at 60 calls/minute. Pick your client and you're set up in under 30 seconds.</p>
    <div class="install-grid reveal d2">
      <button class="install-card" type="button" data-client="cursor">
        <span class="ico">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.925.0461c-.123-.0288-.249-.0594-.4116.0337L1.0962 6.0683c-.0846.0488-.1547.119-.2034.2036-.0488.0846-.0744.1804-.0746.278v11.9075c.0002.0976.0258.1935.0746.2781.0487.0846.1188.1547.2034.2036L11.521 23.918l.0006.0003c.045.025.083.0455.1257.0589.0419.0131.0867.0193.1335.0228h.0011a1.06 1.06 0 0 0 .1334-.0228c.0427-.0134.0808-.0339.1257-.0589l.0006-.0003 10.4248-6.0349c.0847-.0488.155-.1188.2038-.2034.0489-.0846.0746-.1804.0749-.2781V6.3504c-.0003-.0977-.026-.1936-.0749-.2782s-.1191-.1546-.2038-.2034L12.3372.0798a.522.522 0 0 0-.4122-.0337zM12.0163.7917l9.7905 5.6669-9.7905 5.6669L2.2257 6.4586l9.7906-5.6669zM1.7757 7.4083l9.7906 5.6669v11.3338L1.7757 18.7421V7.4083zm20.4467 0v11.3338l-9.7905 5.6669V13.0752l9.7905-5.6669z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Cursor<span class="badge">1-click</span></span>
          <span class="sub">Opens Cursor and installs automatically</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
      </button>
      <button class="install-card" type="button" data-client="claude">
        <span class="ico">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Claude</span>
          <span class="sub">Copy snippet for Claude Desktop config</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <button class="install-card" type="button" data-client="chatgpt">
        <span class="ico">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387 2.014-1.158a.076.076 0 0 1 .071 0l4.83 2.787a4.49 4.49 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to ChatGPT</span>
          <span class="sub">Custom connector URL · Plus / Pro</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <p class="install-foot reveal d3">
      Other MCP-compatible clients (Cline, Continue, Zed, VS Code): point them at <code>https://mcp.shopdeals.sh/mcp</code>.
    </p>
  </div>
</section>

<!-- Snippet / install modal — populated by the install-card click handler -->
<div class="modal-backdrop" id="install-modal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" role="document">
    <div class="m-head">
      <div class="m-title">
        <span class="ico" id="m-ico"></span>
        <span id="m-title-text">Install</span>
      </div>
      <button class="m-close" type="button" aria-label="Close" id="m-close">&times;</button>
    </div>
    <div class="m-body" id="m-body"></div>
  </div>
</div>

<section class="faq" id="faq">
  <div class="container">
    <div class="faq-head reveal">
      <div>
        <p class="faq-eyebrow">FAQ</p>
        <h2>Frequently asked.</h2>
      </div>
      <div></div>
    </div>
    <div class="faq-list reveal d1">
      ${faqItem('What is shopdeals?', `
        <p>shopdeals is an MCP server — a small backend that plugs into AI assistants like Claude, ChatGPT, and Cursor and gives them ten new tools for shopping. With shopdeals connected, your agent can find the best deal across major retailers, watch prices, look up working coupon codes, and check price history.</p>
        <p>It runs at <code>https://mcp.shopdeals.sh/mcp</code> and any MCP-compatible client can connect.</p>
      `, true)}
      ${faqItem('What is MCP?', `
        <p>MCP (Model Context Protocol) is an open standard from Anthropic for giving AI assistants tools. An MCP server exposes a set of typed functions; an MCP client (Claude, Cursor, ChatGPT's custom connectors, Cline, Continue, etc.) calls them on the model's behalf during a conversation.</p>
        <p>Think of MCP as the USB-C of AI agents — one cable, any tool.</p>
      `)}
      ${faqItem('Which AI assistants work with shopdeals?', `
        <p>Anything that speaks MCP. Confirmed: Claude Desktop, Claude on the web, ChatGPT custom connectors (Plus / Pro), Cursor, Cline, Continue, Zed, and VS Code's MCP extension. If your client supports MCP, point it at <code>https://mcp.shopdeals.sh/mcp</code> and you're in.</p>
      `)}
      ${faqItem('Can the agent actually buy things, or just find them?', `
        <p>Find — not buy. shopdeals returns the best deal with a direct (affiliate-tagged) buy link, but you click the link and complete checkout in the merchant's own site or app. We deliberately don't take over your wallet.</p>
        <p>This is the safest pattern for agentic shopping today: the model does the research and surfaces the choice, you make the final purchase.</p>
      `)}
      ${faqItem('How do you get the codes?', `
        <p>We're built on 362K coupon codes across 82 affiliate networks (CJ, Rakuten, Impact, Awin, Skimlinks, Sovrn, Pepperjam, and merchant-direct feeds). On top of that, every agent run sends back a <code>report_code_result</code> signal — when a code stops working, it's killed from the catalog within minutes.</p>
      `)}
      ${faqItem('How accurate are the prices?', `
        <p>Prices come from a mix of merchant feeds, Google Shopping, and lightweight server-side fetches at query time. We compare total cost (price + shipping + tax estimate) so the agent's answer reflects what you'd actually pay at checkout, not just the sticker.</p>
        <p>The catalog refreshes continuously — currently ${ingestStatus}.</p>
      `)}
      ${faqItem('Do you take affiliate commission?', `
        <p>Yes — that's how shopdeals stays free for shoppers. When you buy through a link the agent surfaces, the retailer pays us a small commission at no extra cost to you. We never strip an existing creator or community attribution from a URL; we only add ours when none is present.</p>
      `)}
      ${faqItem('Is my data tracked?', `
        <p>The MCP server doesn't store your queries, your identity, or anything you buy. The only data we keep is anonymized aggregate counts (how many times a deal was returned, how often a code worked) so we can rank better deals over time.</p>
      `)}
      ${faqItem('How do I add it to Claude Desktop?', `
        <p>Open Claude Desktop, go to <strong>Settings → Developer → Edit Config</strong>, and add this block under <code>mcpServers</code>:</p>
        <pre>{
  "mcpServers": {
    "shopdeals": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.shopdeals.sh/mcp"]
    }
  }
}</pre>
        <p>Restart Claude and the ten shopdeals tools will be available in any conversation.</p>
      `)}
      ${faqItem('Is it free?', `
        <p>Free for shoppers, forever. We're funded by affiliate commission on successful purchases. There are no per-call fees, no rate limits worth mentioning, and no account required to use the MCP server.</p>
      `)}
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="row">
      <div class="col-brand">
        <a class="logo" href="/">
          <span class="brand-mark" style="color: var(--text);"><svg><use href="#sd-mark"/></svg></span>
          shopdeals
        </a>
        <span class="tag">The MCP server for shopping. Built for AI agents.</span>
        <span class="live-pill"><span class="dot"></span>${ingestStatus} · ${dealCount} deals</span>
      </div>
      <div class="links">
        <a href="#features">Features</a>
        <a href="#install">Install</a>
        <a href="#faq">FAQ</a>
        <a href="https://github.com/idanmann10/shopdeals" target="_blank" rel="noopener">GitHub</a>
        <a href="mailto:hello@shopdeals.sh">Contact</a>
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
      </div>
    </div>
    <div class="disclosure">
      <p><strong>Affiliate disclosure:</strong> shopdeals is a participant in the Amazon Services LLC Associates Program and other affiliate networks. Many of the buy links surfaced by the agent are affiliate links — when you purchase through them, we earn a small commission at no extra cost to you.</p>
      <p>&copy; ${new Date().getFullYear()} shopdeals. All rights reserved.</p>
    </div>
  </div>
</footer>

<div class="toast" id="toast">Copied to clipboard</div>

<script>
  const MCP_URL = 'https://mcp.shopdeals.sh/mcp';
  const CLAUDE_SNIPPET = \`{
  "mcpServers": {
    "shopdeals": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.shopdeals.sh/mcp"]
    }
  }
}\`;
  const CURSOR_SNIPPET = \`{
  "mcpServers": {
    "shopdeals": {
      "url": "https://mcp.shopdeals.sh/mcp"
    }
  }
}\`;
  // Cursor deeplink — opens Cursor and prompts the user to install. The
  // payload is base64-encoded JSON describing the server entry.
  function cursorDeeplink() {
    const payload = { url: MCP_URL };
    const b64 = typeof btoa === 'function' ? btoa(JSON.stringify(payload)) : '';
    return 'cursor://anysphere.cursor-deeplink/mcp/install?name=shopdeals&config=' + encodeURIComponent(b64);
  }

  const toast = document.getElementById('toast');
  function flashToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      flashToast((label || 'Copied') + ' — pasted to clipboard');
      return true;
    } catch {
      flashToast('Could not copy automatically — select and copy manually');
      return false;
    }
  }

  /* ---------- Install modal ---------- */
  const modal = document.getElementById('install-modal');
  const modalIco = document.getElementById('m-ico');
  const modalTitle = document.getElementById('m-title-text');
  const modalBody = document.getElementById('m-body');
  const modalClose = document.getElementById('m-close');
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  function openModal(opts) {
    if (!modal || !modalIco || !modalTitle || !modalBody) return;
    modalIco.innerHTML = opts.icon;
    modalTitle.textContent = opts.title;
    modalBody.innerHTML = opts.body;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
  modalClose && modalClose.addEventListener('click', closeModal);
  modal && modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  /* Icon SVGs reused in the modal header */
  const ICONS = {
    cursor: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.925.0461c-.123-.0288-.249-.0594-.4116.0337L1.0962 6.0683c-.0846.0488-.1547.119-.2034.2036-.0488.0846-.0744.1804-.0746.278v11.9075c.0002.0976.0258.1935.0746.2781.0487.0846.1188.1547.2034.2036L11.521 23.918l.0006.0003c.045.025.083.0455.1257.0589.0419.0131.0867.0193.1335.0228h.0011a1.06 1.06 0 0 0 .1334-.0228c.0427-.0134.0808-.0339.1257-.0589l.0006-.0003 10.4248-6.0349c.0847-.0488.155-.1188.2038-.2034.0489-.0846.0746-.1804.0749-.2781V6.3504c-.0003-.0977-.026-.1936-.0749-.2782s-.1191-.1546-.2038-.2034L12.3372.0798a.522.522 0 0 0-.4122-.0337zM12.0163.7917l9.7905 5.6669-9.7905 5.6669L2.2257 6.4586l9.7906-5.6669zM1.7757 7.4083l9.7906 5.6669v11.3338L1.7757 18.7421V7.4083zm20.4467 0v11.3338l-9.7905 5.6669V13.0752l9.7905-5.6669z"/></svg>',
    claude: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/></svg>',
    chatgpt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494z"/></svg>',
  };

  /* ---------- Per-client install flows ---------- */
  function installCursor() {
    // Try the deeplink first. If the user doesn't have Cursor installed it
    // silently no-ops, so we ALSO open the snippet modal as the fallback.
    try {
      window.location.href = cursorDeeplink();
    } catch {}
    setTimeout(() => {
      openModal({
        icon: ICONS.cursor,
        title: 'Add to Cursor',
        body: \`
          <p class="m-step">If Cursor opened, click <strong>Install</strong> in the prompt and you're done.</p>
          <p class="m-step">Otherwise, paste this into <code>~/.cursor/mcp.json</code>:</p>
          <pre id="cursor-snippet">\${escapeHtml(CURSOR_SNIPPET)}</pre>
          <div class="m-actions">
            <button class="m-btn" type="button" id="m-copy-cursor">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy snippet
            </button>
            <a class="m-btn secondary" href="\${cursorDeeplink()}">Re-open in Cursor</a>
          </div>\`,
      });
      const btn = document.getElementById('m-copy-cursor');
      if (btn) btn.addEventListener('click', async () => {
        if (await copy(CURSOR_SNIPPET, 'Cursor snippet')) {
          btn.classList.add('secondary', 'copied');
          btn.firstChild && (btn.lastChild.textContent = ' Copied');
        }
      });
    }, 600);
  }

  function installClaude() {
    openModal({
      icon: ICONS.claude,
      title: 'Add to Claude Desktop',
      body: \`
        <ol class="m-list">
          <li>Open <strong>Claude Desktop</strong> → <strong>Settings</strong> → <strong>Developer</strong> → <strong>Edit Config</strong>.</li>
          <li>Paste the snippet below under <code>mcpServers</code>.</li>
          <li>Restart Claude. The ten shopdeals tools will be available in any chat.</li>
        </ol>
        <pre>\${escapeHtml(CLAUDE_SNIPPET)}</pre>
        <div class="m-actions">
          <button class="m-btn" type="button" id="m-copy-claude">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy snippet
          </button>
          <a class="m-btn secondary" href="https://docs.claude.com/en/docs/agents-and-tools/mcp" target="_blank" rel="noopener">Claude MCP docs</a>
        </div>\`,
    });
    const btn = document.getElementById('m-copy-claude');
    if (btn) btn.addEventListener('click', async () => {
      if (await copy(CLAUDE_SNIPPET, 'Claude snippet')) {
        btn.classList.add('secondary', 'copied');
        btn.lastChild && (btn.lastChild.textContent = ' Copied');
      }
    });
  }

  function installChatGPT() {
    openModal({
      icon: ICONS.chatgpt,
      title: 'Add to ChatGPT',
      body: \`
        <ol class="m-list">
          <li>In ChatGPT, open <strong>Settings</strong> → <strong>Connectors</strong> → <strong>Add</strong>.</li>
          <li>Choose <strong>Custom MCP server</strong> and paste this URL:</li>
        </ol>
        <pre>\${escapeHtml(MCP_URL)}</pre>
        <p class="m-step">Custom connectors require ChatGPT <strong>Plus</strong> or <strong>Pro</strong>.</p>
        <div class="m-actions">
          <button class="m-btn" type="button" id="m-copy-chatgpt">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy URL
          </button>
          <a class="m-btn secondary" href="https://chatgpt.com/?model=gpt-4" target="_blank" rel="noopener">Open ChatGPT</a>
        </div>\`,
    });
    const btn = document.getElementById('m-copy-chatgpt');
    if (btn) btn.addEventListener('click', async () => {
      if (await copy(MCP_URL, 'MCP URL')) {
        btn.classList.add('secondary', 'copied');
        btn.lastChild && (btn.lastChild.textContent = ' Copied');
      }
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  document.querySelectorAll('.install-card[data-client]').forEach((el) => {
    el.addEventListener('click', () => {
      const c = el.getAttribute('data-client');
      if (c === 'cursor') installCursor();
      else if (c === 'claude') installClaude();
      else if (c === 'chatgpt') installChatGPT();
    });
  });
  // Hero "MCP server URL" row → copy the raw URL.
  const urlRow = document.getElementById('url-row');
  if (urlRow) {
    urlRow.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('https://mcp.shopdeals.sh/mcp');
        urlRow.classList.add('copied');
        const lbl = urlRow.querySelector('.url-copy-label');
        if (lbl) {
          const prev = lbl.textContent;
          lbl.textContent = 'Copied';
          setTimeout(() => { lbl.textContent = prev; urlRow.classList.remove('copied'); }, 1400);
        } else {
          setTimeout(() => urlRow.classList.remove('copied'), 1400);
        }
        flashToast('MCP URL copied');
      } catch {
        flashToast('Could not copy — select and copy manually');
      }
    });
  }

  /* ---------- Feature cards: click anywhere on a collapsed card to expand ---------- */
  const featureGrid = document.querySelector('.features-grid');
  if (featureGrid) {
    const cards = Array.from(featureGrid.querySelectorAll('.fcard'));
    cards.forEach((card) => {
      const onActivate = () => {
        if (card.classList.contains('expanded')) return;
        cards.forEach((c) => c.classList.remove('expanded'));
        card.classList.add('expanded');
        featureGrid.setAttribute('data-active', card.dataset.key || '');
      };
      card.addEventListener('click', (e) => {
        // Let the CTA link (and anything else interactive inside the card)
        // behave normally once the card is already expanded.
        if (card.classList.contains('expanded') && (e.target.closest('a, button'))) {
          return;
        }
        onActivate();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
      });
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
    });
  }

  /* ---------- Scroll reveal ---------- */
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach((el) => {
      if (!el.classList.contains('in')) io.observe(el);
    });
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }

  /* ---------- Nav scroll shadow ---------- */
  const navWrap = document.querySelector('.nav-wrap');
  if (navWrap) {
    let lastY = -1;
    const onScroll = () => {
      const y = window.scrollY;
      if (y === lastY) return;
      lastY = y;
      navWrap.classList.toggle('scrolled', y > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Install card: visual "copied" pulse ---------- */
  for (const id of ['install-claude', 'install-chatgpt', 'install-cursor']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('click', () => {
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 900);
    });
  }
</script>
</body>
</html>`;
}

/** Partner logos for the marquee — inline SVG brand marks. CSS dims the row
 *  so they read as ambient context, not endorsements. */
function partnersRow(): string {
  const items: Array<{ name: string; svg: string }> = [
    {
      name: 'Claude',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/></svg>`,
    },
    {
      name: 'OpenAI',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387 2.014-1.158a.076.076 0 0 1 .071 0l4.83 2.787a4.49 4.49 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
    },
    {
      name: 'Cursor',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.925.0461c-.123-.0288-.249-.0594-.4116.0337L1.0962 6.0683c-.0846.0488-.1547.119-.2034.2036-.0488.0846-.0744.1804-.0746.278v11.9075c.0002.0976.0258.1935.0746.2781.0487.0846.1188.1547.2034.2036L11.521 23.918l.0006.0003c.045.025.083.0455.1257.0589.0419.0131.0867.0193.1335.0228h.0011a1.06 1.06 0 0 0 .1334-.0228c.0427-.0134.0808-.0339.1257-.0589l.0006-.0003 10.4248-6.0349c.0847-.0488.155-.1188.2038-.2034.0489-.0846.0746-.1804.0749-.2781V6.3504c-.0003-.0977-.026-.1936-.0749-.2782s-.1191-.1546-.2038-.2034L12.3372.0798a.522.522 0 0 0-.4122-.0337zM12.0163.7917l9.7905 5.6669-9.7905 5.6669L2.2257 6.4586l9.7906-5.6669zM1.7757 7.4083l9.7906 5.6669v11.3338L1.7757 18.7421V7.4083zm20.4467 0v11.3338l-9.7905 5.6669V13.0752l9.7905-5.6669z"/></svg>`,
    },
    {
      name: 'Gemini',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12"/></svg>`,
    },
    {
      name: 'Perplexity',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.3977 7.0896h-2.3106V.7522l-7.4288 6.3374h7.4288V16.456l-5.1187-5.121v6.1818h-2.5566v-6.1818l-5.1187 5.121V7.0896h7.4288L9.343.7522v6.3374H7.0324c-.3211 0-.5811.2603-.5811.5814v8.7305c0 .3211.26.5814.5811.5814h2.3106v6.3374L14.395 16.456v6.1818h2.5566v-6.1818l5.1187 5.121V7.0896h-.6726z"/></svg>`,
    },
    {
      name: 'VS Code',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.9 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>`,
    },
    {
      name: 'GitHub Copilot',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.881.881 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.846.846 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.251zm-11.999-5.99h.149c.21 0 .357.165.357.371v.001c0 .206-.146.371-.357.371h-.149c-.21 0-.357-.165-.357-.371s.147-.372.357-.372zm-7.157 5.51c0-.95.34-1.717.94-2.252.6-.535 1.45-.835 2.45-.835s1.85.3 2.45.835c.6.535.94 1.301.94 2.252v.003c0 .95-.34 1.716-.94 2.251-.6.535-1.45.835-2.45.835s-1.85-.3-2.45-.835c-.6-.535-.94-1.301-.94-2.251v-.003zm10.234 0c0-.95.34-1.717.94-2.252.6-.535 1.45-.835 2.45-.835s1.85.3 2.45.835c.6.535.94 1.301.94 2.252v.003c0 .95-.34 1.716-.94 2.251-.6.535-1.45.835-2.45.835s-1.85-.3-2.45-.835c-.6-.535-.94-1.301-.94-2.251v-.003z"/></svg>`,
    },
    {
      name: 'Cline',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.515 4.514L0 4.51c0 9.385 7.628 17.011 17.011 17.011 0-9.382-7.624-17.007-17.007-17.007zM21.49 4.51v8.523c0 4.674-3.794 8.467-8.479 8.488a17.04 17.04 0 0 1-.013-.49c0-4.683 3.794-8.484 8.478-8.498V4.51c0-1.105-.895-2-2-2h-.001c1.105 0 2 .895 2 2zm-9.49 7.495c0-1.105.895-2 2-2s2 .895 2 2-.895 2-2 2-2-.895-2-2z"/></svg>`,
    },
    {
      name: 'Zed',
      svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm-1.27 5.78h6.99a.7.7 0 0 1 .7.7v1.4a.7.7 0 0 1-.7.7H13.4l4.78 7.94a.7.7 0 0 1-.6 1.06H6.65a.7.7 0 0 1-.7-.7v-1.4a.7.7 0 0 1 .7-.7h4.32L6.19 6.84a.7.7 0 0 1 .6-1.06h3.94Z"/></svg>`,
    },
  ];
  return items
    .map(
      (i) => `<span class="logo-item">
        <span class="logo-glyph" aria-hidden="true">${i.svg}</span>
        <span class="logo-name">${i.name}</span>
      </span>`,
    )
    .join('');
}

function faqItem(question: string, answerHtml: string, open = false): string {
  return `<details class="faq-item"${open ? ' open' : ''}>
    <summary>
      <span>${question}</span>
      <span class="sign"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
    </summary>
    <div class="answer">${answerHtml.trim()}</div>
  </details>`;
}

function formatThousands(n: number | undefined): string {
  if (!Number.isFinite(n ?? NaN) || (n ?? 0) <= 0) return '—';
  return (n as number).toLocaleString('en-US');
}

function formatIngestStatus(hoursAgo: number | undefined): string {
  if (hoursAgo === undefined) return 'live catalog';
  if (hoursAgo < 1) return 'updated minutes ago';
  if (hoursAgo < 2) return 'updated 1 hour ago';
  if (hoursAgo < 24) return `updated ${Math.floor(hoursAgo)} hours ago`;
  const days = Math.floor(hoursAgo / 24);
  return days === 1 ? 'updated 1 day ago' : `updated ${days} days ago`;
}
