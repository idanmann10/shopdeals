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

  /* ---------- Ambient hero glow ---------- */
  .hero-glow {
    position: absolute; inset: -120px -120px auto auto;
    width: 720px; height: 720px;
    background: radial-gradient(closest-side, rgba(242,107,58,0.32), rgba(242,107,58,0) 70%);
    filter: blur(6px);
    pointer-events: none;
    animation: glow-drift 14s ease-in-out infinite alternate;
    z-index: 0;
  }
  @keyframes glow-drift {
    0% { transform: translate3d(0,0,0) scale(1); opacity: .9; }
    100% { transform: translate3d(-40px, 30px, 0) scale(1.08); opacity: 1; }
  }
  .hero-blob {
    position: absolute; left: -160px; bottom: -200px;
    width: 540px; height: 540px;
    background: radial-gradient(closest-side, rgba(217,119,87,0.20), rgba(217,119,87,0) 70%);
    filter: blur(4px);
    pointer-events: none;
    animation: glow-drift 18s -6s ease-in-out infinite alternate;
    z-index: 0;
  }

  /* ---------- Brand mark ---------- */
  .brand-mark { width: 28px; height: 28px; flex-shrink: 0; display: inline-grid; place-items: center; color: var(--brand); }
  .brand-mark.lg { width: 56px; height: 56px; }
  .brand-mark svg { width: 100%; height: 100%; transition: transform .4s cubic-bezier(.2,.7,.2,1); }
  .logo:hover .brand-mark svg { transform: rotate(-8deg) scale(1.05); }
  /* Subtle continuous bob on hero mark */
  .brand-mark.bob svg { animation: bob 3.6s ease-in-out infinite; transform-origin: 50% 60%; }
  @keyframes bob {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-3px) rotate(-2deg); }
  }
  @media (prefers-reduced-motion: reduce) { .brand-mark.bob svg { animation: none; } }

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
    padding: 9px 18px;
    background: var(--brand); color: white;
    font-size: 14px; font-weight: 600;
    border-radius: 999px;
    position: relative;
    box-shadow: 0 4px 16px rgba(242,107,58,0.30);
    transition: transform .14s ease, box-shadow .14s ease, background .14s ease;
  }
  .nav-cta::after {
    content: ''; position: absolute; inset: 0;
    border-radius: 999px;
    box-shadow: 0 0 0 0 rgba(242,107,58,0.55);
    animation: cta-pulse 2.8s ease-out infinite;
    pointer-events: none;
  }
  .nav-cta:hover { background: var(--brand-2); transform: translateY(-1px); box-shadow: 0 8px 22px rgba(242,107,58,0.42); }
  .nav-cta svg { width: 14px; height: 14px; }
  @keyframes cta-pulse {
    0% { box-shadow: 0 0 0 0 rgba(242,107,58,0.45); }
    70% { box-shadow: 0 0 0 14px rgba(242,107,58,0); }
    100% { box-shadow: 0 0 0 0 rgba(242,107,58,0); }
  }
  @media (prefers-reduced-motion: reduce) { .nav-cta::after { animation: none; } }
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
    box-shadow: 0 10px 28px rgba(242,107,58,0.30);
    position: relative; overflow: hidden;
  }
  .btn-primary::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%);
    transform: translateX(-120%);
    transition: transform .9s ease;
    pointer-events: none;
  }
  .btn-primary:hover { background: var(--brand-2); transform: translateY(-1px); box-shadow: 0 14px 32px rgba(242,107,58,0.42); }
  .btn-primary:hover::before { transform: translateX(120%); }
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
    color: rgba(243,243,241,0.5);
    font-size: 16px; font-weight: 500;
    white-space: nowrap;
  }
  .marquee .logo-item svg { height: 26px; width: auto; fill: rgba(243,243,241,0.5); }
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
    display: grid; grid-template-columns: 15fr 6fr 3fr;
    gap: 14px;
    align-items: stretch;
  }
  @media (max-width: 1080px) { .features-grid { grid-template-columns: 1fr; } }

  .fcard {
    border-radius: var(--radius);
    padding: 32px;
    display: flex; flex-direction: column;
    min-height: 460px;
    position: relative;
    overflow: hidden;
    transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s ease;
    will-change: transform;
  }
  .fcard::after {
    content: ''; position: absolute; inset: -1px;
    border-radius: var(--radius);
    pointer-events: none;
    background: radial-gradient(420px circle at var(--mx,50%) var(--my,0%), rgba(255,255,255,0.10), transparent 45%);
    opacity: 0;
    transition: opacity .3s ease;
  }
  .fcard:hover { transform: translateY(-6px); box-shadow: 0 22px 50px rgba(0,0,0,0.30); }
  .fcard:hover::after { opacity: 1; }
  .fcard.expanded:hover { box-shadow: 0 22px 50px rgba(120,60,20,0.28); }
  /* Shimmer ribbon that drifts diagonally on the pink card */
  .fcard.expanded::before {
    content: ''; position: absolute; inset: -40% -20% auto auto;
    width: 380px; height: 380px;
    background: radial-gradient(closest-side, rgba(255,255,255,0.45), rgba(255,255,255,0) 70%);
    transform: rotate(18deg);
    pointer-events: none;
    animation: shimmer 9s ease-in-out infinite alternate;
  }
  @keyframes shimmer {
    0% { transform: translate3d(0,0,0) rotate(18deg); }
    100% { transform: translate3d(-30px, 24px, 0) rotate(18deg); }
  }
  @media (prefers-reduced-motion: reduce) { .fcard.expanded::before { animation: none; } }
  .fcard.expanded { background: var(--pink-card); color: #1a120c; }
  .fcard.expanded .fc-pill { background: rgba(26,18,12,0.08); color: #1a120c; }
  .fcard.expanded .fc-eyebrow { color: rgba(26,18,12,0.55); }
  .fcard.expanded .fc-body { color: rgba(26,18,12,0.7); }
  .fcard.expanded .fc-cta { color: #1a120c; }
  .fcard.expanded .fc-cta:hover { background: rgba(26,18,12,0.08); }
  .fcard.dark { background: var(--surface); color: var(--text); }
  .fcard.dark .fc-body { color: var(--text-dim); }
  .fcard.dark .fc-pill { background: rgba(243,243,241,0.08); color: var(--text); }
  .fcard.teal { background: var(--teal-card); color: var(--text); }
  .fcard.teal .fc-body { color: rgba(243,243,241,0.75); }
  .fcard.teal .fc-pill { background: rgba(243,243,241,0.10); color: var(--text); }

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

  /* Compact cards (middle + right) hide the body paragraphs by default */
  .fcard.compact .fc-body.secondary { display: none; }
  @media (max-width: 1080px) {
    .fcard.compact .fc-body.secondary { display: block; }
  }

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
  .install-band p.lede { color: var(--text-dim); font-size: 16px; margin: 0 0 32px; max-width: 560px; }
  .install-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  @media (max-width: 880px) { .install-grid { grid-template-columns: 1fr; } }
  .install-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 22px;
    display: flex; align-items: center; gap: 14px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: border-color .2s ease, transform .2s ease, background .2s ease, box-shadow .2s ease;
  }
  .install-card::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: var(--brand); transform: scaleY(0); transform-origin: top;
    transition: transform .3s ease;
  }
  .install-card:hover { border-color: var(--line-strong); transform: translateY(-3px); background: var(--surface-2); box-shadow: 0 14px 36px rgba(0,0,0,0.25); }
  .install-card:hover::before { transform: scaleY(1); }
  .install-card:hover .arrow { transform: translateX(4px); color: var(--brand); }
  .install-card .arrow { transition: transform .2s ease, color .2s ease; }
  .install-card.copied { border-color: rgba(43,189,126,0.6); }
  .install-card .ico { transition: transform .25s ease; }
  .install-card:hover .ico { transform: scale(1.06) rotate(-3deg); }
  .install-card .ico {
    width: 40px; height: 40px; border-radius: 10px;
    display: inline-grid; place-items: center;
    flex-shrink: 0;
  }
  .ico-claude { background: linear-gradient(135deg, #d97757 0%, #e89178 100%); color: white; }
  .ico-chatgpt { background: linear-gradient(135deg, #10a37f 0%, #19c69b 100%); color: white; }
  .ico-cursor { background: linear-gradient(135deg, #2e2a36 0%, #4a4456 100%); color: white; }
  .install-card .text { flex: 1; }
  .install-card .label { font-size: 15px; font-weight: 600; color: var(--text); display: block; }
  .install-card .sub { font-size: 12.5px; color: var(--text-dim); display: block; margin-top: 2px; }
  .install-card .arrow { color: var(--text-dimmer); }

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
    box-shadow: 0 0 0 0 rgba(43,189,126,0.6);
    animation: dot-pulse 2.4s ease-out infinite;
  }
  @keyframes dot-pulse {
    0% { box-shadow: 0 0 0 0 rgba(43,189,126,0.55); }
    100% { box-shadow: 0 0 0 8px rgba(43,189,126,0); }
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
        <span class="brand-mark bob"><svg><use href="#sd-mark"/></svg></span>
        shopdeals
      </a>
      <div class="nav-right">
        <a class="nav-link docs" href="#faq">Docs</a>
        <a class="nav-link" href="https://github.com/idanmann10/snap-ai" target="_blank" rel="noopener">GitHub</a>
        <a class="nav-cta" href="#install" id="nav-add-claude">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#d97757" d="M8.5 22.5h3.6l3.9-9.4 3.9 9.4h3.6L18 4h-4L8.5 22.5zm5-7.3 2.5-6.1 2.5 6.1h-5z"/></svg>
          Add to Claude
        </a>
      </div>
    </nav>
  </div>
</div>

<section class="hero">
  <div class="hero-glow" aria-hidden="true"></div>
  <div class="hero-blob" aria-hidden="true"></div>
  <div class="container">
    <div class="hero-grid">
      <div>
        <h1 class="hero-title reveal in">Make Claude find the best deal.</h1>
      </div>
      <div class="hero-right reveal d1 in">
        <p class="hero-sub">An MCP server that gives your AI the ability to shop — compare sellers, watch prices, and apply coupons that actually work.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary" href="#install" id="hero-add-claude">
            <svg class="leaf" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M8.5 22.5h3.6l3.9-9.4 3.9 9.4h3.6L18 4h-4L8.5 22.5zm5-7.3 2.5-6.1 2.5 6.1h-5z"/></svg>
            Add to Claude
          </a>
          <a class="btn btn-secondary" href="https://github.com/idanmann10/snap-ai" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.17-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.17 1.82 1.17 3.07 0 4.4-2.69 5.36-5.25 5.65.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
            View on GitHub
          </a>
        </div>
        <span class="hero-meta">
          <span class="tri"></span>
          Compatible with any MCP client
        </span>
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
    <div class="features-grid reveal">

      <!-- Expanded card: Best deal -->
      <article class="fcard expanded">
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
        <a class="fc-cta" href="#install">
          See it in action
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
      </article>

      <!-- Middle card: Watch prices -->
      <article class="fcard dark compact">
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
        <p class="fc-body secondary">Price history backs every watch — the agent can show you how the deal compares to the last 90 days.</p>
        <div class="fc-spacer"></div>
      </article>

      <!-- Right card: Coupons -->
      <article class="fcard teal compact">
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
        <p class="fc-body secondary">Telemetry from every agent run kills dead codes automatically — so the next request gets a working one.</p>
        <div class="fc-spacer"></div>
      </article>

    </div>
  </div>
</section>

<section class="install-band" id="install">
  <div class="container">
    <h2 class="reveal">Add it to your AI workspace.</h2>
    <p class="lede reveal d1">Click any card to copy the connection snippet. The endpoint is <code style="background:var(--surface);padding:2px 8px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:var(--brand);">https://mcp.shopdeals.sh/mcp</code></p>
    <div class="install-grid reveal d2">
      <a class="install-card" href="#" id="install-claude">
        <span class="ico ico-claude">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M8.5 22.5h3.6l3.9-9.4 3.9 9.4h3.6L18 4h-4L8.5 22.5zm5-7.3 2.5-6.1 2.5 6.1h-5z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Claude</span>
          <span class="sub">Claude Desktop config snippet</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a>
      <a class="install-card" href="#" id="install-chatgpt">
        <span class="ico ico-chatgpt">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M28.6 13.2a7.4 7.4 0 0 0-.7-6 7.4 7.4 0 0 0-8-3.6 7.4 7.4 0 0 0-5.6-2.5 7.4 7.4 0 0 0-7.1 5.1 7.4 7.4 0 0 0-4.9 3.6 7.4 7.4 0 0 0 .9 8.7 7.4 7.4 0 0 0 .7 6 7.4 7.4 0 0 0 8 3.6 7.4 7.4 0 0 0 5.6 2.5 7.4 7.4 0 0 0 7.1-5.1 7.4 7.4 0 0 0 4.9-3.6 7.4 7.4 0 0 0-.9-8.7zM17.3 28.4a5.5 5.5 0 0 1-3.5-1.3l.2-.1 5.8-3.4a1 1 0 0 0 .5-.8v-8.2l2.5 1.4v6.8a5.5 5.5 0 0 1-5.5 5.5zM5.4 23.3a5.5 5.5 0 0 1-.7-3.7l.2.1 5.8 3.4a1 1 0 0 0 1 0l7.1-4.1v2.9l-5.9 3.4a5.5 5.5 0 0 1-7.5-2zM3.9 11.1a5.5 5.5 0 0 1 2.9-2.4v6.9a1 1 0 0 0 .5.9l7 4-2.4 1.4-5.9-3.4a5.5 5.5 0 0 1-2-7.4zm20 4.6-7-4 2.4-1.4 5.9 3.4a5.5 5.5 0 0 1-.9 9.9v-6.9a1 1 0 0 0-.5-.9zm2.5-3.7-.2-.1-5.8-3.4a1 1 0 0 0-1 0l-7.1 4.1V9.7l5.9-3.4a5.5 5.5 0 0 1 8.2 5.7zM11.5 17l-2.5-1.4V8.7a5.5 5.5 0 0 1 9-4.2l-.2.1L12 8a1 1 0 0 0-.5.8V17zm1.3-2.9 3.2-1.8 3.2 1.8V18l-3.2 1.8-3.2-1.8z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to ChatGPT</span>
          <span class="sub">Custom connector URL · Plus / Pro</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a>
      <a class="install-card" href="#" id="install-cursor">
        <span class="ico ico-cursor">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3 4 9.4v13.2L16 29l12-6.4V9.4L16 3zm0 2.3 9.6 5.1L16 15.6 6.4 10.4 16 5.3zm-10 7.5 9 4.8v9.8l-9-4.8v-9.8zm20 9.8-9 4.8v-9.8l9-4.8v9.8z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Cursor</span>
          <span class="sub">mcp.json snippet · macOS · Win · Linux</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a>
    </div>
  </div>
</section>

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
        <a href="https://github.com/idanmann10/snap-ai" target="_blank" rel="noopener">GitHub</a>
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
  const SNIPPETS = {
    'install-claude': \`{
  "mcpServers": {
    "shopdeals": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.shopdeals.sh/mcp"]
    }
  }
}\`,
    'install-chatgpt': 'https://mcp.shopdeals.sh/mcp\\n\\nSettings → Connectors → Add custom connector → paste URL',
    'install-cursor': \`{
  "mcpServers": {
    "shopdeals": {
      "url": "https://mcp.shopdeals.sh/mcp"
    }
  }
}\`,
  };
  const toast = document.getElementById('toast');
  function flashToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
  }
  for (const [id, snippet] of Object.entries(SNIPPETS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(snippet);
        flashToast(id === 'install-chatgpt' ? 'URL copied' : 'Snippet copied');
      } catch {
        alert(snippet);
      }
    });
  }
  // "Add to Claude" buttons in nav + hero also copy the Claude snippet.
  for (const btnId of ['nav-add-claude', 'hero-add-claude']) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    btn.addEventListener('click', async (e) => {
      // Let it scroll, AND copy the snippet so the user sees the toast.
      try {
        await navigator.clipboard.writeText(SNIPPETS['install-claude']);
        flashToast('Snippet copied — paste into Claude Desktop config');
      } catch {}
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

  /* ---------- Feature card spotlight (mouse-follow glow) ---------- */
  document.querySelectorAll('.fcard').forEach((card) => {
    card.addEventListener('pointermove', (ev) => {
      const r = card.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width) * 100;
      const my = ((ev.clientY - r.top) / r.height) * 100;
      card.style.setProperty('--mx', mx + '%');
      card.style.setProperty('--my', my + '%');
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '0%');
    });
  });

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

/** Partner logos for the marquee. Each item is a wordmark or a small SVG mark.
 *  We dimm them via CSS (rgba(243,243,241,0.5)) so they read as ambient context,
 *  not endorsements. */
function partnersRow(): string {
  const items = [
    { name: 'OpenAI', svg: '<svg viewBox="0 0 100 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">OpenAI</text></svg>' },
    { name: 'Claude', svg: '<svg viewBox="0 0 100 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Claude</text></svg>' },
    { name: 'Cursor', svg: '<svg viewBox="0 0 100 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Cursor</text></svg>' },
    { name: 'Manus', svg: '<svg viewBox="0 0 100 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Manus</text></svg>' },
    { name: 'VS Code', svg: '<svg viewBox="0 0 110 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">VS Code</text></svg>' },
    { name: 'GitHub Copilot', svg: '<svg viewBox="0 0 170 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">GitHub Copilot</text></svg>' },
    { name: 'Gemini', svg: '<svg viewBox="0 0 100 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Gemini</text></svg>' },
    { name: 'Perplexity', svg: '<svg viewBox="0 0 130 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Perplexity</text></svg>' },
    { name: 'Cline', svg: '<svg viewBox="0 0 80 26" xmlns="http://www.w3.org/2000/svg"><text x="0" y="20" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="currentColor">Cline</text></svg>' },
  ];
  return items.map(i => `<span class="logo-item" style="color: rgba(243,243,241,0.5);">${i.svg}</span>`).join('');
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
