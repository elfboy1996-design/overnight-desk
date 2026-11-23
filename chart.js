/* Hand-drawn canvas charts (no library). devicePixelRatio aware. */
(function () {
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /* Balance line: points [{t(ms), v}], start value (dashed line), marks [{t, label, color}].
     A new point slides in over 250ms. Marks sit above the line; a mark that would overlap the
     one before it moves up a row. */
  function line(canvas, points, opts) {
    opts = opts || {};
    const prev = canvas._n || 0;
    canvas._n = points.length;
    const draw = (frac) => drawLine(canvas, points, opts, frac);
    if (!reduced() && prev && points.length > prev) {
      const t0 = performance.now();
      const step = (now) => { const f = Math.min(1, (now - t0) / 250); draw(f); if (f < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    } else draw(1);
  }

  function drawLine(canvas, points, opts, frac) {
    const { ctx, w, h } = setup(canvas);
    if (points.length < 2) return;
    const padT = 44, padB = 14, padX = 16;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    let lo = Math.min(...points.map((p) => p.v)), hi = Math.max(...points.map((p) => p.v));
    if (opts.start != null) { lo = Math.min(lo, opts.start); hi = Math.max(hi, opts.start); }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const X = (t) => padX + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (w - 2 * padX);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
    const pts = points.map((p) => [X(p.t), Y(p.v)]);
    if (frac < 1 && pts.length > 1) {       // the newest point slides in from the one before it
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      pts[pts.length - 1] = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
    }
    const color = opts.color || "#00d35a";
    if (opts.start != null) {
      ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = "rgba(235,235,245,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, Y(opts.start)); ctx.lineTo(w - padX, Y(opts.start)); ctx.stroke(); ctx.restore();
    }
    const g = ctx.createLinearGradient(0, padT, 0, h);
    g.addColorStop(0, hexA(color, 0.28)); g.addColorStop(1, hexA(color, 0));
    ctx.beginPath(); ctx.moveTo(pts[0][0], h);
    pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    // marks
    ctx.font = "600 11px -apple-system, Inter, Roboto, system-ui, sans-serif";
    const rows = [];
    (opts.marks || []).filter((m) => m.t >= t0 && m.t <= t1).forEach((m) => {
      const x = X(m.t), tw = ctx.measureText(m.label).width + 12;
      let left = Math.max(2, Math.min(w - tw - 2, x - tw / 2)), r = 0;
      while (rows[r] != null && rows[r] > left - 4) r++;
      rows[r] = left + tw;
      const y = 6 + r * 20;
      ctx.fillStyle = hexA(m.color, 0.18); roundRect(ctx, left, y, tw, 17, 8); ctx.fill();
      ctx.fillStyle = m.color; ctx.fillText(m.label, left + 6, y + 12.5);
      ctx.strokeStyle = hexA(m.color, 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 17); ctx.lineTo(x, Y(valueAt(points, m.t))); ctx.stroke();
    });
  }

  function valueAt(points, t) {
    let v = points[0].v;
    for (const p of points) { if (p.t <= t) v = p.v; else break; }
    return v;
  }

  /* 1-minute candles [{t, o, h, l, c}] + an orange dashed exit line. */
  function candles(canvas, cs, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    if (!cs.length) return;
    const padT = 12, padB = 12, padX = 12;
    let lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
    if (opts.exit != null) { lo = Math.min(lo, opts.exit); hi = Math.max(hi, opts.exit); }
    if (opts.entry != null) { lo = Math.min(lo, opts.entry); hi = Math.max(hi, opts.entry); }
    if (hi - lo <= 0) { hi *= 1.01; lo *= 0.99; }
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
    const n = cs.length, slot = (w - 2 * padX) / n, bw = Math.max(1.5, Math.min(9, slot * 0.6));
    cs.forEach((c, i) => {
      const x = padX + slot * (i + 0.5), up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const top = Y(Math.max(c.o, c.c)), bot = Y(Math.min(c.o, c.c));
      ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
    });
    const hline = (v, color, label) => {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(padX, Y(v)); ctx.lineTo(w - padX, Y(v)); ctx.stroke(); ctx.restore();
      ctx.font = "600 11px -apple-system, Inter, Roboto, system-ui, sans-serif"; ctx.fillStyle = color;
      ctx.fillText(label, w - padX - ctx.measureText(label).width, Y(v) - 4);
    };
    if (opts.entry != null) hline(opts.entry, "rgba(235,235,245,0.45)", "entry");
    if (opts.exit != null) hline(opts.exit, "#ff9f0a", opts.exitLabel || "exit");
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  window.DeskChart = { line, candles };
})();
