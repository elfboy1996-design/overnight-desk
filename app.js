/* Grok Bot Desk — the phone app (STEP 10), static plan B.
   Reads the desk's published, ENCRYPTED JSON under d/<folder>/ on this same site (pubcrypt.py: folder,
   file names and AES-GCM key are all derived from the secret). The secret arrives
   once as #d=..., is kept in localStorage, and is never shown or put in a link. The desk publishes
   about every 8 minutes; the app polls every 60 s. Every FOMO link comes ready-made from the desk
   (links.py coin_url / profile_url / SIGNUP_URL) as a "link" field: the app never builds one. */
(function () {
  "use strict";
  const KEY = "desk_data_path";
  const POLL_S = 60, PUBLISH_MIN = 8;
  const BOTS = [
    { id: "scanner", name: "Scanner", color: "#64d2ff" }, { id: "analyst", name: "Analyst", color: "#ffd60a" },
    { id: "brain", name: "Brain", color: "#bf5af2" }, { id: "executor", name: "Executor", color: "#00d35a" },
    { id: "risk", name: "Risk", color: "#ff6b9a" }];
  const BOT = Object.fromEntries(BOTS.map((b) => [b.id, b]));
  const LAYERS = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10", "Liquidity", "Pool age", "Bundles", "Delegations"];
  const RANGES = { LIVE: null, "1H": 3600e3, "4H": 4 * 3600e3, "1D": 86400e3, "1W": 7 * 86400e3, ALL: Infinity };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = { state: null, activity: [], chart: [], orders: [], decisions: {}, coins: {}, lastOk: null, error: null,
              retryAt: 0, loaded: false, range: localStorage.getItem("desk_range") || "LIVE" };
  const $ = (sel, el) => (el || document).querySelector(sel);

  // ---------- data path (never displayed) ----------
  function dataPath() {
    const m = String(location.hash || "").match(/(?:^#|&)d=([A-Za-z0-9_-]{20,128})/);
    if (m) {
      try { localStorage.setItem(KEY, m[1]); } catch (e) {}
      const r = String(location.hash).match(/(?:&)r=([a-z]+(?:\/[A-Za-z0-9]+)?)/);   // optional deep link: #d=...&r=bots
      history.replaceState(null, "", location.pathname + location.search + (r ? "#/" + r[1] : ""));   // drop the path from the address bar
      return m[1];
    }
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  const DP = dataPath();
  // ---------- encrypted data (same derivation as pubcrypt.py; nothing here is ever displayed) ----------
  const enc = new TextEncoder();
  const SALT = enc.encode("overnight-desk/v1");
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const CRYPTO = (async () => {
    if (!DP || !(window.crypto && crypto.subtle)) throw new Error("no data link");
    const ikm = await crypto.subtle.importKey("raw", enc.encode(DP), "HKDF", false, ["deriveBits"]);
    const bits = (info, n) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, ikm, n * 8);
    const folder = hex(await bits("folder", 16));
    const nameKey = await crypto.subtle.importKey("raw", await bits("names", 32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const aesKey = await crypto.subtle.importKey("raw", await bits("aes-256-gcm", 32), "AES-GCM", false, ["decrypt"]);
    return { folder, nameKey, aesKey };
  })();
  CRYPTO.catch(() => {});
  const fileName = async (c, name) => hex(await crypto.subtle.sign("HMAC", c.nameKey, enc.encode(name))).slice(0, 32) + ".bin";
  async function getJSON(name) {
    const c = await CRYPTO;
    const url = new URL("d/" + c.folder + "/" + (await fileName(c, name)), location.href).toString() + "?t=" + Date.now();
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    const body = new Uint8Array(await r.arrayBuffer());
    let env;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: body.slice(0, 12), additionalData: SALT }, c.aesKey, body.slice(12));
      env = JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { throw new Error("cannot decrypt the desk data (open the newest app link)"); }
    if (!env || env.p !== name) throw new Error("wrong data file");
    return env.v;
  }

  // ---------- formatting ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (v) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const usdShort = (v) => {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return money(v);
  };
  const price = (v) => (v == null || !isFinite(v) ? "—" : v >= 1 ? money(v) : "$" + Number(v).toPrecision(4).replace(/0+$/, ""));
  const pct = (v, d = 2) => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%");
  const tms = (iso) => (iso == null ? NaN : typeof iso === "number" ? (iso > 1e12 ? iso : iso * 1000) : Date.parse(iso));
  const hm = (iso) => { const t = tms(iso); return isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; };
  const ago = (iso) => {
    const t = tms(iso); if (!isFinite(t)) return "—";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago";
  };
  const age = (min) => (min == null ? "—" : min < 60 ? Math.round(min) + "m" : min < 1440 ? Math.round(min / 60) + "h" : Math.round(min / 1440) + "d");
  const shortMint = (m) => (m ? m.slice(0, 4) + "…" + m.slice(-4) : "");
  const sym = (r) => (r && (r.symbol || (r.coin && r.coin.symbol))) || shortMint(r && r.mint);
  const fomoLink = (link, label) => (link ? `<a class="fomo" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(label || "Open on FOMO")} ↗</a>` : "");

  // ---------- odometer: changed digits roll 600ms, 30ms stagger ----------
  function odometer(el, text) {
    const old = el._text || "";
    el._text = text;
    if (reduced() || old.length !== text.length || !el.children.length) {
      el.innerHTML = [...text].map((ch) => /\d/.test(ch)
        ? `<span class="d"><span class="col">${[...Array(10).keys()].map((n) => `<span>${n}</span>`).join("")}</span></span>`
        : `<span class="ch">${esc(ch)}</span>`).join("");
      [...text].forEach((ch, i) => { if (/\d/.test(ch)) { const col = el.children[i].firstChild; col.style.transition = "none"; col.style.transform = `translateY(${-1.05 * ch}em)`; } });
      return;
    }
    let k = 0;
    [...text].forEach((ch, i) => {
      if (!/\d/.test(ch)) { el.children[i].textContent = ch; return; }
      const col = el.children[i].firstChild;
      if (old[i] !== ch) { col.style.transition = ""; col.style.transitionDelay = (k++ * 30) + "ms"; }
      col.style.transform = `translateY(${-1.05 * ch}em)`;
    });
  }

  // ---------- loading ----------
  async function load() {
    if (!DP) return;
    try {
      const st = await getJSON("state.json");
      const [act, ch, ord] = await Promise.all([
        getJSON("activity.json").catch(() => null), getJSON("chart.json").catch(() => null), getJSON("orders.json").catch(() => null)]);
      const dec = {};
      await Promise.all(BOTS.map((b) => getJSON(`bots/${b.id}/decisions.json`).then((d) => (dec[b.id] = d.rows || [])).catch(() => (dec[b.id] = S.decisions[b.id] || []))));
      S.state = st; S.activity = (act && act.rows) || S.activity; S.chart = (ch && ch.points) || S.chart;
      S.orders = (ord && ord.rows) || S.orders; S.decisions = dec; S.lastOk = Date.now(); S.error = null; S.loaded = true;
    } catch (e) {
      S.error = e; S.retryAt = Date.now() + POLL_S * 1000; S.loaded = S.loaded || false;
    }
    render();
  }
  async function loadCoin(mint) {
    try { S.coins[mint] = await getJSON(`coin/${mint}.json`); }
    catch (e) { S.coins[mint] = { error: e.status === 404 ? "No data published for this coin tonight." : "Couldn't load this coin. Retrying with the next update." }; }
    render();
  }

  // ---------- routing ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [v, arg] = h.split("/");
    return { view: ["home", "bots", "activity", "account", "coin", "audit", "search"].includes(v) ? v : "home", arg };
  }
  const go = (path) => { location.hash = "#/" + path; };
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });

  // ---------- banner (error / stale) ----------
  function banner() {
    const el = $("#banner");
    const st = S.state;
    const last = st ? hm(st.updated_at) : "—";
    if (S.error) {
      const n = Math.max(0, Math.round((S.retryAt - Date.now()) / 1000));
      el.className = "banner error"; el.hidden = false;
      el.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
      return;
    }
    if (st && Date.now() - tms(st.updated_at) > (PUBLISH_MIN * 2 + 2) * 60e3) {
      el.className = "banner stale"; el.hidden = false;
      el.textContent = `No new data since ${last} (${ago(st.updated_at)}). The desk isn't running right now.`;
      return;
    }
    el.hidden = true;
  }

  // ---------- navbar ----------
  function navbar(r) {
    const nb = $("#navbar");
    if (["coin", "audit", "search"].includes(r.view)) {
      nb.innerHTML = `<button class="back" data-back>‹ Back</button><div class="nav-spacer"></div>`;
      return;
    }
    const st = S.state || {};
    const initial = (st.fomo_handle || "G").slice(0, 1).toUpperCase();
    const seen = Number(localStorage.getItem("desk_seen") || 0);
    const newest = S.activity.length ? tms(S.activity[0].ts) : 0;
    nb.innerHTML = `
      <button class="avatar" data-go="account" aria-label="Account">${esc(initial)}</button>
      <button class="brand" data-go="bots">Grok Bot <span class="chev">›</span></button>
      <div class="nav-spacer"></div>
      <button class="icon-btn" data-go="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
      <button class="icon-btn" data-go="activity" aria-label="Activity"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${newest > seen ? '<span class="dot"></span>' : ""}</button>`;
  }

  // ---------- home ----------
  function skeleton() {
    return `<div class="sk" style="height:70px;width:70%;margin-top:10px"></div><div class="sk" style="height:18px;width:40%;margin-top:10px"></div>
      <div class="sk" style="height:220px;margin-top:16px"></div><div class="sk" style="height:36px;margin-top:8px"></div>
      <div class="sk" style="aspect-ratio:16/9;margin-top:16px;border-radius:22px"></div>
      <div style="display:flex;gap:10px;margin-top:26px"><div class="sk" style="height:176px;flex:0 0 78%"></div><div class="sk" style="height:176px;flex:1"></div></div>`;
  }

  function chartPoints() {
    const st = S.state || {};
    const pts = S.chart.map((p) => ({ t: tms(p.ts), v: Number(p.value) })).filter((p) => isFinite(p.t) && isFinite(p.v));
    if (pts.length && st.balance != null) {
      const now = tms(st.updated_at);
      if (now > pts[pts.length - 1].t) pts.push({ t: now, v: Number(st.balance) });   // the line runs to the last update
    }
    const win = RANGES[S.range];
    if (win == null) { const s = tms(st.night_started_at); return pts.filter((p) => !isFinite(s) || p.t >= s); }
    if (win === Infinity) return pts;
    const end = Date.now();
    return pts.filter((p) => p.t >= end - win);
  }
  function chartMarks() {
    return S.activity.filter((a) => ["bought", "sold", "stopped"].includes(a.kind)).map((a) => {
      const t = tms(a.ts), s = sym({ symbol: (a.title || "").split(" ").slice(1).join(" "), mint: a.mint });
      if (a.kind === "bought") return { t, label: "Bought " + s, color: "#0a84ff" };
      const v = (a.value || "").split(" · ")[0];
      if (a.kind === "sold" && !v.startsWith("-")) return { t, label: v, color: "#00d35a" };
      const p = (a.value || "").split(" · ")[1] || "";
      return { t, label: (p ? p.replace(/\.\d%/, "%") + " · " : "") + v, color: "#ff453a" };
    });
  }

  function lastOrderLine() {
    const st = S.state || {}, o = st.last_order;
    if (!o) return `<div class="last-order"><span class="sec">No order yet tonight</span></div>`;
    let checks = {};
    try { checks = typeof o.checks === "string" ? JSON.parse(o.checks) : (o.checks || {}); } catch (e) {}
    const paper = st.mode === "PAPER";
    const c = (name, v) => `<span class="check ${v === true || v === 1 ? "ok" : v === false || v === 0 ? "bad" : ""}" title="${name}">${v === true || v === 1 ? "✓" : v === false || v === 0 ? "✕" : "–"}</span>`;
    const verb = o.side === "buy" ? "Bought" : "Sold";
    const amt = o.side === "buy" ? money(o.usd) : (o.fill_usd != null ? money(o.fill_usd) : (o.pct || 100) + "%");
    const tail = paper ? "PAPER fill · no click" : o.status === "done" ? "verified" : o.status;
    return `<div class="last-order"><span>${verb} ${esc(sym(o))} · ${amt} · <span class="sec">${esc(tail)}</span></span>
      <span class="checks">${c("screen", paper ? null : o.screen_ok)}${c("api", null)}${c("chain", paper ? null : o.chain_ok)}</span></div>`;
  }

  function botCard(b) {
    const c = ((S.state || {}).cards || {})[b.id] || {};
    const head = `<div class="h"><span class="sw" style="background:${b.color}"></span>${b.name}</div>`;
    if (b.id === "scanner") {
      const feed = (c.feed || []).map((f) => f.verdict === "pass"
        ? `<div><span>${esc(sym(f))}</span><span class="p">→ Analyst</span></div>`
        : `<div><span class="k">${esc(sym(f))}</span><span class="r">${esc(f.reason || f.verdict)}</span></div>`).join("");
      return `<div class="bcard">${head}<div class="big">${c.pools || 0} pools</div><div class="feed">${feed || '<span class="sec">No pools yet</span>'}</div></div>`;
    }
    if (b.id === "analyst") {
      const strip = Array.from({ length: 8 }, (_, i) => {
        const l = (c.strip || []).find((x) => Number(x.n) === i + 1);
        return `<i class="${l ? (l.pass === 1 || l.pass === true ? "ok" : l.pass === 0 || l.pass === false ? "bad" : "") : ""}"></i>`;
      }).join("");
      const sc = c.last && c.last.score != null ? Number(c.last.score) : null;
      return `<div class="bcard">${head}<div class="big">${c.taken_apart || 0} taken apart</div>
        <div class="ring-row">${ring(sc, c.min_score || 70)}<div style="flex:1"><div class="strips">${strip}</div>
        <div class="feed sec">${c.last ? esc(sym(c.last)) + " · " + esc(c.last.reason || "") : "No audit yet"}</div>
        <div class="feed ter">Social: off</div></div></div></div>`;
    }
    if (b.id === "brain") {
      const l = c.last, full = c.full_size_score || 80;
      return `<div class="bcard">${head}<div class="big">Sizing</div>
        ${l ? `<div>${l.skipped ? "Skipped" : money(l.size_usd) + " · " + l.pct_of_cash + "% of cash"}</div><div class="feed sec">${esc(sym(l))} · score ${l.score}${l.cap_hit && l.cap_hit !== "none" ? " · cap: " + esc(l.cap_hit) : ""}</div>
        <div class="pills"><span class="pill ${l.score >= full ? "green" : "grey"}">${l.score >= full ? full + "+ = full size" : "under " + full + " = half size"}</span></div>`
        : '<div class="sec">Nothing sized yet</div>'}</div>`;
    }
    if (b.id === "executor") {
      const lane = (S.state || {}).lane, l = c.last;
      let bar = "Idle";
      if (lane && lane.bot === "executor") bar = lane.side === "buy" ? "Clicking Buy..." : "Clicking Sell...";
      else if (c.waiting) bar = `Waiting for a dip -${Math.round(c.dip_pct)}%`;
      else if (l && l.status === "done" && l.side === "buy") bar = (S.state || {}).mode === "PAPER" ? "✓ Bought · PAPER fill" : "✓ Bought · verified";
      else if (l && l.status === "unverified") bar = "Unverified · check FOMO";
      return `<div class="bcard">${head}<div class="big">${c.trades || 0} trades</div><div class="bar">${esc(bar)}</div>
        ${l ? `<div class="feed sec" style="margin-top:8px">Last: ${esc(l.side)} ${esc(sym(l))} · ${esc(l.status)}</div>` : ""}</div>`;
    }
    const stop = c.stop_pct != null ? Math.round(c.stop_pct) : 25;
    return `<div class="bcard">${head}<div class="big">${c.open ? "Guarding" : "Nothing open"}</div>
      <div class="sec">${c.open ? c.open + " open position" + (c.open > 1 ? "s" : "") : "Guards every position from the buy to the sell"}</div>
      <div class="pills"><span class="pill mono red">stop -${stop}%</span><span class="pill mono green">trail ${Math.round(c.trail_pct || 40)}%</span></div></div>`;
  }

  function ring(score, pass) {
    const r = 22, C = 2 * Math.PI * r, f = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
    const col = score == null ? "rgba(235,235,245,0.3)" : score >= pass ? "#00d35a" : "#ff453a";
    return `<svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="#2c2c2e" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 28 28)"/>
      <text x="28" y="33" text-anchor="middle" fill="#fff" font-size="15" font-weight="700" font-family="-apple-system,Inter,Roboto,sans-serif">${score == null ? "–" : Math.round(score)}</text></svg>`;
  }

  function actRow(a) {
    const icon = { bought: ["#0a84ff", "↓"], sold: ["#00d35a", "↑"], stopped: ["#ff453a", "■"], rejected: ["rgba(235,235,245,0.3)", "✕"] }[a.kind] || ["#2c2c2e", "•"];
    const target = a.kind === "rejected" ? "audit/" + a.mint : "coin/" + a.mint;
    const vcls = a.kind === "sold" && !(a.value || "").startsWith("-") ? "green" : a.kind === "stopped" || (a.value || "").startsWith("-") ? "red" : a.kind === "rejected" ? "sec" : "";
    return `<div class="row"><span class="ic" style="background:${icon[0]}22;color:${icon[0]}">${icon[1]}</span>
      <button class="mid" data-go="${esc(target)}" style="text-align:left"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.subtitle)}</div></button>
      <div class="v"><div class="${vcls}">${esc(a.value)}</div>${fomoLink(a.link)}</div></div>`;
  }

  function home() {
    const st = S.state;
    if (!st) return skeleton();
    const mult = Number(st.multiplier), up = (st.today_pct || 0) >= 0;
    const trades = S.activity.filter((a) => a.kind !== "rejected");
    const pts = chartPoints();
    const nextPub = tms(st.updated_at) + PUBLISH_MIN * 60e3;
    return `
      <div class="bal-row"><div class="balance odo" id="bal"></div>${st.mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : ""}</div>
      <div class="today"><span class="${up ? "green" : "red"}">${pct(st.today_pct)}</span><span class="sec">today</span>
        <span class="pill mult ${mult < 1 ? "down" : ""}">${isFinite(mult) ? mult.toFixed(2) + "×" : "—"}</span></div>
      <div class="updated">Last update ${hm(st.updated_at)} (${ago(st.updated_at)}) · the desk publishes about every ${PUBLISH_MIN} min${Date.now() < nextPub ? ", next around " + hm(nextPub) : ""}${st.exercise ? " · practice run" : ""}</div>
      <div class="chart-wrap"><canvas id="chart"></canvas>${!trades.length ? '<div class="chart-empty">Waiting for the first trade</div>' : pts.length < 2 ? '<div class="chart-empty">No points in this range</div>' : ""}</div>
      <div class="ranges">${Object.keys(RANGES).map((k) => `<button data-range="${k}" class="${k === S.range ? "on" : ""}">${k}</button>`).join("")}</div>
      ${screenCard()}
      ${lastOrderLine()}
      <div class="section-h"><h2>Bots · ${botsRunning()} running</h2></div>
      <div class="carousel">${BOTS.map(botCard).join("")}</div>
      <div class="section-h"><h2>Activity</h2><button data-go="activity">See all</button></div>
      <div class="list">${S.activity.slice(0, 5).map(actRow).join("") || '<div class="empty">Nothing yet tonight</div>'}</div>`;
  }

  function botsRunning() {
    const st = S.state || {}, b = st.bots || {};
    if (!st.updated_at || Date.now() - tms(st.updated_at) > (PUBLISH_MIN * 2 + 2) * 60e3) return 0;
    return BOTS.filter((x) => b[x.id] && b[x.id].heartbeat < 120).length;
  }

  function screenCard() {
    const st = S.state || {}, lane = st.lane;
    const right = lane ? `<span style="color:${(BOT[lane.bot] || {}).color || "#fff"}">${esc((BOT[lane.bot] || { name: lane.bot }).name)} · ${lane.side === "buy" ? "buying" : "selling"}</span>` : "Idle";
    return `<div class="screen">
      <div class="tl"><span class="ldot"></span>Last frame —</div><div class="tr">${right}</div>
      <div class="none"><div><b>No live picture yet</b>The bot's screen shows here once clicks run on its computer (plan B, a frame about every 15 s). Not available on this static app yet.</div></div></div>`;
  }

  // ---------- bots tab ----------
  function decRow(b, d) {
    let l = "", r = "";
    if (b === "scanner") { l = `${sym(d)} · ${d.verdict === "pass" ? "→ Analyst" : d.reason}`; r = d.verdict; }
    else if (b === "analyst") { l = `${sym(d)} · ${d.reason || ""}`; r = d.score != null ? "score " + Math.round(d.score) : "rejected"; }
    else if (b === "brain") { l = `${sym(d)} · ${d.reason || ""}`; r = d.skipped ? "skip" : money(d.size_usd); }
    else if (b === "executor") { l = `${d.side} ${sym(d)} · ${d.reason || d.error || ""}`; r = d.status; }
    else { l = `${sym(d)} · ${d.exit_reason ? "closed: " + d.exit_reason : "guarding"}`; r = d.pnl_usd != null ? money(d.pnl_usd) : money(d.size_usd); }
    return `<div class="dec"><button class="l" data-go="coin/${esc(d.mint)}" style="text-align:left">${esc(l)}</button>
      <span style="white-space:nowrap"><span class="sec">${esc(r)} · ${hm(d.ts || d.opened_at)}</span> ${fomoLink(d.link, "FOMO")}</span></div>`;
  }
  function bots() {
    const st = S.state;
    if (!st) return `<div class="sk" style="height:200px;margin-top:10px"></div><div class="sk" style="height:200px;margin-top:12px"></div>`;
    const fresh = Date.now() - tms(st.updated_at) <= (PUBLISH_MIN * 2 + 2) * 60e3;
    const counts = { scanner: (st.cards.scanner || {}).pools, analyst: (st.cards.analyst || {}).taken_apart,
      brain: (S.decisions.brain || []).length, executor: (st.cards.executor || {}).trades, risk: (S.decisions.risk || []).length };
    const riskLocked = (st.positions || []).length > 0;
    return `<div class="section-h" style="margin-top:8px"><h2>Bots</h2><button data-go="account">Settings</button></div>` + BOTS.map((b) => {
      const hb = (st.bots || {})[b.id];
      const on = fresh && hb && hb.heartbeat < 120;
      const decs = (S.decisions[b.id] || []).slice(0, 20);
      return `<div class="bigcard"><div class="top"><span class="status-dot ${on ? "on" : ""}"></span>
        <span class="name" style="color:${b.color}">${b.name}</span><span class="sec">${counts[b.id] || 0} today</span>
        <span class="switch ${on ? "on" : ""}" aria-disabled="true" title="Pause from Telegram: pause ${esc(b.name || b.id)}"></span></div>
        <div class="note" style="margin:6px 0 4px">${(S.state && (S.state.paused || []).includes(b.id)) ? "Paused" : on ? "Running" : "Not running right now"} · pause ${b.id === "risk" && riskLocked ? "locked while a position is open" : "from Telegram (pause " + esc(b.id) + ")"}</div>
        ${decs.map((d) => decRow(b.id, d)).join("") || '<div class="dec sec">No decisions yet tonight</div>'}</div>`;
    }).join("");
  }

  // ---------- activity tab ----------
  function activity() {
    localStorage.setItem("desk_seen", String(Date.now()));
    if (!S.state) return `<div class="sk" style="height:320px;margin-top:10px"></div>`;
    return `<div class="section-h" style="margin-top:8px"><h2>Activity</h2></div>
      <div class="list">${S.activity.map(actRow).join("") || '<div class="empty">Nothing yet tonight</div>'}</div>`;
  }

  // ---------- coin ----------
  function candlesOf(rows) {
    const by = new Map();
    rows.forEach((r) => {
      const t = tms(r.ts), p = Number(r.price);
      if (!isFinite(t) || !isFinite(p) || r.price == null) return;
      const k = Math.floor(t / 60e3) * 60e3, c = by.get(k);
      if (!c) by.set(k, { t: k, o: p, h: p, l: p, c: p }); else { c.h = Math.max(c.h, p); c.l = Math.min(c.l, p); c.c = p; }
    });
    return [...by.values()].sort((a, b) => a.t - b.t);
  }
  function coin(mint) {
    const c = S.coins[mint];
    if (!c) { loadCoin(mint); return `<div class="sk" style="height:40px;width:60%;margin-top:10px"></div><div class="sk" style="height:56px;width:50%;margin-top:12px"></div><div class="sk" style="height:220px;margin-top:14px"></div>`; }
    if (c.error) return `<div class="empty">${esc(c.error)}</div>`;
    const st = S.state || {}, info = c.coin || {}, pos = c.position;
    const layers = c.layers || [], passed = layers.filter((l) => l.pass === 1 || l.pass === true).length;
    const ageMin = c.pool_age_min != null && c.scan ? c.pool_age_min + (Date.now() - tms(c.scan.ts)) / 60e3 : null;
    const last = c.price;
    let since = "";
    if (pos && pos.entry_price && last != null) {
      const ref = pos.closed_at && pos.exit_price != null ? pos.exit_price : last;
      const p = (ref / pos.entry_price - 1) * 100;
      since = `<div class="${p >= 0 ? "green" : "red"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}% since entry${pos.closed_at ? " (at exit)" : ""}</div>`;
    }
    const posLine = pos ? `<div class="poscard"><div class="t" style="font-weight:600">Your position · ${money(pos.size_usd)} in · Executor</div>
      <div class="sec" style="font-size:13px;margin-top:4px">${pos.closed_at ? `Closed ${hm(pos.closed_at)} · ${esc(pos.exit_reason || "")} · ${money(pos.pnl_usd)}` : `Open since ${hm(pos.opened_at)} · stop ${price(pos.stop_price)}`} · ${esc(pos.mode)}</div></div>`
      : `<div class="poscard sec">No position in this coin</div>`;
    return `<div class="coin-h"><h1>${esc(info.name || sym(c))} ${st.mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : ""}</h1>
      <div class="sec" style="margin-top:4px;display:flex;gap:8px;align-items:center">${esc(sym(c))} · Solana · ${ageMin != null ? age(ageMin) + " old" : "age —"}
      ${layers.length ? `<button class="shield ${passed < 8 ? "bad" : ""}" data-go="audit/${esc(mint)}">⛨ ${passed}/8</button>` : ""}</div></div>
      <div class="price">${price(last)}</div>${since}
      <div class="chart-wrap" style="margin-top:8px"><canvas id="candles"></canvas>${candlesOf(c.candles || []).length ? "" : '<div class="chart-empty">No prices yet</div>'}</div>
      <div class="note" style="margin-top:2px">1-minute candles from the desk's DexScreener reads</div>
      <div class="tiles"><div class="tile"><div class="k">Market cap</div><div class="v">${usdShort(c.market_cap)}</div></div>
        <div class="tile"><div class="k">Liquidity</div><div class="v">${usdShort(c.liquidity_usd)}</div></div>
        <div class="tile"><div class="k">Holders</div><div class="v">${c.holders != null ? Number(c.holders).toLocaleString() : "—"}</div></div></div>
      ${posLine}
      <div class="btns"><a class="btn primary" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>
        <button class="btn" disabled>Sell now</button></div>
      <div class="note" style="margin-top:6px;text-align:right">Sell from Telegram: sell ${esc(sym(c))}</div>`;
  }

  // ---------- audit ----------
  function audit(mint) {
    const c = S.coins[mint];
    if (!c) { loadCoin(mint); return `<div class="sk" style="height:180px;margin-top:10px"></div>`; }
    if (c.error) return `<div class="empty">${esc(c.error)}</div>`;
    const layers = c.layers || [];
    const L = (i) => layers.find((l) => Number(l.n) === i + 1);
    const discs = LAYERS.map((name, i) => {
      const l = L(i), ok = l && (l.pass === 1 || l.pass === true), bad = l && (l.pass === 0 || l.pass === false);
      return `<div><div class="disc ${ok ? "ok" : bad ? "bad" : ""}" style="animation-delay:${i * 250}ms">${ok ? "✓" : bad ? "✕" : i + 1}</div><div class="disc-l">${esc(name)}</div></div>`;
    }).join("");
    const rows = LAYERS.map((name, i) => {
      const l = L(i), ok = l && (l.pass === 1 || l.pass === true), bad = l && (l.pass === 0 || l.pass === false);
      return `<div class="row"><span class="ic" style="background:${ok ? "#00d35a22" : bad ? "#ff453a22" : "#2c2c2e"};color:${ok ? "#00d35a" : bad ? "#ff453a" : "rgba(235,235,245,0.3)"}">${i + 1}</span>
        <div class="mid"><div class="t">${esc(name)}</div><div class="s">${esc(l ? l.source || "" : "")}</div></div><div class="v ${ok ? "green" : bad ? "red" : "ter"}">${esc(l ? l.value : "not checked")}</div></div>`;
    }).join("");
    const sc = c.score;
    return `<div class="coin-h"><h1>Audit · ${esc(sym(c))}</h1><div class="sec">${layers.length ? "8 layers, stop at the first red" : "Not audited (Scanner didn't pass it)"}</div></div>
      <div class="discs">${discs}</div>
      <div class="list">${rows}<div class="row"><span class="ic" style="background:#2c2c2e">S</span><div class="mid"><div class="t">Social: off</div><div class="s">No X search in this build (plan C)</div></div></div></div>
      ${sc ? `<div class="poscard">${sc.score != null ? `Score <b>${Math.round(sc.score)}</b> · ${sc.pass ? "passed" : "rejected"}` : "No score"} <div class="sec" style="font-size:13px">${esc(sc.reason || "")}</div></div>` : ""}
      <div class="btns"><a class="btn" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a><button class="btn" data-go="coin/${esc(mint)}">Coin</button></div>`;
  }

  // ---------- account ----------
  const GROUPS = ["scanner", "analyst", "social", "brain", "executor", "risk", "desk"];
  const fmtNum = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(4))) : v === true ? "on" : v === false ? "off" : String(v ?? "—"));
  function account() {
    const st = S.state;
    if (!st) return `<div class="sk" style="height:300px;margin-top:10px"></div>`;
    const set = st.settings || {};
    const groups = GROUPS.map((g) => {
      const keys = Object.keys(set).filter((k) => k.startsWith(g + "."));
      if (!keys.length) return "";
      return `<div class="group-h">${g[0].toUpperCase() + g.slice(1)}${g === "social" ? " · off in this build" : ""}</div><div class="list">${keys.map((k) => {
        const s = set[k], name = k.split(".")[1].replace(/_/g, " ");
        const numeric = (s.kind === "float" || s.kind === "int") && s.lo != null;
        const changed = s.default != null && String(s.value) !== String(s.default) && Number(s.value) !== Number(s.default);
        const meta = [numeric ? `${fmtNum(s.lo)} to ${fmtNum(s.hi)}` : "", changed ? `default ${esc(s.default)}` : "", s.locked ? "🔒 Grok Bot chat only" : ""].filter(Boolean).join(" · ");
        return `<div class="set"><div class="k"><span>${esc(name)}</span><b>${esc(fmtNum(s.value))}</b></div>
          ${s.desc ? `<div class="set-d">${esc(s.desc)}</div>` : ""}
          ${numeric ? `<input type="range" min="${s.lo}" max="${s.hi}" step="${s.kind === "int" ? 1 : "any"}" value="${esc(s.value)}" disabled aria-label="${esc(name)}">` : ""}
          ${meta ? `<div class="set-m">${meta}</div>` : ""}</div>`;
      }).join("")}</div>`;
    }).join("");
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const tgOff = st.telegram && typeof st.telegram === "object" && st.telegram.connected === false;
    return `<div class="section-h" style="margin-top:8px"><h2>Account</h2></div>
      <div class="seg"><button class="${st.mode === "PAPER" ? "on" : ""}" disabled>PAPER</button><button class="${st.mode === "LIVE" ? "on" : ""}" disabled>LIVE</button></div>
      <div class="note" style="margin:6px 4px 0">LIVE needs a full PAPER night, Step 15, and you typing LIVE in chat. Not from this app.</div>
      <div class="group-h">Cash</div>
      <div class="list"><div class="row"><div class="mid"><div class="t">${money(st.cash)}</div><div class="s">${st.mode} · free ${money(st.free_cash)} · started at ${money(st.start_cash)}</div></div></div></div>
      <div class="group-h">FOMO</div>
      <div class="list">
        <a class="row link-row" href="${esc(st.profile_url)}" target="_blank" rel="noopener noreferrer"><div class="mid"><div class="t">Your FOMO profile</div><div class="s">@${esc(st.fomo_handle)}</div></div><div class="v">↗</div></a>
        <button class="row link-row" data-invite><div class="mid"><div class="t">Invite a friend</div><div class="s" id="invite-s">Share your FOMO invite link</div></div><div class="v">⤴</div></button></div>
      <div class="group-h">Pushes</div>
      <div class="list wrap">
        ${tgOff
          ? `<div class="row"><div class="mid"><div class="t">Telegram</div><div class="s">Not connected right now. Plan B: Telegram only, no web push.</div></div><span class="pill grey">off</span></div>`
          : `<a class="row link-row" href="https://t.me/Grokillerbot" target="_blank" rel="noopener noreferrer"><div class="mid"><div class="t">Telegram</div><div class="s">Connected · @Grokillerbot. Pushes come here; send it status, why X, sell X, pause Scanner. Plan B: Telegram only, no web push.</div></div><span class="pill green">on</span></a>`}
        <div class="row"><div class="mid"><div class="t">Send test push</div><div class="s">Send "status" to @Grokillerbot, or ask in the Grok Bot chat</div></div><button class="btn" disabled>Send</button></div>
        <div class="row"><div class="mid"><div class="t">Enable notifications</div><div class="s">Not used: pushes come through Telegram</div></div><button class="btn" disabled>Enable</button></div></div>
      <div class="group-h">More</div>
      <div class="list wrap">
        <div class="row"><div class="mid"><div class="t">Copy picks</div><div class="s">Off · from chat for now</div></div></div>
        <div class="row"><div class="mid"><div class="t">Watch in Grok Bot</div><div class="s">Open the Grok Bot app to watch the bot's computer</div></div></div>
        ${standalone ? "" : `<div class="row"><div class="mid"><div class="t">Install this app</div><div class="s">In Chrome: tap ⋮, then Add to Home screen</div></div></div>`}</div>
      <div class="group-h">Settings · read only here, change one from Telegram: set stop to -20%</div>
      ${groups}
      <div class="note" style="margin:18px 4px">Last update ${hm(st.updated_at)} · ${esc(st.night || "")}</div>`;
  }

  // ---------- search ----------
  function knownCoins() {
    const m = new Map();
    const add = (r) => { if (r && r.mint && !m.has(r.mint)) m.set(r.mint, { mint: r.mint, symbol: r.symbol || null, title: r.title || "" }); };
    S.activity.forEach(add); Object.values(S.decisions).forEach((rows) => rows.forEach(add)); ((S.state || {}).positions || []).forEach(add);
    return [...m.values()];
  }
  function search() {
    return `<input class="search-in" id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="list" id="results"></div>`;
  }
  function searchResults(q) {
    q = q.trim().toLowerCase();
    const res = knownCoins().filter((c) => !q || c.mint.toLowerCase().includes(q) || (c.symbol || "").toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
    $("#results").innerHTML = res.slice(0, 40).map((c) => `<button class="row" data-go="coin/${esc(c.mint)}"><div class="mid"><div class="t">${esc(c.symbol || shortMint(c.mint))}</div><div class="s">${esc(c.mint)}</div></div></button>`).join("")
      || `<div class="empty">${q ? "No coin tonight matches" : "No coins tonight yet"}</div>`;
  }

  // ---------- render ----------
  function render() {
    const r = route();
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === r.view));
    $("#tabbar").hidden = ["coin", "audit", "search"].includes(r.view);
    navbar(r);
    if (!DP) {
      $("#banner").hidden = true;
      $("#view").innerHTML = `<div class="onboard"><h1>Grok Bot Desk</h1><p>Open the private link Grok Bot sent you once on this phone. After that the app remembers it.</p></div>`;
      return;
    }
    banner();
    const v = $("#view");
    const keepScroll = window.scrollY;
    if (r.view === "home") v.innerHTML = home();
    else if (r.view === "bots") v.innerHTML = bots();
    else if (r.view === "activity") v.innerHTML = activity();
    else if (r.view === "account") v.innerHTML = account();
    else if (r.view === "coin") v.innerHTML = coin(r.arg);
    else if (r.view === "audit") v.innerHTML = audit(r.arg);
    else if (r.view === "search") { if (!$("#q")) { v.innerHTML = search(); searchResults(""); $("#q").addEventListener("input", (e) => searchResults(e.target.value)); } return; }
    window.scrollTo(0, keepScroll);
    if (r.view === "home" && S.state) {
      odometer($("#bal"), money(S.state.balance));
      const cv = $("#chart");
      if (cv) DeskChart.line(cv, chartPoints(), { start: S.state.start_cash, marks: chartMarks(), color: (S.state.today_pct || 0) >= 0 ? "#00d35a" : "#ff453a" });
    }
    if (r.view === "coin" && S.coins[r.arg] && !S.coins[r.arg].error) {
      const c = S.coins[r.arg], pos = c.position, cv = $("#candles");
      if (cv) DeskChart.candles(cv, candlesOf(c.candles || []), {
        entry: pos ? pos.entry_price : null,
        exit: pos ? (pos.closed_at ? pos.exit_price : pos.stop_price) : null, exitLabel: pos && pos.closed_at ? "exit" : "stop" });
    }
  }

  // ---------- events ----------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-go],[data-tab],[data-range],[data-back],[data-invite]");
    if (!t) return;
    if (t.dataset.tab) return go(t.dataset.tab);
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.back != null) return history.length > 1 ? history.back() : go("home");
    if (t.dataset.range) { S.range = t.dataset.range; localStorage.setItem("desk_range", S.range); return render(); }
    if (t.dataset.invite != null) {
      const url = (S.state || {}).signup_url;
      if (!url) return;
      try { if (navigator.share) { await navigator.share({ title: "FOMO", url }); return; } } catch (err) { if (err && err.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(url); $("#invite-s").textContent = "Link copied"; } catch (err) { $("#invite-s").textContent = url; }
    }
  });
  window.addEventListener("resize", () => { if (route().view === "home" || route().view === "coin") render(); });
  setInterval(() => { if (S.error) banner(); }, 1000);
  setInterval(load, POLL_S * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  render();
  load();
})();
