/**
 * Server-rendered landing page. Single HTML string returned from `GET /` —
 * no SPA, no build step.
 *
 * The page accepts a `LandingData` shape so the server can stamp in live
 * numbers (deals indexed, merchants covered) at render time. Falling back
 * to plausible defaults when the caller doesn't pass them keeps the
 * function safe to call from tests that don't touch the DB.
 */

export interface LandingData {
  /** Total active deals indexed right now. */
  dealCount?: number;
  /** Total merchants with at least one active deal. */
  merchantCount?: number;
  /** Hours since the most recent ingest_runs row finished successfully. */
  lastIngestHoursAgo?: number;
}

export function landingHtml(data: LandingData = {}): string {
  const dealCount = formatThousands(data.dealCount ?? 0);
  const merchantCount = formatThousands(data.merchantCount ?? 0);
  const ingestStatus = formatIngestStatus(data.lastIngestHoursAgo);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Snap-AI — Tell Claude to find you the deal.</title>
<meta name="description" content="An MCP server that gives Claude, ChatGPT, and Cursor working coupon codes and merchant-verified deals. Free." />
<meta property="og:title" content="Snap-AI — Tell Claude to find you the deal" />
<meta property="og:description" content="MCP server for Claude, ChatGPT, and Cursor. Working codes, real deal links, free." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
<style>
  :root {
    --bg: #faf8f4;
    --bg-card: #ffffff;
    --bg-soft: #f1ede5;
    --ink: #14130f;
    --ink-2: #4a463e;
    --ink-3: #8b8579;
    --line: #e3ddd0;
    --accent: #c8503a;
    --code-bg: #14130f;
    --code-ink: #faf8f4;
    --radius: 10px;
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
  a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; transition: text-decoration-color .12s; }
  a:hover { text-decoration-color: var(--accent); }
  ::selection { background: var(--ink); color: var(--bg); }

  .container { max-width: 1040px; margin: 0 auto; padding: 0 28px; }
  .container-narrow { max-width: 720px; margin: 0 auto; padding: 0 28px; }

  /* Top bar */
  header {
    padding: 24px 0;
  }
  header .row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 24px;
  }
  .logo {
    font-family: 'Newsreader', serif;
    font-size: 22px;
    font-style: italic;
    letter-spacing: -0.01em;
    text-decoration: none;
    color: var(--ink);
  }
  .nav { display: flex; gap: 22px; font-size: 14px; align-items: baseline; }
  .nav a { color: var(--ink-2); text-decoration: none; }
  .nav a:hover { color: var(--ink); }
  .live-pill {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--ink-3);
    padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px;
    background: var(--bg-card);
  }
  .live-pill .dot {
    width: 6px; height: 6px; border-radius: 50%; background: #5b9d6f;
    box-shadow: 0 0 0 0 rgba(91,157,111,0.5);
    animation: dot-pulse 2.4s ease-out infinite;
  }
  @keyframes dot-pulse {
    0% { box-shadow: 0 0 0 0 rgba(91,157,111,0.5); }
    100% { box-shadow: 0 0 0 8px rgba(91,157,111,0); }
  }

  /* Hero */
  .hero { padding: 56px 0 72px; }
  h1.hero-title {
    font-family: 'Newsreader', serif;
    font-weight: 400;
    font-size: clamp(40px, 6.5vw, 72px);
    line-height: 1.04;
    letter-spacing: -0.025em;
    margin: 0 0 24px;
    color: var(--ink);
  }
  h1.hero-title .italic { font-style: italic; }
  .hero-sub {
    font-size: clamp(17px, 1.5vw, 19px);
    color: var(--ink-2);
    max-width: 540px;
    margin: 0 0 36px;
    line-height: 1.5;
  }
  .cta-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: inherit; font-size: 14px; font-weight: 500;
    padding: 11px 18px; border-radius: 8px;
    border: 1px solid var(--ink); background: var(--ink); color: var(--bg);
    cursor: pointer;
    text-decoration: none;
    transition: transform .1s ease, background .1s ease;
  }
  .btn:hover { background: var(--accent); border-color: var(--accent); text-decoration: none; }
  .btn-ghost {
    background: transparent; color: var(--ink); border: 1px solid var(--line);
  }
  .btn-ghost:hover { background: var(--bg-card); border-color: var(--ink); color: var(--ink); }
  .btn svg { width: 14px; height: 14px; }

  /* Demo block — a fake terminal showing what calling snap-ai feels like */
  .demo {
    margin: 48px 0 0;
    background: var(--code-bg);
    color: var(--code-ink);
    border-radius: 14px;
    padding: 22px 24px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13.5px;
    line-height: 1.65;
    border: 1px solid #2a2924;
    box-shadow: 0 6px 24px rgba(20,19,15,0.08);
    overflow-x: auto;
  }
  .demo .you { color: #b9b3a5; }
  .demo .ai  { color: #faf8f4; }
  .demo .tool { color: #f0a878; }
  .demo .arr { color: #5b9d6f; }
  .demo strong { color: #f0a878; font-weight: 500; }
  .demo .cursor {
    display: inline-block; width: 7px; height: 14px;
    background: var(--code-ink); vertical-align: -2px; margin-left: 1px;
    animation: blink 1.1s steps(2) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  /* Generic block padding */
  section.block { padding: 68px 0; border-top: 1px solid var(--line); }
  .eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 14px;
  }
  h2.section-title {
    font-family: 'Newsreader', serif;
    font-weight: 400;
    font-size: clamp(32px, 4vw, 44px);
    line-height: 1.12;
    letter-spacing: -0.02em;
    margin: 0 0 14px;
  }
  h2.section-title .italic { font-style: italic; }
  .section-lede {
    font-size: 17px;
    color: var(--ink-2);
    max-width: 600px;
    margin-bottom: 40px;
  }

  /* Install — three integration cards */
  .install-grid {
    display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 800px) { .install-grid { grid-template-columns: 1fr; } }
  .install-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 22px;
    display: flex; flex-direction: column;
  }
  .install-card h3 {
    font-size: 15px;
    font-weight: 500;
    margin: 0 0 4px;
    display: flex; align-items: center; gap: 10px;
  }
  .install-card .availability {
    font-size: 12px; color: var(--ink-3); margin-bottom: 16px;
  }
  pre.snippet {
    margin: 0 0 14px;
    background: var(--code-bg); color: var(--code-ink);
    padding: 14px 16px; border-radius: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; line-height: 1.6;
    overflow-x: auto;
    position: relative;
    flex: 1;
  }
  pre.snippet .copy {
    position: absolute; top: 8px; right: 8px;
    font-size: 10.5px; padding: 3px 9px;
    background: rgba(255,255,255,0.08); color: var(--code-ink);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 5px; cursor: pointer; font-family: inherit;
    transition: background .12s;
  }
  pre.snippet .copy:hover { background: rgba(255,255,255,0.2); }
  pre.snippet .copy.ok { background: rgba(91,157,111,0.3); }
  .install-card .help {
    font-size: 13px; color: var(--ink-3); margin: 0;
  }
  .install-card .help a { color: var(--ink-2); }

  /* What-it-does */
  .does-grid {
    display: grid; gap: 32px;
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 700px) { .does-grid { grid-template-columns: 1fr; } }
  .does-item h3 {
    font-family: 'Newsreader', serif;
    font-weight: 400;
    font-style: italic;
    font-size: 22px;
    margin: 0 0 6px;
    color: var(--ink);
  }
  .does-item p { margin: 0; color: var(--ink-2); font-size: 15px; }
  .does-item code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    background: var(--bg-soft);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--accent);
  }

  /* Stats strip */
  .stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
    padding: 36px 28px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 14px;
    margin: 28px 0 0;
  }
  @media (max-width: 600px) { .stats { grid-template-columns: 1fr; gap: 20px; } }
  .stat .num {
    font-family: 'Newsreader', serif;
    font-size: 36px;
    line-height: 1;
    letter-spacing: -0.02em;
    margin-bottom: 4px;
  }
  .stat .num .italic { font-style: italic; color: var(--accent); }
  .stat .label { font-size: 13px; color: var(--ink-3); }

  /* Money & waitlist */
  .money-card {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 36px 36px 32px;
    margin: 36px 0 0;
  }
  .money-card h3 {
    font-family: 'Newsreader', serif;
    font-weight: 400;
    font-size: 24px;
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .money-card p { color: var(--ink-2); margin: 0 0 18px; font-size: 15px; }
  .money-card form { display: flex; gap: 8px; max-width: 480px; }
  .money-card input[type=email] {
    flex: 1;
    padding: 11px 16px;
    font-family: inherit; font-size: 14px;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 8px;
    outline: none;
    transition: border-color .12s, background .12s;
  }
  .money-card input[type=email]:focus { border-color: var(--ink); background: var(--bg-card); }
  .money-card input[type=email]::placeholder { color: var(--ink-3); }
  .money-card button {
    padding: 11px 22px;
    font-family: inherit; font-size: 14px; font-weight: 500;
    background: var(--ink);
    color: var(--bg);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background .12s;
  }
  .money-card button:hover { background: var(--accent); }
  .money-card .status {
    margin-top: 12px; font-size: 13px; color: var(--ink-3); min-height: 1.3em;
  }
  .money-card .status.ok { color: #4a8c5b; }
  .money-card .status.err { color: var(--accent); }

  /* Footer */
  footer {
    padding: 44px 0 56px;
    color: var(--ink-3);
    font-size: 13px;
  }
  footer .row {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;
  }
  footer .links { display: flex; gap: 22px; }
  footer a { color: var(--ink-3); text-decoration: none; }
  footer a:hover { color: var(--ink); }
</style>
</head>
<body>

<header>
  <div class="container row">
    <a class="logo" href="/">snap-ai</a>
    <nav class="nav">
      <a href="#install">Install</a>
      <a href="#what">What it does</a>
      <span class="live-pill"><span class="dot"></span>${ingestStatus}</span>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="container-narrow">
    <h1 class="hero-title">Tell Claude to <span class="italic">find you the deal.</span></h1>
    <p class="hero-sub">Snap-AI is an MCP server that gives Claude, ChatGPT, and Cursor working coupon codes and merchant-verified deal links. Ask. Click. Save. Free while we're early.</p>
    <div class="cta-row">
      <a class="btn" href="#install">Install →</a>
      <a class="btn btn-ghost" href="#what">See what it does</a>
    </div>

    <div class="demo" aria-hidden="true">
      <span class="you">you ›</span> <span class="ai">find me a deal on a 65" OLED tv under $1500</span><br/>
      <span class="arr">snap-ai →</span> <span class="tool">find_deals</span>({ <span class="ai">query: "65 OLED"</span>, <span class="ai">cartTotalCents: 150000</span> })<br/>
      <span class="arr">←</span> <span class="ai">3 deals from <strong>Best Buy</strong>, <strong>Amazon</strong>, <strong>Costco</strong></span><br/>
      <span class="you">you ›</span> <span class="ai">show me the best one with a working code</span><br/>
      <span class="arr">snap-ai →</span> <span class="tool">get_deal</span>(<span class="ai">"9b1c..."</span>) → <span class="ai">$1,299 + free shipping, code <strong>SAVE150</strong><span class="cursor"></span></span>
    </div>
  </div>
</section>

<section class="block" id="install">
  <div class="container">
    <div class="eyebrow">Install</div>
    <h2 class="section-title">One <span class="italic">URL.</span> Three places to paste it.</h2>
    <p class="section-lede">No key needed. We're free while we're new — pay nothing, get every deal.</p>

    <div class="install-grid">
      <div class="install-card">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16z"/><path d="M12 6a6 6 0 100 12 6 6 0 000-12z"/></svg>
          Claude Desktop
        </h3>
        <div class="availability">macOS, Windows · works today</div>
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
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.45a4 4 0 00-3.45-2A4 4 0 0015.56 9 4 4 0 0012 7a4 4 0 00-3.56 2A4 4 0 005.17 7.45a4 4 0 00-3.45 2 4 4 0 00.45 4.55l9.1 8.55a1 1 0 001.46 0l9.1-8.55a4 4 0 00.45-4.55z"/></svg>
          ChatGPT
        </h3>
        <div class="availability">via Custom Connectors · Plus/Pro</div>
<pre class="snippet"><button class="copy" data-copy="chatgpt">Copy</button><span id="chatgpt-snippet">https://mcp.snap-ai.dev/mcp

Settings → Connectors →
Add custom connector → paste URL</span></pre>
        <p class="help">Custom Connectors are a paid-plan feature on chatgpt.com — same URL, just a different UI.</p>
      </div>

      <div class="install-card">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4l9 5 9-5v3l-9 5-9-5V4zm0 7l9 5 9-5v3l-9 5-9-5v-3zm0 7l9 5 9-5v3l-9 5-9-5v-3z"/></svg>
          Cursor
        </h3>
        <div class="availability">macOS, Windows, Linux</div>
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

    <div class="stats">
      <div class="stat"><div class="num"><span class="italic">${dealCount}</span></div><div class="label">deals indexed right now</div></div>
      <div class="stat"><div class="num"><span class="italic">${merchantCount}</span></div><div class="label">merchants with active deals</div></div>
      <div class="stat"><div class="num"><span class="italic">~4ms</span></div><div class="label">median find_deals latency</div></div>
    </div>
  </div>
</section>

<section class="block" id="what">
  <div class="container">
    <div class="eyebrow">What it does</div>
    <h2 class="section-title">Five tools. No <span class="italic">scraping.</span> Real codes.</h2>
    <p class="section-lede">The catalog is rebuilt from merchant-verified affiliate feeds and community deal aggregators every few minutes. Codes that stop working get pulled automatically based on agent telemetry.</p>

    <div class="does-grid">
      <div class="does-item">
        <h3>Find deals fast.</h3>
        <p>Filter by merchant, query, country, cart total. <code>find_deals</code> returns the top matches in milliseconds, ordered by freshness.</p>
      </div>
      <div class="does-item">
        <h3>Get the buy link.</h3>
        <p>Each deal includes a <code>deeplink</code> the agent can hand the user — straight to the merchant's product page, not a redirector.</p>
      </div>
      <div class="does-item">
        <h3>Pull working codes.</h3>
        <p><code>get_deal</code> returns the full discount spec, stack rules, geo scope, and the actual coupon code when one applies.</p>
      </div>
      <div class="does-item">
        <h3>Watch Amazon prices.</h3>
        <p><code>get_price_history</code> returns 30/90/all-time lows for any ASIN — Keepa-backed, auto-refreshed on demand.</p>
      </div>
      <div class="does-item">
        <h3>Report what worked.</h3>
        <p><code>report_code_result</code> takes a yes/no after checkout. Codes that consistently fail get auto-deactivated.</p>
      </div>
      <div class="does-item">
        <h3>Browse merchants.</h3>
        <p><code>list_merchants</code> walks every retailer with at least one active deal, filtered by category or country.</p>
      </div>
    </div>

    <div class="money-card">
      <h3>Want early access?</h3>
      <p>Drop your email. We'll ping you when we open up the hosted endpoint and again if we ship anything noteworthy. No newsletter, no upsell.</p>
      <form id="waitlist-form" novalidate>
        <input id="waitlist-email" type="email" required placeholder="your@email.com" autocomplete="email" />
        <button type="submit">Get notified</button>
      </form>
      <div class="status" id="waitlist-status" aria-live="polite"></div>
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

function formatThousands(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('en-US');
}

function formatIngestStatus(hoursAgo: number | undefined): string {
  if (hoursAgo === undefined) return 'live catalog';
  if (hoursAgo < 1) return 'updated minutes ago';
  if (hoursAgo < 2) return 'updated 1 hour ago';
  if (hoursAgo < 24) return `updated ${Math.floor(hoursAgo)} hours ago`;
  const days = Math.floor(hoursAgo / 24);
  return days === 1 ? 'updated 1 day ago' : `updated ${days} days ago`;
}
