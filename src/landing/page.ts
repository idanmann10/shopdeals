/**
 * Server-rendered landing page for snap-ai.dev. No SPA, no build step — just
 * a single HTML string returned from `GET /`. Inline styles and a tiny bit of
 * inline JS keep cold cache loads under 50KB.
 *
 * Visual reference: era.app — warm cream background, serif headlines, soft
 * gradients, lots of whitespace. The hero pitches the agent-commerce angle;
 * everything below is utilitarian (tools, setup snippet, waitlist).
 */

export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Snap-AI — Working coupon codes for AI agents</title>
<meta name="description" content="An open-source MCP server that gives AI agents real, merchant-verified coupon codes and deals. No scraping, no broken codes." />
<meta property="og:title" content="Snap-AI — Working coupon codes for AI agents" />
<meta property="og:description" content="MCP server for Claude, ChatGPT, and Cursor. Real coupons, real deals, real attribution." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
<style>
  :root {
    --bg: #f5f1ea;
    --bg-soft: #ede7dc;
    --ink: #1a1a1a;
    --ink-soft: #5a5550;
    --line: #d8d1c4;
    --accent: #2d3a2e;
    --accent-soft: #f0ece1;
    --code-bg: #1a1a1a;
    --code-ink: #f5f1ea;
    --radius: 14px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 17px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); transition: border-color .15s; }
  a:hover { border-color: var(--ink); }
  ::selection { background: var(--accent); color: var(--bg); }

  .container { max-width: 1080px; margin: 0 auto; padding: 0 32px; }
  .container-narrow { max-width: 760px; margin: 0 auto; padding: 0 32px; }

  header {
    padding: 28px 0;
    border-bottom: 1px solid transparent;
  }
  header .row {
    display: flex; align-items: center; justify-content: space-between;
  }
  .logo {
    font-family: 'Instrument Serif', serif;
    font-size: 26px;
    letter-spacing: -0.01em;
    border: none;
  }
  .logo .dot { color: var(--accent); }
  .nav { display: flex; gap: 28px; font-size: 15px; }
  .nav a { border: none; color: var(--ink-soft); }
  .nav a:hover { color: var(--ink); }

  /* Hero */
  .hero {
    padding: 80px 0 100px;
    position: relative;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute;
    top: -200px; left: 50%;
    width: 800px; height: 800px;
    transform: translateX(-50%);
    background: radial-gradient(circle, rgba(45,58,46,0.08) 0%, transparent 60%);
    pointer-events: none;
  }
  .hero .container-narrow { position: relative; text-align: center; }
  .eyebrow {
    display: inline-block;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft);
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--accent-soft);
    margin-bottom: 32px;
    letter-spacing: 0.02em;
  }
  .eyebrow .pulse {
    display: inline-block; width: 6px; height: 6px;
    background: var(--accent); border-radius: 50%; margin-right: 8px;
    vertical-align: 1px;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  h1.hero-title {
    font-family: 'Instrument Serif', serif;
    font-weight: 400;
    font-size: clamp(48px, 8vw, 88px);
    line-height: 1.02;
    letter-spacing: -0.025em;
    margin: 0 0 28px;
  }
  h1.hero-title em {
    font-style: italic;
    color: var(--accent);
  }
  .hero-sub {
    font-size: clamp(18px, 2vw, 22px);
    color: var(--ink-soft);
    max-width: 560px;
    margin: 0 auto 48px;
    line-height: 1.45;
  }
  .cta-row {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: inherit; font-size: 15px; font-weight: 500;
    padding: 14px 24px; border-radius: 999px;
    border: 1px solid var(--ink); background: var(--ink); color: var(--bg);
    cursor: pointer;
    transition: transform .12s ease, background .12s ease;
  }
  .btn:hover { transform: translateY(-1px); background: var(--accent); border-color: var(--accent); }
  .btn-secondary {
    background: transparent; color: var(--ink);
    border: 1px solid var(--line);
  }
  .btn-secondary:hover { background: var(--bg-soft); border-color: var(--ink); }
  .btn svg { width: 14px; height: 14px; }

  /* Sections */
  section.block {
    padding: 80px 0;
    border-top: 1px solid var(--line);
  }
  .section-eyebrow {
    font-size: 13px; font-weight: 500;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 16px;
  }
  h2.section-title {
    font-family: 'Instrument Serif', serif;
    font-weight: 400;
    font-size: clamp(36px, 5vw, 52px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 0 0 24px;
  }
  h2.section-title em { font-style: italic; color: var(--accent); }
  .section-lede {
    font-size: 19px;
    color: var(--ink-soft);
    max-width: 640px;
    margin-bottom: 56px;
  }

  /* Why */
  .why-grid {
    display: grid; gap: 24px;
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 800px) { .why-grid { grid-template-columns: 1fr; } }
  .why-card {
    padding: 32px;
    background: var(--bg-soft);
    border-radius: var(--radius);
    border: 1px solid var(--line);
  }
  .why-card .num {
    font-family: 'Instrument Serif', serif;
    font-style: italic;
    font-size: 38px;
    color: var(--accent);
    line-height: 1;
    margin-bottom: 16px;
  }
  .why-card h3 {
    font-family: 'Instrument Serif', serif;
    font-weight: 400;
    font-size: 24px;
    margin: 0 0 10px;
    letter-spacing: -0.01em;
  }
  .why-card p { margin: 0; color: var(--ink-soft); font-size: 15px; line-height: 1.55; }

  /* Tools */
  .tools-grid { display: grid; gap: 16px; }
  .tool {
    display: grid;
    grid-template-columns: 220px 1fr auto;
    gap: 24px;
    align-items: center;
    padding: 24px;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    transition: transform .12s ease, border-color .12s ease;
  }
  .tool:hover { transform: translateY(-1px); border-color: var(--ink); }
  @media (max-width: 700px) {
    .tool { grid-template-columns: 1fr; }
    .tool .tool-code { font-size: 12px; }
  }
  .tool .tool-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent);
  }
  .tool .tool-desc {
    font-size: 15px; color: var(--ink-soft); margin: 0;
  }
  .tool-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  /* Setup */
  .setup-grid {
    display: grid; gap: 28px; grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 800px) { .setup-grid { grid-template-columns: 1fr; } }
  .setup-card {
    padding: 28px;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .setup-card h3 {
    margin: 0 0 16px;
    font-size: 17px;
    display: flex; align-items: center; gap: 10px;
  }
  pre.code {
    margin: 0;
    background: var(--code-bg);
    color: var(--code-ink);
    border-radius: 10px;
    padding: 18px 20px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
    position: relative;
  }
  pre.code .copy {
    position: absolute; top: 10px; right: 10px;
    font-size: 11px;
    padding: 4px 10px;
    background: rgba(255,255,255,0.08);
    color: var(--code-ink);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    transition: background .15s;
  }
  pre.code .copy:hover { background: rgba(255,255,255,0.18); }
  pre.code .copy.ok { background: rgba(135,165,135,0.3); }

  /* Waitlist */
  .wait {
    background: var(--accent);
    color: var(--bg);
    padding: 80px 0;
    border-radius: 0;
    text-align: center;
    border-top: 1px solid var(--accent);
  }
  .wait h2 {
    font-family: 'Instrument Serif', serif;
    font-weight: 400;
    font-size: clamp(36px, 5vw, 56px);
    margin: 0 0 16px;
    color: var(--bg);
    letter-spacing: -0.02em;
  }
  .wait h2 em { font-style: italic; }
  .wait p {
    color: rgba(245, 241, 234, 0.75);
    font-size: 18px;
    margin: 0 auto 40px;
    max-width: 520px;
  }
  .wait form {
    display: flex; gap: 8px;
    max-width: 460px; margin: 0 auto;
  }
  .wait input[type=email] {
    flex: 1;
    padding: 14px 20px;
    font-family: inherit; font-size: 15px;
    background: rgba(245, 241, 234, 0.08);
    border: 1px solid rgba(245, 241, 234, 0.2);
    color: var(--bg);
    border-radius: 999px;
    outline: none;
    transition: border-color .15s, background .15s;
  }
  .wait input[type=email]::placeholder { color: rgba(245, 241, 234, 0.45); }
  .wait input[type=email]:focus {
    border-color: var(--bg);
    background: rgba(245, 241, 234, 0.14);
  }
  .wait button {
    padding: 14px 28px;
    font-family: inherit; font-size: 15px; font-weight: 500;
    background: var(--bg);
    color: var(--accent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition: transform .12s;
  }
  .wait button:hover { transform: translateY(-1px); }
  .wait .status {
    margin-top: 18px;
    font-size: 14px;
    color: rgba(245, 241, 234, 0.7);
    min-height: 1.4em;
  }
  .wait .status.ok { color: #c9e0c9; }
  .wait .status.err { color: #f0c0c0; }

  /* Footer */
  footer {
    padding: 48px 0 64px;
    color: var(--ink-soft);
    font-size: 14px;
  }
  footer .row {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;
  }
  footer .links { display: flex; gap: 24px; }

  /* fade-in on scroll */
  .fade { opacity: 0; transform: translateY(20px); transition: opacity .7s ease, transform .7s ease; }
  .fade.in { opacity: 1; transform: none; }
</style>
</head>
<body>

<header>
  <div class="container row">
    <a href="/" class="logo">snap<span class="dot">·</span>ai</a>
    <nav class="nav">
      <a href="#tools">Tools</a>
      <a href="#setup">Setup</a>
      <a href="https://github.com/idanmann10/snap-ai" rel="noopener">GitHub</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="container-narrow">
    <span class="eyebrow"><span class="pulse"></span>Open-source · MCP · v0.1</span>
    <h1 class="hero-title">Coupon codes that <em>actually work,</em> for AI agents.</h1>
    <p class="hero-sub">A single MCP endpoint that gives Claude, ChatGPT, and Cursor real, merchant-verified deals — pulled from affiliate-network feeds, not scraped. Free while we're new.</p>
    <div class="cta-row">
      <button class="btn" onclick="document.getElementById('waitlist-email')?.focus()">
        Join the waitlist
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
      </button>
      <a class="btn btn-secondary" href="https://github.com/idanmann10/snap-ai" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.79.61-3.37-1.34-3.37-1.34-.46-1.17-1.12-1.48-1.12-1.48-.91-.62.07-.61.07-.61 1 .07 1.53 1.04 1.53 1.04.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.1.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.56 9.56 0 0 1 12 6.8c.85 0 1.71.11 2.51.33 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>
        Star on GitHub
      </a>
    </div>
  </div>
</section>

<section class="block" id="why">
  <div class="container">
    <div class="section-eyebrow">Why now</div>
    <h2 class="section-title">Honey broke. <em>Agents are next.</em></h2>
    <p class="section-lede">Honey lost its affiliate partnerships after attribution-stripping incidents — and independent audits put the code success rate around 33%. Meanwhile zero MCP servers exist for deals. Agents will buy a trillion dollars of stuff in the next decade. Someone needs to give them codes that actually work.</p>
    <div class="why-grid">
      <div class="why-card fade">
        <div class="num">01</div>
        <h3>Merchant-verified.</h3>
        <p>Codes come from affiliate-network feeds (FMTC, Awin, Impact, Slickdeals) — the same data merchants upload themselves. No browser-scraped guesses.</p>
      </div>
      <div class="why-card fade">
        <div class="num">02</div>
        <h3>Attribution that doesn't strip.</h3>
        <p>Every deal returned through the MCP carries an <code>attributionSource</code> field. The publisher who surfaced the code gets paid. Full stop.</p>
      </div>
      <div class="why-card fade">
        <div class="num">03</div>
        <h3>Telemetry, not vibes.</h3>
        <p>Every checkout reports back whether the code worked. Stale codes get culled automatically — the ranking is real success, not the freshest scrape.</p>
      </div>
    </div>
  </div>
</section>

<section class="block" id="tools">
  <div class="container">
    <div class="section-eyebrow">Five tools, one endpoint</div>
    <h2 class="section-title">Built for <em>agents,</em> not browsers.</h2>
    <p class="section-lede">No SDK. No webview. Just five MCP tools that your agent calls like any other function. Returns are plain JSON.</p>
    <div class="tools-grid">
      <div class="tool"><div class="tool-name">find_deals</div><p class="tool-desc">Search active deals by merchant, domain, or category.</p><div class="tool-code">{ merchant: "nike", country: "US" }</div></div>
      <div class="tool"><div class="tool-name">get_deal</div><p class="tool-desc">Fetch a single deal — including stack rules and attribution.</p><div class="tool-code">{ dealId: "9b1c…" }</div></div>
      <div class="tool"><div class="tool-name">list_merchants</div><p class="tool-desc">Browse merchants with at least one active deal right now.</p><div class="tool-code">{ category: "apparel" }</div></div>
      <div class="tool"><div class="tool-name">get_price_history</div><p class="tool-desc">Amazon ASIN price history with 30/90/all-time lows — Keepa-backed, auto-refreshed.</p><div class="tool-code">{ asin: "B0CHX1W1XY" }</div></div>
      <div class="tool"><div class="tool-name">report_code_result</div><p class="tool-desc">Tell the server whether a code worked at checkout. Feeds the success-rate ranking.</p><div class="tool-code">{ worked: true }</div></div>
    </div>
  </div>
</section>

<section class="block" id="setup">
  <div class="container">
    <div class="section-eyebrow">Setup</div>
    <h2 class="section-title">Two lines. <em>One JSON.</em></h2>
    <p class="section-lede">Paste this into your MCP config and restart. No API key required while we're in early access.</p>
    <div class="setup-grid">
      <div class="setup-card">
        <h3>Claude Desktop</h3>
<pre class="code"><button class="copy" data-copy="claude">Copy</button><span id="claude-snippet">{
  "mcpServers": {
    "snap-ai": {
      "command": "npx",
      "args": ["-y", "mcp-remote",
               "https://mcp.snap-ai.dev/mcp"]
    }
  }
}</span></pre>
      </div>
      <div class="setup-card">
        <h3>Cursor</h3>
<pre class="code"><button class="copy" data-copy="cursor">Copy</button><span id="cursor-snippet">{
  "mcpServers": {
    "snap-ai": {
      "url": "https://mcp.snap-ai.dev/mcp"
    }
  }
}</span></pre>
      </div>
    </div>
  </div>
</section>

<section class="wait" id="waitlist">
  <div class="container-narrow">
    <h2>Get a key when we <em>open access.</em></h2>
    <p>We're onboarding agent builders first. Drop your email — no spam, no upsell, one note when your key is ready.</p>
    <form id="waitlist-form" novalidate>
      <input id="waitlist-email" type="email" required placeholder="your@email.com" autocomplete="email" />
      <button type="submit">Get notified</button>
    </form>
    <div class="status" id="waitlist-status" aria-live="polite"></div>
  </div>
</section>

<footer>
  <div class="container row">
    <div>© 2026 Snap-AI · MIT licensed</div>
    <div class="links">
      <a href="https://github.com/idanmann10/snap-ai" rel="noopener">GitHub</a>
      <a href="/api">API</a>
      <a href="/healthz">Status</a>
    </div>
  </div>
</footer>

<script>
  // Copy-to-clipboard for setup snippets.
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

  // Waitlist submission.
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

  // Soft fade-in on scroll.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add('in');
  }, { threshold: 0.15 });
  document.querySelectorAll('.fade').forEach((el) => io.observe(el));
</script>
</body>
</html>`;
}
