/* 候场喜剧 · 剧场入场
 * 不依赖第三方库：Canvas 2D 程序化绘制观众厅，滚动驱动镜头走向舞台，
 * 灯亮后切换为真实舞台照片 hero-home.jpeg。
 * 只在首页播放；直接打开 #login / #membership 等页面、付款回跳时不播放。
 * 调试：在网址后加 ?intro=1 可强制重新播放完整入场。
 */
(() => {
  'use strict';
  const root = document.getElementById('intro');
  if (!root) return;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const ui = (name) => root.querySelector('[data-intro="' + name + '"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FULL_VH = 620;
  const SEEN_KEY = 'lz_intro_seen';
  const SEEN_DAYS = 7;
  const RETURN_KEYS = ['checkout', 'session_id', 'code', 'token', 'type', 'access_token', 'error'];

  /* ---------- 文案 ---------- */
  const COPY = {
    zh: {
      enter: '向下滚动 · 入场', next: '继续向下 · 近期演出', skip: '跳过入场', replay: '重新入场',
      line1: '今晚，有人在台上紧张。', line2: '也有人，在台下等笑。', line3: '灯，要亮了。',
      eyebrow: 'LOADING ZONE COMEDY · 候场喜剧',
      title: '把好笑的事，<em>认真做。</em>',
      subtitle: '墨尔本、悉尼、布里斯班的中文现场喜剧。演出马上开始，欢迎入座。',
      shows: '查看近期演出', join: '加入会员', mic: '近期演出', stool: '加入会员',
      soundOn: '声音：开', soundOff: '声音：关', loading: '候场中'
    },
    en: {
      enter: 'Scroll to enter', next: 'Keep scrolling · Shows', skip: 'Skip intro', replay: 'Replay',
      line1: 'Tonight, someone up there is nervous.', line2: 'And someone down here is waiting to laugh.', line3: 'Lights up.',
      eyebrow: 'LOADING ZONE COMEDY · 候场喜剧',
      title: 'Taking funny <em>seriously.</em>',
      subtitle: 'Chinese live comedy in Melbourne, Sydney and Brisbane. The show is about to start.',
      shows: 'Upcoming shows', join: 'Become a member', mic: 'Upcoming shows', stool: 'Membership',
      soundOn: 'Sound: on', soundOff: 'Sound: off', loading: 'Loading'
    }
  };
  let cms = {};
  const curLang = () => { try { return (typeof lang !== 'undefined' && lang === 'en') ? 'en' : 'zh'; } catch { return 'zh'; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let renderedLang = '';
  function applyCopy() {
    const l = curLang();
    const c = COPY[l];
    root.querySelectorAll('[data-copy]').forEach((el) => { el.textContent = c[el.dataset.copy] || ''; });
    const title = ui('title');
    const sub = ui('subtitle');
    // 中文标题和副标题沿用后台首页 CMS（如已发布）
    if (l === 'zh' && cms.title) title.innerHTML = esc(cms.title).replace(/\n/g, '<br>');
    else title.innerHTML = c.title;
    sub.textContent = (l === 'zh' && cms.subtitle) ? cms.subtitle : c.subtitle;
    ui('sound').textContent = sound.on ? c.soundOn : c.soundOff;
    renderedLang = l;
  }
  fetch('/api/site-content', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && d.home) { cms = d.home; applyCopy(); } })
    .catch(() => {});

  /* ---------- 小工具 ---------- */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const band = (v, a, b, f = 0.035) => smooth(a - f, a + f, v) * (1 - smooth(b - f, b + f, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  /* ---------- 路由与模式 ---------- */
  const route = () => location.hash.slice(1).split('?')[0] || 'home';
  function isReturnFlow() {
    const q = new URLSearchParams(location.search.slice(1) + '&' + (location.hash.split('?')[1] || ''));
    return RETURN_KEYS.some((k) => q.has(k));
  }
  const forced = () => new URLSearchParams(location.search).get('intro') === '1';
  function seenRecently() {
    try { return Date.now() - (+localStorage.getItem(SEEN_KEY) || 0) < SEEN_DAYS * 864e5; } catch { return false; }
  }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} }

  let mode = 'off';
  function initialMode() {
    if (route() !== 'home' || isReturnFlow()) return 'off';
    if (cms.intro && cms.intro.enabled === false) return 'off';
    if (reduceMotion) return 'stage';
    if (forced()) return 'full';
    return seenRecently() ? 'stage' : 'full';
  }
  function setMode(m) {
    mode = m;
    root.hidden = m === 'off';
    root.dataset.mode = m;
    document.body.classList.toggle('intro-on', m !== 'off');
    root.style.height = m === 'full' ? FULL_VH + 'vh' : '100vh';
    if (m === 'stage') { state.p = state.target = 1; state.lit = 1; state.litTarget = 1; }
    if (m === 'full') { state.p = state.target = 0; state.lit = 0; state.litTarget = 0; }
    if (m !== 'off') { resize(); start(); }
  }

  /* ---------- 状态 ---------- */
  const state = { p: 0, target: 0, lit: 0, litTarget: 0, mx: 0, my: 0, yaw: 0, pitch: 0, time: 0, clicked: false };

  /* ---------- 画布尺寸 ---------- */
  let W = 0, H = 0, DPR = 1, F = 600;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.5 : 1.75);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    F = 0.5 * Math.hypot(W, H) * 0.85;
    layoutPhoto();
  }
  addEventListener('resize', () => { if (mode !== 'off') resize(); });

  /* ---------- 光晕贴图 ---------- */
  function sprite(r, g, b) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(255,255,255,1)`);
    gr.addColorStop(0.12, `rgba(${r},${g},${b},0.9)`);
    gr.addColorStop(0.4, `rgba(${r},${g},${b},0.25)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }
  const WARM = sprite(255, 178, 96);
  const COOL = sprite(200, 220, 255);
  const BLUE = sprite(70, 100, 255);

  /* ---------- 剧场几何（单位：米） ---------- */
  const HALL_X = 11, CEIL = 12, STAGE_Z = 23, STAGE_Y = 1.05, FOYER_Y = 0.85;
  const floorY = (z) => (z < 3 ? FOYER_Y : z < 21 ? FOYER_Y * (21 - z) / 18 : 0);
  const rows = [];
  (function buildSeats() {
    for (let r = 0; r < 16; r++) {
      const z = 4.2 + r * 1.05;
      const fy = floorY(z);
      const seats = [];
      for (const side of [-1, 1]) {
        for (let i = 0; i < 16; i++) {
          const x = side * (1.25 + i * 0.6);
          const occupied = rand() < 0.78;
          const phone = occupied && rand() < 0.4;
          seats.push({ x, occupied, phone, px: x + (rand() - 0.5) * 0.25, py: fy + 1.45 + rand() * 0.35, ph: rand() * 6.28, sp: 1 + rand() * 2.5, cool: rand() < 0.8 });
        }
      }
      rows.push({ z, fy, seats });
    }
  })();
  const boxes = [];
  for (const side of [-1, 1]) for (const z of [12.5, 16.2, 19.9]) {
    const lights = [];
    for (let i = 0; i < 4; i++) if (rand() < 0.7) lights.push({ z: z - 1 + rand() * 2, y: 4.7 + rand() * 0.5, ph: rand() * 6.28, sp: 1 + rand() * 2 });
    boxes.push({ side, z, lights });
  }

  /* ---------- 相机与投影 ---------- */
  const cam = { x: 0, y: 2, z: -2.6, cy: 1, sy: 0, cp: 1, sp: 0 };
  function toCam(X, Y, Z) {
    const dx = X - cam.x, dy = Y - cam.y, dz = Z - cam.z;
    const x1 = dx * cam.cy - dz * cam.sy;
    const z1 = dx * cam.sy + dz * cam.cy;
    return [x1, dy * cam.cp - z1 * cam.sp, dy * cam.sp + z1 * cam.cp];
  }
  const NEAR = 0.12;
  function clipNear(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  }
  const sx = (c) => W / 2 + (c[0] / c[2]) * F;
  const sy = (c) => H / 2 - (c[1] / c[2]) * F;
  // 把一个世界坐标多边形加入当前路径
  function poly(world) {
    let pts = world.map((p) => toCam(p[0], p[1], p[2]));
    if (pts.every((p) => p[2] < NEAR)) return false;
    if (pts.some((p) => p[2] < NEAR)) pts = clipNear(pts);
    if (pts.length < 3) return false;
    ctx.moveTo(sx(pts[0]), sy(pts[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i]), sy(pts[i]));
    ctx.closePath();
    return true;
  }
  function quadX(x, y0, y1, z0, z1) { return [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]]; }
  function quadZ(z, x0, x1, y0, y1) { return [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]; }
  function quadY(y, x0, x1, z0, z1) { return [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]; }

  let LIGHT = 1;
  const FOG = 0.055;
  function shade(rgb, dist, extra = 1) {
    const k = LIGHT * extra * Math.exp(-Math.max(0, dist) * FOG);
    return `rgb(${(rgb[0] * k) | 0},${(rgb[1] * k) | 0},${(rgb[2] * k) | 0})`;
  }
  function fillPoly(world, rgb, dist, extra) {
    ctx.beginPath();
    if (poly(world)) { ctx.fillStyle = shade(rgb, dist, extra); ctx.fill(); }
  }
  function glow(img, X, Y, Z, size, alpha) {
    if (alpha <= 0.003) return;
    const c = toCam(X, Y, Z);
    if (c[2] < 1.6) return;
    const s = Math.min(F * 0.09, Math.max(1.6, (size / c[2]) * F));
    const x = sx(c), y = sy(c);
    if (x < -s || x > W + s || y < -s || y > H + s) return;
    ctx.globalAlpha = Math.min(1, alpha * Math.exp(-c[2] * 0.025));
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  }

  /* ---------- 观众厅绘制 ---------- */
  function drawHall(p, house, phones, doorOpen, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const d = (z) => z - cam.z;

    // 天花板、侧墙、地面
    fillPoly(quadY(CEIL, -HALL_X, HALL_X, 0, 32), [30, 10, 11], 12);
    for (const s of [-1, 1]) {
      fillPoly(quadX(s * HALL_X, 0, CEIL, 0, STAGE_Z + 0.4), [64, 14, 18], 10);
      for (let z = 1.5; z < 22; z += 4) fillPoly(quadX(s * (HALL_X - 0.02), 0, CEIL, z, z + 0.7), [86, 22, 24], d(z));
    }
    fillPoly([[-HALL_X, FOYER_Y, 0], [HALL_X, FOYER_Y, 0], [HALL_X, FOYER_Y, 3], [-HALL_X, FOYER_Y, 3]], [44, 11, 13], 2);
    fillPoly([[-HALL_X, FOYER_Y, 3], [HALL_X, FOYER_Y, 3], [HALL_X, 0, 21], [-HALL_X, 0, 21]], [46, 11, 13], 8);
    fillPoly(quadY(0, -HALL_X, HALL_X, 21, STAGE_Z), [30, 8, 10], d(22));
    // 中央过道地毯
    fillPoly([[-1.05, FOYER_Y + 0.005, 0], [1.05, FOYER_Y + 0.005, 0], [1.05, FOYER_Y + 0.005, 3], [-1.05, FOYER_Y + 0.005, 3]], [92, 20, 24], 2);
    fillPoly([[-1.05, FOYER_Y + 0.005, 3], [1.05, FOYER_Y + 0.005, 3], [1.05, 0.005, 21], [-1.05, 0.005, 21]], [92, 20, 24], 8);

    // 吊灯与壁灯
    ctx.globalCompositeOperation = 'lighter';
    glow(WARM, 0, 9.8, 12, 7, 0.55 * house);
    glow(WARM, 0, 9.8, 12, 2.2, 0.9 * house);
    for (const s of [-1, 1]) for (let z = 3.5; z < 22; z += 4) glow(WARM, s * (HALL_X - 0.1), 4.3, z, 1.8, 0.85 * house + 0.05);
    ctx.globalCompositeOperation = 'source-over';

    // 舞台、台口、幕布
    const stageLight = 0.35 + 0.65 * house;
    fillPoly(quadZ(30, -8.6, 8.6, STAGE_Y, 8.6), [36, 6, 8], d(30), stageLight);
    fillPoly(quadY(STAGE_Y, -9.5, 9.5, STAGE_Z, 30), [20, 15, 13], d(26), stageLight);
    fillPoly(quadZ(STAGE_Z, -9.5, 9.5, 0, STAGE_Y), [16, 12, 11], d(STAGE_Z), stageLight);
    for (const s of [-1, 1]) {
      const x0 = s * 8.6, x1 = s * 6.3;
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = x0 + (x1 - x0) * (i / n), b = x0 + (x1 - x0) * ((i + 1) / n);
        fillPoly(quadZ(STAGE_Z + 0.6, Math.min(a, b), Math.max(a, b), STAGE_Y, 8.6), [112, 16, 22], d(STAGE_Z), stageLight * (i % 2 ? 0.7 : 1));
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = -8.6 + i * (17.2 / 14);
      fillPoly(quadZ(STAGE_Z + 0.5, a, a + 17.2 / 14, 7.3, 8.6), [118, 18, 24], d(STAGE_Z), stageLight * (i % 2 ? 0.72 : 1));
    }
    fillPoly(quadZ(STAGE_Z + 0.3, -HALL_X, -8.6, 0, CEIL), [70, 18, 20], d(STAGE_Z));
    fillPoly(quadZ(STAGE_Z + 0.3, 8.6, HALL_X, 0, CEIL), [70, 18, 20], d(STAGE_Z));
    fillPoly(quadZ(STAGE_Z + 0.3, -HALL_X, HALL_X, 8.6, CEIL), [70, 18, 20], d(STAGE_Z));
    // 台口金边
    ctx.beginPath();
    if (poly([[-8.6, 0, STAGE_Z + 0.28], [-8.6, 8.6, STAGE_Z + 0.28], [8.6, 8.6, STAGE_Z + 0.28], [8.6, 0, STAGE_Z + 0.28], [8.4, 0, STAGE_Z + 0.28], [8.4, 8.4, STAGE_Z + 0.28], [-8.4, 8.4, STAGE_Z + 0.28], [-8.4, 0, STAGE_Z + 0.28]])) {
      ctx.fillStyle = shade([170, 128, 64], d(STAGE_Z), 0.9); ctx.fill();
    }
    // 舞台前沿蓝色边光（与 hero-home 照片呼应，灯暗时仍可见）
    ctx.beginPath();
    if (poly([[-9.5, STAGE_Y - 0.02, STAGE_Z - 0.01], [9.5, STAGE_Y - 0.02, STAGE_Z - 0.01], [9.5, STAGE_Y + 0.02, STAGE_Z - 0.01], [-9.5, STAGE_Y + 0.02, STAGE_Z - 0.01]])) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(80,110,255,0.4)'; ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(60,90,255,0.8)'; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.restore();
    }

    // 侧面包厢
    for (const b of boxes) {
      const x = b.side * (HALL_X - 0.03), xr = b.side * (HALL_X - 0.9);
      fillPoly(quadX(x, 3.6, 6.6, b.z - 1.4, b.z + 1.4), [16, 5, 6], d(b.z));
      fillPoly([[xr, 3.6, b.z - 1.4], [xr, 3.6, b.z + 1.4], [xr, 4.35, b.z + 1.4], [xr, 4.35, b.z - 1.4]], [128, 30, 34], d(b.z));
      fillPoly([[xr, 4.3, b.z - 1.4], [xr, 4.3, b.z + 1.4], [xr, 4.42, b.z + 1.4], [xr, 4.42, b.z - 1.4]], [190, 145, 70], d(b.z));
      ctx.globalCompositeOperation = 'lighter';
      for (const l of b.lights) glow(COOL, b.side * (HALL_X - 1.3), l.y, l.z, 0.45, phones * (0.55 + 0.45 * Math.sin(t * l.sp + l.ph)));
      ctx.globalCompositeOperation = 'source-over';
    }

    // 座椅（从远到近）
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      if (row.z < cam.z - 0.5) continue;
      const dist = row.z - cam.z;
      const top = row.fy + 1.0, bot = row.fy + 0.38;
      ctx.beginPath();
      let any = false;
      for (const s of row.seats) {
        any = poly([[s.x - 0.27, bot, row.z], [s.x + 0.27, bot, row.z], [s.x + 0.27, top, row.z], [s.x + 0.18, top + 0.08, row.z], [s.x - 0.18, top + 0.08, row.z], [s.x - 0.27, top, row.z]]) || any;
      }
      if (any) { ctx.fillStyle = shade([150, 24, 32], dist, 1); ctx.fill(); }
      // 椅背顶部高光
      ctx.beginPath(); any = false;
      for (const s of row.seats) any = poly([[s.x - 0.2, top + 0.02, row.z - 0.01], [s.x + 0.2, top + 0.02, row.z - 0.01], [s.x + 0.17, top + 0.08, row.z - 0.01], [s.x - 0.17, top + 0.08, row.z - 0.01]]) || any;
      if (any) { ctx.fillStyle = shade([210, 60, 64], dist, 0.8); ctx.fill(); }
      // 观众头部剪影
      ctx.beginPath(); any = false;
      for (const s of row.seats) {
        if (!s.occupied) continue;
        const c = toCam(s.x, top + 0.3, row.z + 0.25);
        if (c[2] < 1.4) continue;
        const rr = Math.min(F * 0.05, (0.12 / c[2]) * F);
        ctx.moveTo(sx(c) + rr, sy(c));
        ctx.ellipse(sx(c), sy(c), rr, rr * 1.15, 0, 0, Math.PI * 2);
        any = true;
      }
      if (any) { ctx.fillStyle = shade([44, 26, 24], dist, 1); ctx.fill(); }
      // 手机闪光灯
      if (phones > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        for (const s of row.seats) if (s.phone) glow(s.cool ? COOL : WARM, s.px, s.py, row.z + 0.2, 0.5, phones * (0.6 + 0.4 * Math.sin(t * s.sp + s.ph)));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      // 过道台阶灯
      ctx.globalCompositeOperation = 'lighter';
      glow(WARM, -1.08, row.fy + 0.06, row.z, 0.28, 0.75);
      glow(WARM, 1.08, row.fy + 0.06, row.z, 0.28, 0.75);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 二楼楼座（入场时在头顶）
    fillPoly(quadY(5.4, -HALL_X, HALL_X, -3, 8), [34, 10, 11], 4);
    fillPoly(quadZ(8, -HALL_X, HALL_X, 5.4, 6.6), [84, 20, 24], 8);
    fillPoly(quadZ(7.98, -HALL_X, HALL_X, 5.4, 5.55), [180, 136, 66], 8, 0.9);
    ctx.globalCompositeOperation = 'lighter';
    for (let z = 1; z < 8; z += 2.4) for (let x = -8; x <= 8; x += 4) glow(WARM, x, 5.38, z, 0.9, 0.65 * house + 0.08);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 剧场大门
    if (cam.z < 0.4) {
      const o = doorOpen * 1.95;
      fillPoly(quadZ(0.06, -1.85 - o, -o, FOYER_Y, 3.6), [118, 18, 26], 2.5);
      fillPoly(quadZ(0.06, o, 1.85 + o, FOYER_Y, 3.6), [118, 18, 26], 2.5);
      for (const [x0, x1] of [[-1.65 - o, -0.2 - o], [0.2 + o, 1.65 + o]]) {
        fillPoly(quadZ(0.055, x0, x1, 2.25, 3.35), [90, 12, 18], 2.5);
        fillPoly(quadZ(0.055, x0, x1, FOYER_Y + 0.25, 2.05), [90, 12, 18], 2.5);
      }
      fillPoly(quadZ(0.05, -0.22 - o, -0.1 - o, 2.0, 2.5), [205, 160, 80], 2.5);
      fillPoly(quadZ(0.05, 0.1 + o, 0.22 + o, 2.0, 2.5), [205, 160, 80], 2.5);
      if (doorOpen < 0.98) {
        const a = toCam(0, 3.55, 0.03), b2 = toCam(0, FOYER_Y + 0.02, 0.03);
        if (a[2] > NEAR && b2[2] > NEAR) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(255,200,130,${0.9 * (1 - doorOpen)})`; ctx.lineWidth = 2 + doorOpen * 30;
          ctx.shadowColor = 'rgba(255,170,80,1)'; ctx.shadowBlur = 40;
          ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b2), sy(b2)); ctx.stroke(); ctx.restore();
        }
      }
      const wallRGB = [40, 14, 14];
      LIGHT = 1;
      fillPoly(quadZ(0, -HALL_X, -1.85, 0, CEIL), wallRGB, 2.5);
      fillPoly(quadZ(0, 1.85, HALL_X, 0, CEIL), wallRGB, 2.5);
      fillPoly(quadZ(0, -1.85, 1.85, 3.6, CEIL), wallRGB, 2.5);
      fillPoly(quadZ(-0.01, -2.05, 2.05, 3.6, 3.85), [170, 128, 64], 2.5);
      fillPoly(quadY(FOYER_Y, -HALL_X, HALL_X, -4, 0), [26, 12, 12], 1.5);
      ctx.globalCompositeOperation = 'lighter';
      glow(WARM, -3.3, 2.7, -0.05, 1.6, 0.9);
      glow(WARM, 3.3, 2.7, -0.05, 1.6, 0.9);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- 灯亮后的真实舞台照片 ---------- */
  const photo = new Image();
  let photoReady = false;
  photo.onload = () => { photoReady = true; layoutPhoto(); };
  photo.src = 'hero-home.jpeg';
  const PH = { x: 0, y: 0, w: 1, h: 1 };
  // 照片里的位置（相对照片宽高）
  const MIC = { x: 0.338, y: 0.345, top: 0.29, bottom: 1.0 };
  const STOOL = { x0: 0.535, x1: 0.68, y0: 0.73, y1: 1.0 };
  function layoutPhoto() {
    if (!photoReady) return;
    const ir = photo.naturalWidth / photo.naturalHeight;
    const portrait = W / H < 1;
    let w, h;
    if (W / H > ir) { w = W; h = W / ir; } else { h = H; w = H * ir; }
    if (portrait) { h = H * 0.62; w = h * ir; }
    const ox = portrait ? 0.42 : 0.5;
    PH.w = w; PH.h = h;
    PH.x = (W - w) * ox;
    PH.y = portrait ? H * 0.1 : (H - h) * 0.5;
    const toX = (v) => PH.x + v * PH.w, toY = (v) => PH.y + v * PH.h;
    const mic = ui('hot-mic'), stool = ui('hot-stool');
    mic.style.left = toX(MIC.x - 0.05) + 'px'; mic.style.top = toY(MIC.top) + 'px';
    mic.style.width = PH.w * 0.1 + 'px'; mic.style.height = (toY(0.98) - toY(MIC.top)) + 'px';
    stool.style.left = toX(STOOL.x0) + 'px'; stool.style.top = toY(STOOL.y0) + 'px';
    stool.style.width = PH.w * (STOOL.x1 - STOOL.x0) + 'px'; stool.style.height = (Math.min(H, toY(STOOL.y1)) - toY(STOOL.y0)) + 'px';
  }
  const dust = Array.from({ length: 150 }, () => ({ u: rand(), v: rand(), s: 0.4 + rand() * 1.4, ph: rand() * 6.28, sp: 0.2 + rand() * 0.6 }));
  function lightCurve(l) {
    // 先闪两下再稳定点亮，带一点过冲（灯丝预热）
    if (l <= 0) return 0;
    if (l < 0.05) return 0.55;
    if (l < 0.1) return 0.05;
    if (l < 0.15) return 0.8;
    if (l < 0.2) return 0.25;
    const k = (l - 0.2) / 0.8;
    return clamp(1 - Math.pow(1 - k, 3) + 0.16 * Math.sin(Math.PI * k), 0, 1.2);
  }
  function drawStage(b, t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!photoReady) return;
    ctx.globalAlpha = clamp(b);
    ctx.drawImage(photo, PH.x, PH.y, PH.w, PH.h);
    if (b > 1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = b - 1; ctx.drawImage(photo, PH.x, PH.y, PH.w, PH.h); ctx.globalCompositeOperation = 'source-over'; }
    // 竖屏时照片上方补黑渐变，避免硬边
    if (PH.y > 0) {
      const g = ctx.createLinearGradient(0, PH.y, 0, PH.y + PH.h * 0.25);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, PH.y, W, PH.h * 0.25);
    }
    if (PH.y + PH.h < H - 1) {
      const y0 = PH.y + PH.h * 0.82, g = ctx.createLinearGradient(0, y0, 0, PH.y + PH.h);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, y0, W, PH.y + PH.h - y0 + 1);
    }
    // 聚光灯光柱
    const ax = PH.x + 0.385 * PH.w, ay = PH.y - 0.12 * PH.h;
    const bx = PH.x + 0.44 * PH.w, by = PH.y + 1.0 * PH.h;
    const a = clamp(b) * 0.9;
    ctx.globalCompositeOperation = 'screen';
    for (const [spread, alpha] of [[0.25, 0.05], [0.18, 0.06], [0.11, 0.07]]) {
      const half = spread * PH.w;
      const g = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, `rgba(255,232,190,${alpha * 1.6 * a})`);
      g.addColorStop(0.55, `rgba(255,226,180,${alpha * a})`);
      g.addColorStop(1, `rgba(255,220,170,${alpha * 0.4 * a})`);
      ctx.fillStyle = g;
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(ax - half * 0.06, ay); ctx.lineTo(ax + half * 0.06, ay); ctx.lineTo(bx + half, by); ctx.lineTo(bx - half, by); ctx.closePath(); ctx.fill();
    }
    // 地面光斑
    const pool = ctx.createRadialGradient(bx, PH.y + 0.97 * PH.h, 0, bx, PH.y + 0.97 * PH.h, PH.w * 0.26);
    pool.addColorStop(0, `rgba(255,222,170,${0.16 * a})`); pool.addColorStop(1, 'rgba(255,222,170,0)');
    ctx.fillStyle = pool;
    ctx.save(); ctx.translate(bx, PH.y + 0.97 * PH.h); ctx.scale(1, 0.22); ctx.translate(-bx, -(PH.y + 0.97 * PH.h));
    ctx.fillRect(bx - PH.w * 0.3, PH.y + 0.97 * PH.h - PH.w * 0.3, PH.w * 0.6, PH.w * 0.6); ctx.restore();
    // 光柱里的灰尘
    ctx.globalCompositeOperation = 'lighter';
    for (const d of dust) {
      const v = (d.v + t * 0.012 * d.sp) % 1;
      const half = 0.2 * PH.w * v;
      const x = ax + (bx - ax) * v + (d.u - 0.5) * 2 * half + Math.sin(t * d.sp + d.ph) * 6;
      const y = ay + (by - ay) * v;
      ctx.globalAlpha = a * 0.5 * (0.5 + 0.5 * Math.sin(t * 1.3 * d.sp + d.ph)) * (1 - v * 0.6);
      ctx.fillStyle = '#ffe9c4';
      ctx.fillRect(x, y, d.s, d.s);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function vignette(strength) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /* ---------- 声音（默认关闭，WebAudio 合成，无需音频文件） ---------- */
  const sound = { on: false, ac: null, murmur: null };
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const len = ac.sampleRate * 3, buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.2; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(ac.destination); src.start();
    sound.ac = ac; sound.murmur = g;
  }
  function clickSound() {
    if (!sound.on || !sound.ac) return;
    const ac = sound.ac, now = ac.currentTime;
    const n = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = ac.createBufferSource(); s.buffer = n;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.4;
    const g = ac.createGain(); g.gain.value = 0.9;
    s.connect(bp).connect(g).connect(ac.destination); s.start(now);
    const o = ac.createOscillator(); o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    const og = ac.createGain(); og.gain.setValueAtTime(0.35, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(og).connect(ac.destination); o.start(now); o.stop(now + 0.3);
  }
  ui('sound').addEventListener('click', () => {
    sound.on = !sound.on;
    if (sound.on && !sound.ac) initAudio();
    if (sound.ac && sound.ac.state === 'suspended') sound.ac.resume();
    ui('sound').setAttribute('aria-pressed', String(sound.on));
    applyCopy();
  });

  /* ---------- 交互 ---------- */
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    state.mx = e.clientX / innerWidth - 0.5;
    state.my = e.clientY / innerHeight - 0.5;
  }, { passive: true });
  ui('skip').addEventListener('click', () => {
    const top = root.getBoundingClientRect().top + scrollY;
    scrollTo({ top: top + (root.offsetHeight - innerHeight) * 0.97, behavior: 'smooth' });
  });
  ui('replay').addEventListener('click', () => {
    if (location.search.indexOf('intro=') < 0) history.replaceState(null, '', location.pathname + location.hash);
    setMode('full');
    scrollTo({ top: root.getBoundingClientRect().top + scrollY - 1, behavior: 'auto' });
  });
  addEventListener('hashchange', () => {
    if (route() === 'home') { if (mode === 'off') setMode('stage'); }
    else if (mode !== 'off') setMode('off');
  });

  /* ---------- 主循环 ---------- */
  let raf = 0, last = 0;
  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    if (mode === 'off') return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    state.time += dt;
    const rect = root.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    if (mode === 'full') {
      const total = Math.max(1, root.offsetHeight - innerHeight);
      state.target = clamp(-rect.top / total);
    }
    state.p += (state.target - state.p) * (1 - Math.exp(-dt * 5));
    if (Math.abs(state.target - state.p) < 0.0005) state.p = state.target;
    const p = state.p, t = state.time;

    // 灯亮：越过 0.8 后按时间播放点亮动画，往回滚则熄灭
    state.litTarget = mode === 'stage' || p >= 0.8 ? 1 : p < 0.77 ? 0 : state.litTarget;
    if (state.litTarget && state.lit === 0 && mode === 'full') clickSound();
    state.lit = state.litTarget ? Math.min(1, state.lit + dt / (reduceMotion ? 0.01 : 1.15)) : Math.max(0, state.lit - dt / 0.45);
    if (p > 0.95 && mode === 'full') markSeen();

    if (renderedLang !== curLang()) applyCopy();

    // 视线跟随（鼠标），手机上做缓慢呼吸晃动
    const autoX = Math.sin(t * 0.35) * 0.08, autoY = Math.sin(t * 0.27) * 0.05;
    const mx = state.mx || autoX * 0.5, my = state.my || autoY * 0.5;
    const k = 1 - Math.exp(-dt * 3.5);
    state.yaw += (mx * 0.24 - state.yaw) * k;
    state.pitch += (-my * 0.12 - state.pitch) * k;

    // 相机路径：门口 → 过道 → 舞台前
    const doorOpen = smooth(0.015, 0.1, p);
    let z;
    if (p < 0.1) z = -2.6 + 1.0 * smooth(0, 0.1, p);
    else z = -1.6 + 21.2 * easeInOut(clamp((p - 0.1) / 0.64));
    const walking = p > 0.1 && p < 0.74 ? 1 : 0;
    cam.x = Math.sin(z * 0.9) * 0.04 * walking;
    cam.z = z;
    cam.y = floorY(z) + 1.62 + Math.sin(z * 4.2) * 0.025 * walking;
    const yaw = state.yaw, pitch = state.pitch - 0.035;
    cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);

    const house = 1 - 0.5 * smooth(0.3, 0.6, p) - 0.5 * smooth(0.62, 0.76, p);
    const phones = smooth(0.32, 0.5, p) * (1 - smooth(0.76, 0.8, p));
    const dark = smooth(0.71, 0.79, p);
    LIGHT = 0.16 + 0.84 * house;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const b = lightCurve(state.lit);
    if (b > 0 && state.lit > 0) {
      drawStage(b, t);
      vignette(0.55);
    } else {
      if (dark < 1) drawHall(p, house, phones, doorOpen, t);
      ctx.globalAlpha = 1;
      vignette(0.65);
      if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
    }

    // 界面层
    const lit = state.lit;
    const set = (name, o) => { const el = ui(name); el.style.opacity = o.toFixed(3); el.style.visibility = o < 0.01 ? 'hidden' : 'visible'; };
    set('brand', mode === 'full' ? 1 - smooth(0.04, 0.1, p) : 0);
    set('line1', band(p, 0.16, 0.34));
    set('line2', band(p, 0.42, 0.62));
    set('line3', band(p, 0.67, 0.77, 0.02));
    set('hero', smooth(0.55, 0.95, lit));
    set('hot-mic', smooth(0.85, 1, lit));
    set('hot-stool', smooth(0.85, 1, lit));
    set('skip', mode === 'full' ? 1 - smooth(0.82, 0.9, p) : 0);
    set('replay', mode === 'stage' || p > 0.96 ? smooth(0.6, 1, lit) : 0);
    ui('hint').textContent = COPY[curLang()][p > 0.85 || mode === 'stage' ? 'next' : 'enter'];
    if (sound.murmur) sound.murmur.gain.setTargetAtTime(sound.on ? 0.05 * house * (1 - dark) + (lit > 0 ? 0.008 : 0) : 0, sound.ac.currentTime, 0.2);
  }

  /* ---------- 加载页 ---------- */
  function finishLoader() {
    const loader = ui('loader');
    if (!loader) return;
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 900);
  }

  applyCopy();
  const m = initialMode();
  setMode(m);
  if (m !== 'off') {
    const t0 = performance.now();
    const ready = () => setTimeout(finishLoader, Math.max(0, 1100 - (performance.now() - t0)));
    if (photoReady) ready(); else { photo.addEventListener('load', ready); photo.addEventListener('error', ready); }
  } else finishLoader();
})();
