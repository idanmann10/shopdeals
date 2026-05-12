/**
 * Server-rendered landing page. Single HTML string returned from `GET /`.
 * No SPA, no build step, no external image assets beyond Google Fonts.
 *
 * Design reference: DealPilot AI shopping-agent mockup. Component-driven
 * layout with a live product-card hero, two illustrated narrative sections,
 * and dedicated Add-to-Claude / Add-to-ChatGPT install cards. Brand: shopdeals.
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
<title>shopdeals — Your AI shopping agent</title>
<meta name="description" content="Ask your AI to find the best deal. shopdeals plugs into Claude, ChatGPT, and Cursor — it compares trusted sellers, surfaces working coupon codes, and hands back the best buy in one click." />
<meta property="og:title" content="shopdeals — Your AI shopping agent" />
<meta property="og:description" content="Ask your AI. We compare sellers, find working codes, and surface the best deal." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" />
<style>
  :root {
    --bg: #ffffff;
    --bg-soft: #f7f6fb;
    --bg-card: #ffffff;
    --bg-card-soft: #fafaff;
    --ink: #0f0d1f;
    --ink-2: #5b5871;
    --ink-3: #9794ab;
    --line: #e9e7f0;
    --line-soft: #f1eff6;
    --brand: #5a4fcf;
    --brand-2: #7d6ff0;
    --brand-soft: #ede9fc;
    --brand-soft-2: #f4f1ff;
    --green: #1f9d6b;
    --green-soft: #e3f5ec;
    --warm: #ff7a59;
    --warm-soft: #ffe8e1;
    --radius: 18px;
    --radius-sm: 10px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  a { color: var(--ink); text-decoration: none; }
  ::selection { background: var(--brand); color: white; }

  .container { max-width: 1200px; margin: 0 auto; padding: 0 32px; }

  /* ---------- Header ---------- */
  header { padding: 26px 0; }
  header .row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .logo {
    display: inline-flex; align-items: center; gap: 10px;
    font-size: 19px; font-weight: 700; letter-spacing: -0.01em;
    color: var(--ink);
  }
  .logo-mark {
    width: 30px; height: 30px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%);
    position: relative; flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(90,79,207,0.30), inset 0 1px 0 rgba(255,255,255,0.18);
  }
  .logo-mark::after {
    content: '';
    position: absolute; inset: 6px;
    border-radius: 5px;
    background: linear-gradient(135deg, rgba(255,255,255,0.45), transparent 55%);
  }
  .nav { display: flex; gap: 32px; font-size: 14.5px; align-items: center; }
  .nav a { color: var(--ink-2); font-weight: 500; }
  .nav a:hover { color: var(--ink); }
  .nav-cta {
    padding: 10px 20px;
    background: var(--brand); color: white;
    border-radius: 999px; font-weight: 600;
    box-shadow: 0 2px 0 rgba(90,79,207,0.15), 0 8px 24px rgba(90,79,207,0.20);
    transition: transform .12s, box-shadow .12s;
  }
  .nav-cta:hover { color: white; transform: translateY(-1px); box-shadow: 0 4px 0 rgba(90,79,207,0.18), 0 12px 28px rgba(90,79,207,0.28); }

  /* ---------- Hero ---------- */
  .hero { padding: 64px 0 80px; position: relative; overflow: hidden; }
  .hero::before {
    content: '';
    position: absolute;
    bottom: -200px; left: -260px;
    width: 600px; height: 600px;
    background: radial-gradient(circle, rgba(125,111,240,0.16) 0%, transparent 65%);
    pointer-events: none; z-index: 0;
  }
  .hero-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 64px;
    align-items: center; position: relative; z-index: 1;
  }
  @media (max-width: 960px) { .hero-grid { grid-template-columns: 1fr; gap: 48px; } }

  h1.hero-title {
    font-weight: 800;
    font-size: clamp(44px, 6vw, 72px);
    line-height: 1.02;
    letter-spacing: -0.035em;
    margin: 0 0 24px;
  }
  .hero-sub {
    font-size: 17.5px;
    color: var(--ink-2);
    max-width: 460px;
    margin: 0 0 36px;
    line-height: 1.55;
  }
  .cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn-primary, .btn-ghost {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: inherit; font-size: 15px; font-weight: 600;
    padding: 14px 26px; border-radius: 10px;
    cursor: pointer;
    text-decoration: none;
    transition: transform .12s, box-shadow .12s, background .12s;
  }
  .btn-primary {
    background: var(--brand); color: white; border: 1px solid var(--brand);
    box-shadow: 0 2px 0 rgba(90,79,207,0.18), 0 10px 24px rgba(90,79,207,0.22);
  }
  .btn-primary:hover { color: white; transform: translateY(-1px); box-shadow: 0 4px 0 rgba(90,79,207,0.18), 0 14px 30px rgba(90,79,207,0.30); }
  .btn-ghost {
    background: white; color: var(--brand); border: 1px solid var(--brand-soft);
  }
  .btn-ghost:hover { background: var(--brand-soft-2); border-color: var(--brand); }
  .btn-primary svg, .btn-ghost svg { width: 16px; height: 16px; }

  /* ---------- Live demo card (hero right) ---------- */
  .demo-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 26px;
    box-shadow: 0 2px 0 rgba(15,13,31,0.02), 0 30px 80px rgba(90,79,207,0.13);
  }
  .demo-head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .demo-head .logo-mark { width: 26px; height: 26px; }
  .demo-head .name { font-weight: 700; font-size: 15px; }
  .demo-input {
    display: flex; align-items: center; gap: 6px;
    padding: 6px;
    background: white; border: 1px solid var(--line);
    border-radius: 12px;
    margin-bottom: 20px;
  }
  .demo-input .input-fake {
    flex: 1; padding: 8px 10px; display: flex; align-items: center; gap: 8px;
    font-size: 14px; color: var(--ink-3);
  }
  .demo-input .input-fake svg { width: 14px; height: 14px; color: var(--ink-3); }
  .demo-input .send {
    display: inline-grid; place-items: center;
    width: 34px; height: 34px; border-radius: 8px;
    background: var(--brand); color: white;
    box-shadow: 0 2px 0 rgba(90,79,207,0.20);
  }
  .demo-input .send svg { width: 14px; height: 14px; }

  .progress-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 22px; }
  .progress-item { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--ink-2); }
  .progress-item .ring {
    width: 18px; height: 18px; border-radius: 50%;
    display: inline-grid; place-items: center; flex-shrink: 0;
  }
  .progress-item.done .ring { background: var(--brand); color: white; }
  .progress-item.done .ring svg { width: 10px; height: 10px; }
  .progress-item.done { color: var(--ink); }
  .progress-item.active .ring {
    border: 2px solid var(--brand);
    background: white;
  }
  .progress-item.active { color: var(--ink); }
  .progress-item.pending .ring {
    border: 2px dashed var(--ink-3);
    background: transparent;
  }
  .progress-item.pending { color: var(--ink-3); }

  /* Seller comparison table */
  .seller-table {
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    font-size: 13.5px;
  }
  .seller-table .header {
    display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr;
    padding: 12px 16px;
    background: var(--bg-soft);
    border-bottom: 1px solid var(--line);
    font-weight: 600; color: var(--ink-2); font-size: 12.5px;
  }
  .seller-table .row {
    display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr;
    padding: 14px 16px;
    border-top: 1px solid var(--line-soft);
    align-items: center;
  }
  .seller-table .row:first-of-type { border-top: none; }
  .seller-table .row .seller-name {
    display: flex; align-items: center; gap: 10px;
    font-weight: 600;
  }
  .seller-table .row .seller-name img {
    width: 24px; height: 24px; border-radius: 6px;
    background: white; padding: 1px; box-shadow: 0 0 0 1px var(--line);
    flex-shrink: 0; object-fit: contain;
  }
  .seller-table .row .seller-name-text { display: flex; flex-direction: column; min-width: 0; }
  .seller-table .row.best {
    background: var(--brand-soft-2);
    color: var(--brand);
    font-weight: 600;
  }
  .seller-table .row.best .seller-name { color: var(--brand); }
  .seller-table .row.best .badge {
    font-size: 11px; font-weight: 500; color: var(--brand);
    margin-top: 1px;
  }

  .approve {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%;
    margin-top: 18px;
    padding: 14px;
    background: var(--brand); color: white;
    border: none; border-radius: 12px;
    font-family: inherit; font-size: 14.5px; font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 0 rgba(90,79,207,0.20), 0 12px 28px rgba(90,79,207,0.20);
    transition: transform .12s, box-shadow .12s;
  }
  .approve:hover { transform: translateY(-1px); }
  .approve svg { width: 14px; height: 14px; }

  /* ---------- Generic feature block ---------- */
  .feature-block {
    background: var(--bg-soft);
    border-radius: 22px;
    padding: 48px;
    margin-top: 24px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;
  }
  @media (max-width: 880px) {
    .feature-block { grid-template-columns: 1fr; padding: 32px; gap: 32px; }
  }
  .feature-block.reverse { direction: rtl; }
  .feature-block.reverse > * { direction: ltr; }

  .feature-block h2 {
    font-weight: 700;
    font-size: clamp(30px, 4vw, 38px);
    line-height: 1.1;
    letter-spacing: -0.025em;
    margin: 0 0 14px;
  }
  .feature-block p.lede {
    font-size: 16.5px;
    color: var(--ink-2);
    max-width: 420px;
    margin: 0 0 22px;
  }
  .bullet-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .bullet {
    display: flex; align-items: center; gap: 12px;
    font-size: 15px; color: var(--ink);
  }
  .bullet .check {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--brand); color: white;
    display: inline-grid; place-items: center; flex-shrink: 0;
  }
  .bullet .check svg { width: 12px; height: 12px; }

  /* Chat mockup card */
  .chat-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 26px;
    box-shadow: 0 2px 0 rgba(15,13,31,0.02), 0 16px 40px rgba(90,79,207,0.08);
  }
  .chat-card .head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; font-weight: 600; font-size: 15px; }
  .chat-card .head .logo-mark { width: 26px; height: 26px; }
  .chat-bubble {
    background: white;
    border-radius: 16px;
    padding: 12px 16px;
    font-size: 14px;
    color: var(--ink);
    width: fit-content;
    max-width: 80%;
    border: 1px solid var(--line-soft);
  }
  .chat-bubble.user {
    background: var(--brand-soft);
    color: var(--ink);
    margin-left: auto;
    margin-bottom: 12px;
    border: none;
  }
  .chat-bubble.ai { background: white; border: 1px solid var(--line); }
  .typing {
    display: inline-flex; gap: 4px; margin-top: 4px;
  }
  .typing span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--brand);
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.18s; }
  .typing span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes typing {
    0%, 100% { opacity: 0.3; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-3px); }
  }

  /* ---------- Install cards ---------- */
  .install-section { padding: 80px 0 32px; }
  .install-section h2 {
    text-align: center; font-weight: 700;
    font-size: clamp(28px, 3.5vw, 36px);
    letter-spacing: -0.02em;
    margin: 0 0 10px;
  }
  .install-section .lede {
    text-align: center; color: var(--ink-2); font-size: 16px; margin: 0 0 36px;
  }
  .install-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  }
  @media (max-width: 960px) { .install-grid { grid-template-columns: 1fr; } }
  .install-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 26px 26px;
    display: flex; align-items: center; gap: 18px;
    text-decoration: none;
    transition: border-color .12s, transform .12s, box-shadow .12s;
    cursor: pointer;
  }
  .install-card:hover {
    border-color: var(--brand);
    transform: translateY(-2px);
    box-shadow: 0 12px 28px rgba(90,79,207,0.12);
  }
  .install-card .ico {
    width: 48px; height: 48px; border-radius: 12px;
    display: inline-grid; place-items: center;
    color: white; flex-shrink: 0;
  }
  .ico-claude { background: linear-gradient(135deg, #ff7a59 0%, #ff9d80 100%); }
  .ico-chatgpt { background: linear-gradient(135deg, #10a37f 0%, #19c69b 100%); }
  .ico-cursor { background: linear-gradient(135deg, #0f0d1f 0%, #2d2a4a 100%); }
  .install-card .text {
    flex: 1; display: flex; flex-direction: column; gap: 2px;
  }
  .install-card .label { font-size: 16px; font-weight: 700; color: var(--ink); }
  .install-card .availability { font-size: 12.5px; color: var(--ink-3); }
  .install-card .arrow {
    color: var(--ink-3);
    transition: color .12s, transform .12s;
  }
  .install-card:hover .arrow { color: var(--brand); transform: translateX(2px); }

  /* ---------- Waitlist banner ---------- */
  .waitlist {
    margin: 64px 0 0;
    background: linear-gradient(135deg, #1a1632 0%, #0f0d1f 100%);
    color: white;
    border-radius: 22px;
    padding: 52px 48px;
    position: relative; overflow: hidden;
  }
  .waitlist::after {
    content: '';
    position: absolute; top: -120px; right: -120px;
    width: 360px; height: 360px;
    background: radial-gradient(circle, rgba(125,111,240,0.30) 0%, transparent 70%);
  }
  .waitlist h3 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
  .waitlist p { color: rgba(255,255,255,0.7); margin: 0 0 24px; max-width: 540px; }
  .waitlist form { display: flex; gap: 8px; max-width: 480px; position: relative; }
  .waitlist input[type=email] {
    flex: 1;
    padding: 13px 18px;
    font-family: inherit; font-size: 14.5px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.18);
    color: white;
    border-radius: 10px;
    outline: none;
    transition: border-color .12s, background .12s;
  }
  .waitlist input[type=email]::placeholder { color: rgba(255,255,255,0.45); }
  .waitlist input[type=email]:focus { border-color: white; background: rgba(255,255,255,0.14); }
  .waitlist button {
    padding: 13px 24px;
    font-family: inherit; font-size: 14.5px; font-weight: 600;
    background: var(--brand); color: white;
    border: none; border-radius: 10px;
    cursor: pointer;
  }
  .waitlist button:hover { background: var(--brand-2); }
  .waitlist .status { margin-top: 14px; font-size: 13px; min-height: 1.2em; color: rgba(255,255,255,0.65); position: relative; }
  .waitlist .status.ok { color: #9be5be; }
  .waitlist .status.err { color: #ffb3a8; }

  /* ---------- Footer ---------- */
  footer { padding: 72px 0 56px; border-top: 1px solid var(--line); margin-top: 64px; }
  footer .row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 32px; }
  @media (max-width: 760px) { footer .row { grid-template-columns: 1fr 1fr; gap: 24px; } }
  footer h4 { font-size: 14px; font-weight: 700; margin: 0 0 14px; color: var(--ink); }
  footer .links a { display: block; font-size: 13.5px; color: var(--ink-2); padding: 4px 0; }
  footer .links a:hover { color: var(--ink); }
  footer .col-brand { display: flex; flex-direction: column; gap: 6px; }
  footer .col-brand .tag { color: var(--ink-3); font-size: 13px; }
  footer .live-pill {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11.5px; color: var(--ink-3);
    padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px;
    margin-top: 10px;
    width: fit-content;
  }
  footer .live-pill .dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--green);
    animation: dot-pulse 2.4s ease-out infinite;
  }
  @keyframes dot-pulse {
    0% { box-shadow: 0 0 0 0 rgba(31,157,107,0.6); }
    100% { box-shadow: 0 0 0 8px rgba(31,157,107,0); }
  }
</style>
</head>
<body>

<header>
  <div class="container row">
    <a class="logo" href="/">
      <span class="logo-mark"></span>
      shopdeals
    </a>
    <nav class="nav">
      <a href="#how">How it works</a>
      <a href="#trust">Safety</a>
      <a href="#install">Install</a>
      <a class="nav-cta" href="#install">Get started</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="container">
    <div class="hero-grid">
      <div>
        <h1 class="hero-title">Your AI shopping agent.</h1>
        <p class="hero-sub">Ask Claude or ChatGPT for what you want. shopdeals compares trusted sellers, surfaces working coupon codes, and hands back the best deal in seconds.</p>
        <div class="cta-row">
          <a class="btn-primary" href="#install">Get started free</a>
          <a class="btn-ghost" href="#how">See how it works</a>
        </div>
      </div>

      <div class="demo-card" aria-hidden="true">
        <div class="demo-head">
          <span class="logo-mark"></span>
          <span class="name">shopdeals</span>
        </div>
        <div class="demo-input">
          <div class="input-fake">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            <span>Find me the best deal on AirPods Pro</span>
          </div>
          <span class="send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg></span>
        </div>

        <div class="progress-list">
          <div class="progress-item done">
            <span class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>
            Query received
          </div>
          <div class="progress-item done">
            <span class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>
            Checking ${merchantCount} trusted sellers
          </div>
          <div class="progress-item active">
            <span class="ring"></span>
            Cross-matching coupon codes
          </div>
          <div class="progress-item pending">
            <span class="ring"></span>
            Best deal ready
          </div>
        </div>

        <div class="seller-table">
          <div class="header">
            <div>Seller</div><div>Total</div><div>Code</div><div>Shipping</div>
          </div>
          <div class="row">
            <div class="seller-name">
              <img src="https://www.google.com/s2/favicons?domain=bestbuy.com&sz=64" alt="" />
              <span class="seller-name-text">Best Buy</span>
            </div>
            <div>$199.99</div>
            <div>—</div>
            <div>Free</div>
          </div>
          <div class="row best">
            <div class="seller-name">
              <img src="https://www.google.com/s2/favicons?domain=amazon.com&sz=64" alt="" />
              <span class="seller-name-text">Amazon<span class="badge">Best overall deal</span></span>
            </div>
            <div>$179.99</div>
            <div>SAVE20</div>
            <div>Free Prime</div>
          </div>
          <div class="row">
            <div class="seller-name">
              <img src="https://www.google.com/s2/favicons?domain=costco.com&sz=64" alt="" />
              <span class="seller-name-text">Costco</span>
            </div>
            <div>$189.00</div>
            <div>—</div>
            <div>$4.99</div>
          </div>
        </div>

        <button class="approve" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg>
          Open at Amazon
        </button>
      </div>
    </div>
  </div>
</section>

<section id="how">
  <div class="container">
    <div class="feature-block">
      <div class="chat-card">
        <div class="head"><span class="logo-mark"></span>shopdeals</div>
        <div class="chat-bubble user">Find me a deal on AirPods Pro</div>
        <div class="chat-bubble ai">
          On it! Comparing ${merchantCount} sellers and our coupon catalog now.
          <div class="typing"><span></span><span></span><span></span></div>
        </div>
      </div>
      <div>
        <h2>Ask in plain English.</h2>
        <p class="lede">Tell your AI what you're shopping for — it pings shopdeals, which compares sellers across our catalog and live Google Shopping, then hands back the best buy.</p>
        <ul class="bullet-list">
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>Works inside Claude, ChatGPT, and Cursor</li>
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>No checkout takeover — you click the buy</li>
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>Free forever for shoppers</li>
        </ul>
      </div>
    </div>

    <div class="feature-block reverse" id="trust">
      <div class="seller-table" style="background: white;">
        <div class="header">
          <div>Seller</div><div>Total</div><div>Code</div><div>Shipping</div>
        </div>
        <div class="row">
          <div class="seller-name">
            <img src="https://www.google.com/s2/favicons?domain=bestbuy.com&sz=64" alt="" />
            <span class="seller-name-text">Best Buy</span>
          </div>
          <div>$199.99</div>
          <div>—</div>
          <div>Free</div>
        </div>
        <div class="row best">
          <div class="seller-name">
            <img src="https://www.google.com/s2/favicons?domain=amazon.com&sz=64" alt="" />
            <span class="seller-name-text">Amazon<span class="badge">Best overall deal</span></span>
          </div>
          <div>$179.99</div>
          <div>SAVE20</div>
          <div>Free Prime</div>
        </div>
        <div class="row">
          <div class="seller-name">
            <img src="https://www.google.com/s2/favicons?domain=costco.com&sz=64" alt="" />
            <span class="seller-name-text">Costco</span>
          </div>
          <div>$189.00</div>
          <div>—</div>
          <div>$4.99</div>
        </div>
      </div>
      <div>
        <h2>See the full deal.</h2>
        <p class="lede">shopdeals compares total price, shipping, returns policy, and the code that actually applies — so the agent's answer is something you can act on, not a guess.</p>
        <ul class="bullet-list">
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>Merchant-verified codes (no scrape guesses)</li>
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>Total price with shipping &amp; tax visible</li>
          <li class="bullet"><span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>Agent telemetry kills codes that stop working</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="install-section" id="install">
  <div class="container">
    <h2>Use it where you already work.</h2>
    <p class="lede">Start instantly from your favorite AI workspace.</p>
    <div class="install-grid">
      <a class="install-card" href="#" id="install-claude">
        <span class="ico ico-claude">
          <!-- Claude / Anthropic mark -->
          <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><path d="M8.5 22.5h3.6l3.9-9.4 3.9 9.4h3.6L18 4h-4L8.5 22.5zm5-7.3 2.5-6.1 2.5 6.1h-5z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Claude</span>
          <span class="availability">Claude Desktop &amp; web — free</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      </a>
      <a class="install-card" href="#" id="install-chatgpt">
        <span class="ico ico-chatgpt">
          <!-- OpenAI / ChatGPT mark -->
          <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><path d="M28.6 13.2a7.4 7.4 0 0 0-.7-6 7.4 7.4 0 0 0-8-3.6 7.4 7.4 0 0 0-5.6-2.5 7.4 7.4 0 0 0-7.1 5.1 7.4 7.4 0 0 0-4.9 3.6 7.4 7.4 0 0 0 .9 8.7 7.4 7.4 0 0 0 .7 6 7.4 7.4 0 0 0 8 3.6 7.4 7.4 0 0 0 5.6 2.5 7.4 7.4 0 0 0 7.1-5.1 7.4 7.4 0 0 0 4.9-3.6 7.4 7.4 0 0 0-.9-8.7zM17.3 28.4a5.5 5.5 0 0 1-3.5-1.3l.2-.1 5.8-3.4a1 1 0 0 0 .5-.8v-8.2l2.5 1.4v6.8a5.5 5.5 0 0 1-5.5 5.5zM5.4 23.3a5.5 5.5 0 0 1-.7-3.7l.2.1 5.8 3.4a1 1 0 0 0 1 0l7.1-4.1v2.9l-5.9 3.4a5.5 5.5 0 0 1-7.5-2zM3.9 11.1a5.5 5.5 0 0 1 2.9-2.4v6.9a1 1 0 0 0 .5.9l7 4-2.4 1.4-5.9-3.4a5.5 5.5 0 0 1-2-7.4zm20 4.6-7-4 2.4-1.4 5.9 3.4a5.5 5.5 0 0 1-.9 9.9v-6.9a1 1 0 0 0-.5-.9zm2.5-3.7-.2-.1-5.8-3.4a1 1 0 0 0-1 0l-7.1 4.1V9.7l5.9-3.4a5.5 5.5 0 0 1 8.2 5.7zM11.5 17l-2.5-1.4V8.7a5.5 5.5 0 0 1 9-4.2l-.2.1L12 8a1 1 0 0 0-.5.8V17zm1.3-2.9 3.2-1.8 3.2 1.8V18l-3.2 1.8-3.2-1.8z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to ChatGPT</span>
          <span class="availability">via Custom Connectors · Plus / Pro</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      </a>
      <a class="install-card" href="#" id="install-cursor">
        <span class="ico ico-cursor">
          <!-- Cursor mark (stylized C) -->
          <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><path d="M16 3 4 9.4v13.2L16 29l12-6.4V9.4L16 3zm0 2.3 9.6 5.1L16 15.6 6.4 10.4 16 5.3zm-10 7.5 9 4.8v9.8l-9-4.8v-9.8zm20 9.8-9 4.8v-9.8l9-4.8v9.8z"/></svg>
        </span>
        <div class="text">
          <span class="label">Add to Cursor</span>
          <span class="availability">macOS · Windows · Linux</span>
        </div>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
      </a>
    </div>
  </div>
</section>

<section class="container">
  <div class="waitlist" id="waitlist">
    <h3>Get a heads-up when we launch big.</h3>
    <p>We're shipping every few days. Drop your email — one note when the hosted endpoint opens up early access. No newsletter, no upsell.</p>
    <form id="waitlist-form" novalidate>
      <input id="waitlist-email" type="email" required placeholder="your@email.com" autocomplete="email" />
      <button type="submit">Notify me</button>
    </form>
    <div class="status" id="waitlist-status" aria-live="polite"></div>
  </div>
</section>

<footer>
  <div class="container row">
    <div class="col-brand">
      <a class="logo" href="/">
        <span class="logo-mark"></span>
        shopdeals
      </a>
      <span class="tag">Your AI shopping agent.</span>
      <span class="live-pill"><span class="dot"></span>${ingestStatus} · ${dealCount} deals</span>
    </div>
    <div>
      <h4>Product</h4>
      <div class="links">
        <a href="#how">How it works</a>
        <a href="#trust">Safety</a>
        <a href="#install">Install</a>
      </div>
    </div>
    <div>
      <h4>Company</h4>
      <div class="links">
        <a href="https://github.com/idanmann10/snap-ai">GitHub</a>
        <a href="mailto:hello@shopdeals.sh">Contact</a>
      </div>
    </div>
    <div>
      <h4>Developers</h4>
      <div class="links">
        <a href="/api">API</a>
        <a href="/healthz">Status</a>
      </div>
    </div>
  </div>
</footer>

<!-- Modal openers for install snippets. Lightweight: just copy the snippet
     to clipboard and notify, no real modal. -->
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
  for (const [id, snippet] of Object.entries(SNIPPETS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(snippet);
        const label = el.querySelector('.label');
        const orig = label.textContent;
        label.textContent = 'Copied to clipboard';
        setTimeout(() => { label.textContent = orig; }, 1400);
      } catch {
        alert(snippet);
      }
    });
  }

  // Waitlist submit
  const form = document.getElementById('waitlist-form');
  const statusEl = document.getElementById('waitlist-status');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('waitlist-email');
    const email = (emailInput && emailInput.value || '').trim();
    if (!email || !email.includes('@')) {
      statusEl.textContent = 'Need a valid email.';
      statusEl.className = 'status err';
      return;
    }
    statusEl.textContent = 'Sending…';
    statusEl.className = 'status';
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing', referrer: document.referrer || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        statusEl.textContent = body.alreadyOnList ? "You're already on the list." : "You're in. We'll be in touch.";
        statusEl.className = 'status ok';
        if (emailInput) emailInput.value = '';
      } else {
        statusEl.textContent = body.error || 'Something went wrong. Try again?';
        statusEl.className = 'status err';
      }
    } catch {
      statusEl.textContent = 'Network blip. Try again?';
      statusEl.className = 'status err';
    }
  });
</script>
</body>
</html>`;
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
