/**
 * Server-rendered landing page. Single HTML string returned from `GET /`.
 * No SPA, no build step, no external image assets beyond Google Fonts.
 *
 * The hero leads with a chat-style mockup of "ask AI → get a deal card",
 * deliberately B2C in voice. Live counts (deals/merchants/freshness) come
 * from `loadLandingStats` so the page always looks alive even with a
 * single-digit catalog.
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
<title>Snap-AI — Find good deals online with your AI</title>
<meta name="description" content="Tell Claude, ChatGPT, or Cursor what you want. Snap-AI hands them working coupon codes and live prices so you save money without thinking about it." />
<meta property="og:title" content="Snap-AI — Find good deals online with your AI" />
<meta property="og:description" content="Tell Claude, ChatGPT, or Cursor what you want. Snap-AI hands them working codes and live prices." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" />
<style>
  :root {
    --bg: #fbfafe;
    --bg-card: #ffffff;
    --bg-soft: #f3f1fa;
    --ink: #110f1f;
    --ink-2: #4a4860;
    --ink-3: #8e8aa8;
    --line: #e7e4f0;
    --line-soft: #f0edf7;
    --brand: #5a4fcf;
    --brand-2: #7c70e8;
    --brand-soft: #ece9fb;
    --warm: #ff7a59;
    --green: #2f9e6b;
    --green-soft: #e3f5ec;
    --radius: 14px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
  body {
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  a { color: var(--brand); text-decoration: none; }
  a:hover { color: var(--ink); }
  ::selection { background: var(--brand); color: var(--bg); }

  .container { max-width: 1120px; margin: 0 auto; padding: 0 28px; }
  .container-narrow { max-width: 760px; margin: 0 auto; padding: 0 28px; }

  /* Top bar */
  header { padding: 22px 0; }
  header .row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .logo {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 17px; font-weight: 700; letter-spacing: -0.01em;
    color: var(--ink);
  }
  .logo-mark {
    width: 26px; height: 26px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%);
    display: inline-grid; place-items: center;
    color: white; font-weight: 800; font-size: 14px;
    box-shadow: 0 2px 8px rgba(90,79,207,0.25);
  }
  .nav { display: flex; gap: 22px; font-size: 14px; align-items: center; }
  .nav a { color: var(--ink-2); }
  .nav a:hover { color: var(--ink); }
  .nav-cta {
    padding: 8px 14px;
    background: var(--ink); color: var(--bg-card);
    border-radius: 999px; font-weight: 500;
  }
  .nav-cta:hover { background: var(--brand); color: var(--bg-card); }

  /* Hero */
  .hero {
    padding: 56px 0 60px;
    position: relative;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute;
    top: -180px; left: 50%; transform: translateX(-50%);
    width: 1000px; height: 700px;
    background: radial-gradient(ellipse at center, rgba(90,79,207,0.10) 0%, transparent 60%);
    pointer-events: none;
    z-index: 0;
  }
  .hero-inner { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  @media (max-width: 880px) { .hero-inner { grid-template-columns: 1fr; gap: 40px; } }

  .hero-tag {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    background: var(--brand-soft); color: var(--brand);
    border-radius: 999px; font-size: 12.5px; font-weight: 600;
    margin-bottom: 22px;
    letter-spacing: 0.01em;
  }
  h1.hero-title {
    font-weight: 800;
    font-size: clamp(40px, 5.5vw, 60px);
    line-height: 1.04;
    letter-spacing: -0.035em;
    margin: 0 0 20px;
    color: var(--ink);
  }
  h1.hero-title em { font-style: normal; color: var(--brand); }
  .hero-sub {
    font-size: clamp(17px, 1.4vw, 19px);
    color: var(--ink-2);
    max-width: 520px;
    margin: 0 0 28px;
    line-height: 1.55;
  }
  .cta-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: inherit; font-size: 14.5px; font-weight: 600;
    padding: 12px 20px; border-radius: 999px;
    border: 1px solid var(--ink); background: var(--ink); color: var(--bg-card);
    cursor: pointer;
    text-decoration: none;
    transition: transform .12s ease, background .12s ease, box-shadow .12s;
    box-shadow: 0 1px 0 rgba(17,15,31,0.05), 0 4px 14px rgba(17,15,31,0.08);
  }
  .btn:hover { background: var(--brand); border-color: var(--brand); color: white; transform: translateY(-1px); }
  .btn-ghost { background: var(--bg-card); color: var(--ink); border-color: var(--line); box-shadow: none; }
  .btn-ghost:hover { background: var(--bg-soft); color: var(--ink); border-color: var(--ink); }

  .trust-row {
    display: flex; gap: 22px; flex-wrap: wrap; margin-top: 28px;
    font-size: 13px; color: var(--ink-3);
  }
  .trust-row .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); display: inline-block; margin-right: 6px; vertical-align: 1px; }

  /* Chat mockup — replaces the old terminal block */
  .chat {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 22px 22px 26px;
    box-shadow: 0 4px 12px rgba(17,15,31,0.04), 0 24px 64px rgba(90,79,207,0.10);
    position: relative;
  }
  .chat-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line-soft);
    font-size: 12.5px; color: var(--ink-3);
  }
  .chat-head .tab-dot { width: 8px; height: 8px; border-radius: 50%; }
  .tab-dot.r { background: #ff6058; }
  .tab-dot.y { background: #ffbd2e; }
  .tab-dot.g { background: #27c93f; }
  .chat-head .title { margin-left: 10px; font-weight: 500; color: var(--ink-2); }

  .msg { display: flex; gap: 10px; margin-bottom: 14px; }
  .msg-avatar {
    width: 30px; height: 30px; border-radius: 50%;
    display: inline-grid; place-items: center;
    font-size: 12px; font-weight: 700; color: white; flex-shrink: 0;
  }
  .msg-avatar.user { background: linear-gradient(135deg, #ffaf6b, #ff7a59); }
  .msg-avatar.ai { background: linear-gradient(135deg, var(--brand), var(--brand-2)); }
  .msg-bubble {
    background: var(--bg-soft);
    border-radius: 14px;
    padding: 10px 14px;
    font-size: 14.5px;
    color: var(--ink);
    line-height: 1.5;
  }
  .msg.ai .msg-bubble {
    background: var(--bg-card);
    border: 1px solid var(--line);
    padding: 14px;
  }
  .msg.ai .msg-bubble .lead { margin: 0 0 12px; color: var(--ink-2); font-size: 14px; }

  /* Deal card inside the AI message */
  .deal-card {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    display: grid; grid-template-columns: 44px 1fr auto; gap: 14px; align-items: center;
    background: linear-gradient(180deg, #ffffff, #fbfaff);
    transition: transform .12s;
  }
  .deal-card + .deal-card { margin-top: 8px; }
  .deal-card:hover { transform: translateY(-1px); border-color: var(--brand); }
  .merchant-logo {
    width: 44px; height: 44px; border-radius: 10px;
    display: inline-grid; place-items: center;
    font-weight: 800; font-size: 16px; color: white;
    letter-spacing: -0.02em;
  }
  .logo-amazon { background: linear-gradient(135deg,#ff9900,#ffac3a); }
  .logo-bestbuy { background: linear-gradient(135deg,#0046be,#0066d6); }
  .logo-costco { background: linear-gradient(135deg,#e31837,#c4142d); }
  .logo-target { background: linear-gradient(135deg,#cc0000,#ff1a1a); }
  .logo-walmart { background: linear-gradient(135deg,#0071ce,#0084e8); }
  .deal-card .title { font-size: 13.5px; font-weight: 600; color: var(--ink); margin: 0; line-height: 1.4; }
  .deal-card .meta { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .deal-card .meta strong { color: var(--green); font-weight: 600; }
  .deal-card .meta .was { text-decoration: line-through; margin-right: 6px; }
  .deal-card .right { text-align: right; }
  .deal-card .price { font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; }
  .deal-card .code {
    display: inline-flex; align-items: center; gap: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; font-weight: 500;
    background: var(--green-soft); color: var(--green);
    padding: 3px 8px; border-radius: 6px;
    margin-top: 4px;
  }
  .more-deals { font-size: 13px; color: var(--ink-3); margin-top: 12px; }
  .more-deals strong { color: var(--ink-2); font-weight: 600; }

  /* Sections */
  section.block { padding: 76px 0; border-top: 1px solid var(--line); }
  .eyebrow {
    font-size: 13px; font-weight: 600;
    color: var(--brand);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 14px;
  }
  h2.section-title {
    font-weight: 700;
    font-size: clamp(30px, 4vw, 42px);
    line-height: 1.1;
    letter-spacing: -0.025em;
    margin: 0 0 16px;
  }
  h2.section-title em { font-style: normal; color: var(--brand); }
  .section-lede {
    font-size: 17px;
    color: var(--ink-2);
    max-width: 620px;
    margin-bottom: 44px;
  }

  /* Install grid */
  .install-grid { display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 880px) { .install-grid { grid-template-columns: 1fr; } }
  .install-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 22px;
    display: flex; flex-direction: column;
    transition: border-color .12s, transform .12s;
  }
  .install-card:hover { border-color: var(--brand); transform: translateY(-2px); }
  .install-card h3 {
    font-size: 15px; font-weight: 700;
    margin: 0 0 4px; display: flex; align-items: center; gap: 10px;
  }
  .install-card .icon {
    width: 28px; height: 28px; border-radius: 8px;
    display: inline-grid; place-items: center; color: white;
  }
  .icon-claude { background: linear-gradient(135deg,#d97757,#e07a35); }
  .icon-chatgpt { background: linear-gradient(135deg,#10a37f,#1ec48d); }
  .icon-cursor { background: linear-gradient(135deg,#1e1e2c,#2d2d4a); }
  .install-card .availability {
    font-size: 12px; color: var(--ink-3); margin-bottom: 14px;
  }
  pre.snippet {
    margin: 0 0 14px;
    background: #14131f; color: #e8e5f5;
    padding: 14px 16px; border-radius: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; line-height: 1.6;
    overflow-x: auto;
    position: relative; flex: 1;
  }
  pre.snippet .copy {
    position: absolute; top: 8px; right: 8px;
    font-size: 10.5px; padding: 4px 10px;
    background: rgba(255,255,255,0.07); color: #e8e5f5;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 6px; cursor: pointer; font-family: inherit;
    transition: background .12s;
  }
  pre.snippet .copy:hover { background: rgba(255,255,255,0.18); }
  pre.snippet .copy.ok { background: rgba(47,158,107,0.32); }
  .install-card .help { font-size: 13px; color: var(--ink-3); margin: 0; }
  .install-card .help a { color: var(--ink-2); border-bottom: 1px solid var(--line); }
  .install-card .help a:hover { color: var(--ink); border-color: var(--ink); }

  /* Stats strip */
  .stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
    background: var(--ink); color: var(--bg-card);
    border-radius: 18px;
    overflow: hidden;
    margin-top: 36px;
  }
  @media (max-width: 700px) { .stats { grid-template-columns: 1fr; } }
  .stat { padding: 28px 24px; }
  .stat:not(:last-child) {
    border-right: 1px solid rgba(255,255,255,0.08);
  }
  @media (max-width: 700px) { .stat:not(:last-child) { border-right: none; border-bottom: 1px solid rgba(255,255,255,0.08); } }
  .stat .num {
    font-size: 36px; font-weight: 800;
    letter-spacing: -0.025em;
    margin-bottom: 4px;
    color: white;
  }
  .stat .num .accent { color: var(--brand-2); }
  .stat .label { font-size: 13px; color: rgba(255,255,255,0.6); font-weight: 500; }

  /* Features */
  .features-grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 880px) { .features-grid { grid-template-columns: 1fr; } }
  .feature {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 26px;
    transition: border-color .12s;
  }
  .feature:hover { border-color: var(--brand); }
  .feature .ficon {
    width: 38px; height: 38px; border-radius: 10px;
    background: var(--brand-soft); color: var(--brand);
    display: inline-grid; place-items: center;
    margin-bottom: 14px;
  }
  .feature .ficon svg { width: 18px; height: 18px; }
  .feature h3 { font-size: 16px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em; }
  .feature p { margin: 0; color: var(--ink-2); font-size: 14.5px; line-height: 1.55; }

  /* Waitlist */
  .waitlist-card {
    background: linear-gradient(135deg, #1d1a32, #14131f);
    color: var(--bg-card);
    border-radius: 20px;
    padding: 48px 44px;
    margin-top: 12px;
    position: relative; overflow: hidden;
  }
  .waitlist-card::after {
    content: '';
    position: absolute; top: -120px; right: -120px;
    width: 360px; height: 360px;
    background: radial-gradient(circle, rgba(124,112,232,0.25) 0%, transparent 70%);
    pointer-events: none;
  }
  .waitlist-inner { position: relative; max-width: 560px; }
  .waitlist-card h3 {
    font-size: 28px; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.02em;
  }
  .waitlist-card p { color: rgba(255,255,255,0.7); margin: 0 0 22px; font-size: 15px; }
  .waitlist-card form { display: flex; gap: 8px; max-width: 480px; }
  .waitlist-card input[type=email] {
    flex: 1;
    padding: 13px 18px;
    font-family: inherit; font-size: 14.5px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.16);
    color: white;
    border-radius: 999px;
    outline: none;
    transition: border-color .12s, background .12s;
  }
  .waitlist-card input[type=email]::placeholder { color: rgba(255,255,255,0.45); }
  .waitlist-card input[type=email]:focus { border-color: white; background: rgba(255,255,255,0.14); }
  .waitlist-card button {
    padding: 13px 24px;
    font-family: inherit; font-size: 14.5px; font-weight: 600;
    background: white; color: var(--ink);
    border: none; border-radius: 999px;
    cursor: pointer;
    transition: transform .12s;
  }
  .waitlist-card button:hover { transform: translateY(-1px); }
  .waitlist-card .status {
    margin-top: 14px; font-size: 13.5px; color: rgba(255,255,255,0.65);
    min-height: 1.3em;
  }
  .waitlist-card .status.ok { color: #9be5be; }
  .waitlist-card .status.err { color: #ffb3a8; }

  /* Footer */
  footer { padding: 48px 0 56px; color: var(--ink-3); font-size: 13.5px; }
  footer .row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; }
  footer .links { display: flex; gap: 22px; }
  footer a { color: var(--ink-3); }
  footer a:hover { color: var(--ink); }
</style>
</head>
<body>

<header>
  <div class="container row">
    <a class="logo" href="/">
      <span class="logo-mark">S</span>
      Snap-AI
    </a>
    <nav class="nav">
      <a href="#how">How it works</a>
      <a href="#install">Install</a>
      <a class="nav-cta" href="#waitlist">Get notified</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="container">
    <div class="hero-inner">
      <div>
        <span class="hero-tag">${ingestStatus} · ${dealCount} deals live</span>
        <h1 class="hero-title">Find good deals online with <em>your AI.</em></h1>
        <p class="hero-sub">Tell Claude, ChatGPT, or Cursor what you want. Snap-AI hands them working codes and live prices — you save money without thinking about it. Free.</p>
        <div class="cta-row">
          <a class="btn" href="#install">Add to your AI →</a>
          <a class="btn btn-ghost" href="#how">See how it works</a>
        </div>
        <div class="trust-row">
          <span><span class="dot"></span>Free, no signup</span>
          <span><span class="dot"></span>Verified codes</span>
          <span><span class="dot"></span>Real merchant links</span>
        </div>
      </div>

      <div class="chat" aria-hidden="true">
        <div class="chat-head">
          <span class="tab-dot r"></span>
          <span class="tab-dot y"></span>
          <span class="tab-dot g"></span>
          <span class="title">claude · snap-ai connected</span>
        </div>
        <div class="msg">
          <span class="msg-avatar user">U</span>
          <div class="msg-bubble">Find me a deal on AirPods Pro</div>
        </div>
        <div class="msg ai">
          <span class="msg-avatar ai">AI</span>
          <div class="msg-bubble">
            <p class="lead">Here's the best price I found right now:</p>
            <div class="deal-card">
              <span class="merchant-logo logo-amazon">A</span>
              <div>
                <p class="title">Apple AirPods Pro (2nd&nbsp;Gen) with USB-C</p>
                <p class="meta"><span class="was">$249</span><strong>save $60</strong> · in stock</p>
                <span class="code">code: SAVE60</span>
              </div>
              <div class="right">
                <div class="price">$189</div>
              </div>
            </div>
            <div class="deal-card">
              <span class="merchant-logo logo-bestbuy">BB</span>
              <div>
                <p class="title">AirPods Pro 2 · open-box</p>
                <p class="meta"><span class="was">$249</span><strong>save $50</strong> · ships free</p>
              </div>
              <div class="right">
                <div class="price">$199</div>
              </div>
            </div>
            <div class="more-deals">+ 2 more from <strong>Costco</strong> and <strong>Target</strong>.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="block" id="how">
  <div class="container">
    <div class="eyebrow">How it works</div>
    <h2 class="section-title">Three things <em>your AI</em> didn't have before.</h2>
    <p class="section-lede">Snap-AI is a small server your agent talks to. It pulls deal feeds from affiliate networks, community-curated sites, and live shopping search — then hands your AI the codes and links that actually work.</p>
    <div class="features-grid">
      <div class="feature">
        <div class="ficon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div>
        <h3>Search every store at once.</h3>
        <p>Filter by merchant, price, category, country. We index thousands of deals across 80+ affiliate networks plus Google Shopping fallback.</p>
      </div>
      <div class="feature">
        <div class="ficon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>
        <h3>Real working codes.</h3>
        <p>Codes come from merchant-verified affiliate feeds. Every checkout pings us — codes that stop working get pulled automatically.</p>
      </div>
      <div class="feature">
        <div class="ficon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <h3>Built for speed.</h3>
        <p>Median <strong>4&nbsp;ms</strong> search. Your AI gets answers as fast as it can ask. No webview, no scraping, no waiting.</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="num"><span class="accent">${dealCount}</span></div><div class="label">deals indexed right now</div></div>
      <div class="stat"><div class="num"><span class="accent">${merchantCount}</span></div><div class="label">merchants with active deals</div></div>
      <div class="stat"><div class="num"><span class="accent">~4ms</span></div><div class="label">median search latency</div></div>
    </div>
  </div>
</section>

<section class="block" id="install">
  <div class="container">
    <div class="eyebrow">Install</div>
    <h2 class="section-title">Add Snap-AI to <em>your AI</em> in 60 seconds.</h2>
    <p class="section-lede">Pick your assistant. Paste one snippet. Done. No account, no API key — free while we're early.</p>
    <div class="install-grid">
      <div class="install-card">
        <h3><span class="icon icon-claude"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 110 12 6 6 0 010-12z"/></svg></span>Claude Desktop</h3>
        <div class="availability">macOS &amp; Windows · works today</div>
<pre class="snippet"><button class="copy" data-copy="claude">Copy</button><span id="claude-snippet">{
  "mcpServers": {
    "snap-ai": {
      "command": "npx",
      "args": ["-y", "mcp-remote",
               "https://mcp.snap-ai.dev/mcp"]
    }
  }
}</span></pre>
        <p class="help">Paste into <a href="https://docs.anthropic.com/en/docs/claude-code/mcp" target="_blank" rel="noopener">claude_desktop_config.json</a>, restart Claude.</p>
      </div>
      <div class="install-card">
        <h3><span class="icon icon-chatgpt"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.45a4 4 0 00-3.45-2A4 4 0 0015.56 9 4 4 0 0012 7a4 4 0 00-3.56 2A4 4 0 005.17 7.45a4 4 0 00-3.45 2 4 4 0 00.45 4.55l9.1 8.55a1 1 0 001.46 0l9.1-8.55a4 4 0 00.45-4.55z"/></svg></span>ChatGPT</h3>
        <div class="availability">Custom Connectors · Plus/Pro</div>
<pre class="snippet"><button class="copy" data-copy="chatgpt">Copy</button><span id="chatgpt-snippet">https://mcp.snap-ai.dev/mcp

Settings → Connectors →
Add custom connector → paste URL</span></pre>
        <p class="help">Connectors are a paid-plan feature on chatgpt.com. Same URL — different UI.</p>
      </div>
      <div class="install-card">
        <h3><span class="icon icon-cursor"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4l9 5 9-5v3l-9 5-9-5V4zm0 7l9 5 9-5v3l-9 5-9-5v-3z"/></svg></span>Cursor</h3>
        <div class="availability">macOS · Windows · Linux</div>
<pre class="snippet"><button class="copy" data-copy="cursor">Copy</button><span id="cursor-snippet">{
  "mcpServers": {
    "snap-ai": {
      "url": "https://mcp.snap-ai.dev/mcp"
    }
  }
}</span></pre>
        <p class="help">Paste into <code>~/.cursor/mcp.json</code> — agent picks it up immediately.</p>
      </div>
    </div>
  </div>
</section>

<section class="block" id="waitlist">
  <div class="container">
    <div class="waitlist-card">
      <div class="waitlist-inner">
        <h3>Get a heads-up when we launch big.</h3>
        <p>We're shipping every few days. Drop your email — we'll ping you when we open up early access on a hosted endpoint and again if we ship something noteworthy. No newsletter, no upsell.</p>
        <form id="waitlist-form" novalidate>
          <input id="waitlist-email" type="email" required placeholder="your@email.com" autocomplete="email" />
          <button type="submit">Get notified</button>
        </form>
        <div class="status" id="waitlist-status" aria-live="polite"></div>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="container row">
    <div>© 2026 Snap-AI · MIT licensed · made for agents</div>
    <div class="links">
      <a href="https://github.com/idanmann10/snap-ai" rel="noopener">GitHub</a>
      <a href="/api">API</a>
      <a href="/healthz">Status</a>
    </div>
  </div>
</footer>

<script>
  document.querySelectorAll('button.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-copy');
      const node = document.getElementById(key + '-snippet');
      if (!node) return;
      try {
        await navigator.clipboard.writeText(node.textContent || '');
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('ok');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1400);
      } catch {
        btn.textContent = 'Press Cmd+C';
      }
    });
  });

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
