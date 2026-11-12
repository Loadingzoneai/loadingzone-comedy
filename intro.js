/* 候场喜剧 · 剧场入场
 * 不依赖第三方库：Canvas 2D 程序化绘制观众厅，打开首页后自动播放镜头走向舞台，
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
  // 自动播放时间轴（秒）：开门 → 走过道 → 暗场 → 灯亮
  const TIMELINE = [[0, 0], [4.5, 0.1], [20.5, 0.74], [22.8, 0.8], [25, 1]];
  const LIGHT_AT = 22.8;
  function timeToP(sec) {
    for (let i = 1; i < TIMELINE.length; i++) {
      const [t0, p0] = TIMELINE[i - 1], [t1, p1] = TIMELINE[i];
      if (sec <= t1) return p0 + (p1 - p0) * clamp((sec - t0) / (t1 - t0));
    }
    return 1;
  }
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
    root.style.height = '100vh';
    if (m === 'stage') { state.p = state.target = 1; state.lit = 1; state.litTarget = 1; }
    if (m === 'full') { state.p = state.target = 0; state.lit = 0; state.litTarget = 0; state.clock = 0; }
    if (m !== 'off') { resize(); start(); }
  }

  /* ---------- 状态 ---------- */
  const state = { p: 0, target: 0, lit: 0, litTarget: 0, mx: 0, my: 0, yaw: 0, pitch: 0, time: 0, clicked: false, clock: 0, playing: false };

  /* ---------- 画布尺寸 ---------- */
  let W = 0, H = 0, DPR = 1, F = 600;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.25 : 1.75);
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

  /* ---------- 剧场几何（单位：米）：参考老式华丽剧院（金色雕花墙、菱格天花、弧形楼座、弧形红座椅） ---------- */
  const HW = 12, CEIL = 13.5, STAGE_Z = 23, STAGE_Y = 1.05, FOYER_Y = 0.85;
  const floorY = (z) => (z < 3 ? FOYER_Y : z < 21.5 ? FOYER_Y * (21.5 - z) / 18.5 : 0);
  const ROW_CENTER_Z = 36;           // 座椅弧线圆心（舞台后方），形成向舞台弯曲的弧形排
  const rows = [];
  (function buildSeats() {
    for (let r = 0; r < 17; r++) {
      const zMid = 3.5 + r * 1.0;
      const R = ROW_CENTER_Z - zMid;
      const seats = [];
      const blocks = [[1.25, 6.5], [7.6, 11.4]];
      for (const side of [-1, 1]) for (const [a, b] of blocks) {
        const n = Math.floor((b - a) / 0.58);
        for (let i = 0; i <= n; i++) {
          const arc = side * (a + i * 0.58);
          const th = arc / R;
          const x = R * Math.sin(th), z = ROW_CENTER_Z - R * Math.cos(th);
          const fy = floorY(z);
          const occupied = rand() < 0.72;
          const phone = occupied && rand() < 0.38;
          seats.push({ x, z, fy, tx: Math.cos(th), tz: Math.sin(th), end: i === 0 || i === n, occupied, phone,
            px: x + (rand() - 0.5) * 0.25, py: fy + 1.45 + rand() * 0.35, ph: rand() * 6.28, sp: 1 + rand() * 2.5, cool: rand() < 0.8 });
        }
      }
      rows.push({ z: zMid, seats });
    }
  })();
  const balconyFront = (x) => 7.2 + 2.2 * (1 - (x / HW) * (x / HW));
  const vines = Array.from({ length: 16 }, (_, i) => ({ x: -6.4 + i * 0.85 + (rand() - 0.5) * 0.3, len: 1.2 + rand() * 2.2 }));

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
  // 线段加入当前路径（近平面裁剪）
  function seg(a, b) {
    let p = toCam(a[0], a[1], a[2]), q = toCam(b[0], b[1], b[2]);
    if (p[2] < NEAR && q[2] < NEAR) return false;
    if (p[2] < NEAR) { const t = (NEAR - p[2]) / (q[2] - p[2]); p = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, NEAR]; }
    if (q[2] < NEAR) { const t = (NEAR - q[2]) / (p[2] - q[2]); q = [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t, NEAR]; }
    ctx.moveTo(sx(p), sy(p)); ctx.lineTo(sx(q), sy(q));
    return true;
  }
  const quadX = (x, y0, y1, z0, z1) => [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]];
  const quadZ = (z, x0, x1, y0, y1) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const quadY = (y, x0, x1, z0, z1) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  // 墙面上的拱形（x 平面），用于侧墙拱龛与门洞
  function archX(x, z0, z1, y0, y1) {
    const pts = [[x, y0, z0], [x, y0, z1]];
    const r = (z1 - z0) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push([x, y1 + Math.sin(a) * r, cz + Math.cos(a) * r]); }
    return pts;
  }
  function ovalX(x, cz, cy, rz, ry, n = 14) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([x, cy + Math.sin(a) * ry, cz + Math.cos(a) * rz]); }
    return pts;
  }

  let LIGHT = 1;
  const FOG = 0.028;
  function shade(rgb, dist, extra = 1) {
    const k = LIGHT * extra * Math.exp(-Math.max(0, dist) * FOG);
    return `rgb(${Math.min(255, rgb[0] * k) | 0},${Math.min(255, rgb[1] * k) | 0},${Math.min(255, rgb[2] * k) | 0})`;
  }
  function fillPoly(world, rgb, dist, extra) {
    ctx.beginPath();
    if (poly(world)) { ctx.fillStyle = shade(rgb, dist, extra); ctx.fill(); }
  }
  function glow(img, X, Y, Z, size, alpha) {
    if (alpha <= 0.003) return;
    const c = toCam(X, Y, Z);
    if (c[2] < 1.6) return;
    const s = Math.min(F * 0.12, Math.max(1.6, (size / c[2]) * F));
    const x = sx(c), y = sy(c);
    if (x < -s || x > W + s || y < -s || y > H + s) return;
    ctx.globalAlpha = Math.min(1, alpha * Math.exp(-c[2] * 0.02));
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  }
  function strokeWith(rgb, dist, width, extra = 1) {
    ctx.strokeStyle = shade(rgb, dist, extra);
    ctx.lineWidth = width; ctx.stroke();
  }
  // 吊灯：一簇暖光 + 冷色水晶点
  function chandelier(X, Y, Z, scale, alpha) {
    glow(WARM, X, Y, Z, 4.5 * scale, 0.45 * alpha);
    glow(WARM, X, Y, Z, 1.6 * scale, 0.9 * alpha);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      glow(COOL, X + Math.cos(a) * 0.5 * scale, Y - 0.25 * scale - (i % 2) * 0.2 * scale, Z + Math.sin(a) * 0.5 * scale, 0.5 * scale, 0.8 * alpha);
    }
  }

  /* ---------- 观众厅绘制 ---------- */
  const GOLD = [196, 136, 62], GOLD_DARK = [128, 80, 34], GOLD_LIGHT = [236, 190, 110];
  function drawHall(p, house, phones, doorOpen, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const d = (z) => z - cam.z;
    const add = () => { ctx.globalCompositeOperation = 'lighter'; };
    const normal = () => { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; };

    // 天花：深金底 + 菱格纹 + 中央椭圆穹顶
    fillPoly(quadY(CEIL, -HW, HW, -4, STAGE_Z + 0.4), [104, 70, 32], 12);
    ctx.beginPath();
    for (let k = -HW - 28; k <= HW + 28; k += 1.3) {
      // x + z = k 与 x - z = k 两组斜线，裁剪到天花矩形
      for (const s of [1, -1]) {
        const pts = [];
        for (const x of [-HW, HW]) { const z = s * (k - x); if (z >= -4 && z <= STAGE_Z) pts.push([x, CEIL - 0.01, z]); }
        for (const z of [-4, STAGE_Z]) { const x = k - s * z; if (x >= -HW && x <= HW) pts.push([x, CEIL - 0.01, z]); }
        if (pts.length >= 2) seg(pts[0], pts[1]);
      }
    }
    strokeWith([210, 160, 84], 12, 1);
    const domeZ = 12.5;
    const ring = (r, y) => Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * Math.PI * 2; return [Math.cos(a) * r * 1.5, y, domeZ + Math.sin(a) * r]; });
    fillPoly(ring(3.6, CEIL - 0.02), [214, 160, 80], d(domeZ));
    fillPoly(ring(3.0, CEIL - 0.03), [70, 84, 120], d(domeZ));
    fillPoly(ring(2.4, CEIL - 0.04), [150, 120, 80], d(domeZ));
    add();
    glow(BLUE, 0, CEIL - 0.1, domeZ, 7, 0.25 * house + 0.05);
    chandelier(0, CEIL - 1.8, domeZ, 1.6, house);
    normal();

    // 侧墙：金色墙面、壁柱、装饰画框、椭圆肖像、上方拱龛（内有小吊灯）、壁灯
    for (const s of [-1, 1]) {
      const X = s * HW;
      fillPoly(quadX(X, 0, CEIL, -4, STAGE_Z + 0.4), [178, 116, 48], 10);
      fillPoly(quadX(X - s * 0.01, 8.6, 9.0, -4, STAGE_Z + 0.4), GOLD_LIGHT, 10, 0.9);
      for (let z = -1; z < 21; z += 3.6) {
        const zc = z + 1.8;
        fillPoly(quadX(X - s * 0.02, 0, 8.6, z - 0.25, z + 0.25), [214, 156, 72], d(z));
        fillPoly(quadX(X - s * 0.02, 1.4, 7.4, zc - 0.9, zc + 0.9), GOLD_DARK, d(zc));
        fillPoly(quadX(X - s * 0.03, 1.55, 7.25, zc - 0.78, zc + 0.78), [190, 128, 56], d(zc));
        fillPoly(ovalX(X - s * 0.04, zc, 5.6, 0.5, 0.65), GOLD_LIGHT, d(zc));
        fillPoly(ovalX(X - s * 0.05, zc, 5.6, 0.38, 0.52), [80, 50, 30], d(zc));
        fillPoly(archX(X - s * 0.02, zc - 1.2, zc + 1.2, 9.2, 11.2), [236, 176, 96], d(zc), 1.05);
        fillPoly(archX(X - s * 0.03, zc - 0.95, zc + 0.95, 9.4, 11.2), [150, 30, 36], d(zc));
      }
      add();
      for (let z = -1; z < 21; z += 3.6) {
        const zc = z + 1.8;
        glow(WARM, X - s * 0.15, 3.3, z, 3.2, 0.32 * house + 0.03);
        glow(WARM, X - s * 0.15, 3.3, z, 0.7, 0.9 * house + 0.1);
        chandelier(X - s * 0.6, 10.6, zc, 0.55, house);
      }
      normal();
    }

    // 地面：红色花纹地毯
    fillPoly([[-HW, FOYER_Y, -4], [HW, FOYER_Y, -4], [HW, FOYER_Y, 3], [-HW, FOYER_Y, 3]], [118, 22, 26], 2);
    fillPoly([[-HW, FOYER_Y, 3], [HW, FOYER_Y, 3], [HW, 0, 21.5], [-HW, 0, 21.5]], [122, 22, 26], 8);
    fillPoly(quadY(0, -HW, HW, 21.5, STAGE_Z), [90, 16, 20], d(22));
    ctx.beginPath();
    for (let z = 3.6; z < 21.5; z += 0.9) seg([-1.1, floorY(z) + 0.01, z], [1.1, floorY(z) + 0.01, z]);
    seg([-1.1, FOYER_Y + 0.01, -4], [-1.1, floorY(21) + 0.01, 21]);
    seg([1.1, FOYER_Y + 0.01, -4], [1.1, floorY(21) + 0.01, 21]);
    strokeWith([200, 120, 60], 6, 1, 0.8);

    // 台口与舞台：金色雕花台框、红色边柱、刺绣红幕、酒红帷幔
    const stageLight = 0.45 + 0.55 * house;
    const PZ = STAGE_Z + 0.3, PX = 7.2, PY = 8.8;
    fillPoly(quadZ(PZ, -HW, -PX - 0.9, 0, CEIL), [186, 124, 52], d(PZ));
    fillPoly(quadZ(PZ, PX + 0.9, HW, 0, CEIL), [186, 124, 52], d(PZ));
    fillPoly(quadZ(PZ, -HW, HW, PY + 0.9, CEIL), [186, 124, 52], d(PZ));
    for (const s of [-1, 1]) {
      fillPoly(quadZ(PZ - 0.02, s > 0 ? PX : -PX - 0.9, s > 0 ? PX + 0.9 : -PX, STAGE_Y, PY + 0.9), [196, 34, 48], d(PZ));
      fillPoly(quadZ(PZ - 0.03, s > 0 ? PX + 0.35 : -PX - 0.55, s > 0 ? PX + 0.55 : -PX - 0.35, STAGE_Y, PY + 0.6), [236, 120, 120], d(PZ), 0.9);
      // 台口两侧的拱门 + 金色铁艺门
      const gx0 = s > 0 ? 8.9 : -11.1, gx1 = s > 0 ? 11.1 : -8.9;
      fillPoly([[gx0, 0, PZ - 0.04], [gx1, 0, PZ - 0.04], [gx1, 3.2, PZ - 0.04], [(gx0 + gx1) / 2, 4.2, PZ - 0.04], [gx0, 3.2, PZ - 0.04]], [60, 30, 18], d(PZ));
      ctx.beginPath();
      for (let x = gx0 + 0.2; x < gx1; x += 0.3) seg([x, 0.1, PZ - 0.05], [x, 3.2, PZ - 0.05]);
      for (let y = 0.4; y < 3.2; y += 0.6) seg([gx0, y, PZ - 0.05], [gx1, y, PZ - 0.05]);
      strokeWith(GOLD_LIGHT, d(PZ), 1.2, 0.9);
      // 包厢：酒红帷幔
      fillPoly([[gx0 + 0.2, 4.9, PZ - 0.04], [gx1 - 0.2, 4.9, PZ - 0.04], [gx1 - 0.2, 7.6, PZ - 0.04], [gx0 + 0.2, 7.6, PZ - 0.04]], [70, 12, 18], d(PZ));
      fillPoly([[gx0 + 0.2, 7.6, PZ - 0.06], [gx1 - 0.2, 7.6, PZ - 0.06], [(gx0 + gx1) / 2, 6.6, PZ - 0.06]], [140, 22, 34], d(PZ));
      fillPoly([[gx0 + 0.2, 7.6, PZ - 0.06], [gx0 + 0.75, 7.6, PZ - 0.06], [gx0 + 0.55, 4.9, PZ - 0.06], [gx0 + 0.2, 4.9, PZ - 0.06]], [150, 24, 36], d(PZ));
      fillPoly([[gx1 - 0.75, 7.6, PZ - 0.06], [gx1 - 0.2, 7.6, PZ - 0.06], [gx1 - 0.2, 4.9, PZ - 0.06], [gx1 - 0.55, 4.9, PZ - 0.06]], [150, 24, 36], d(PZ));
      add(); glow(WARM, (gx0 + gx1) / 2, 6.0, PZ - 0.3, 1.0, 0.8 * house + 0.1); normal();
    }
    // 台框金色线脚
    ctx.beginPath();
    seg([-PX - 0.9, PY + 0.9, PZ - 0.05], [PX + 0.9, PY + 0.9, PZ - 0.05]);
    seg([-PX - 1.1, PY + 1.15, PZ - 0.05], [PX + 1.1, PY + 1.15, PZ - 0.05]);
    seg([-PX - 0.9, 0, PZ - 0.05], [-PX - 0.9, PY + 0.9, PZ - 0.05]);
    seg([PX + 0.9, 0, PZ - 0.05], [PX + 0.9, PY + 0.9, PZ - 0.05]);
    strokeWith(GOLD_LIGHT, d(PZ), 2.2);
    // 大幕
    const CZ = PZ + 0.5;
    for (let i = 0; i < 20; i++) {
      const a = -PX + i * (2 * PX / 20);
      fillPoly(quadZ(CZ, a, a + 2 * PX / 20, STAGE_Y, PY), [176, 30, 32], d(CZ), stageLight * (i % 2 ? 0.78 : 1));
    }
    fillPoly(quadZ(CZ - 0.02, -PX, PX, STAGE_Y + 0.15, STAGE_Y + 0.75), [200, 146, 66], d(CZ), stageLight);
    fillPoly(quadZ(CZ - 0.03, -PX, PX, STAGE_Y + 0.32, STAGE_Y + 0.58), [150, 40, 30], d(CZ), stageLight);
    ctx.beginPath();
    for (const v of vines) {
      seg([v.x, PY - 0.6, CZ - 0.03], [v.x + 0.1, PY - 0.6 - v.len, CZ - 0.03]);
      for (let y = PY - 0.8; y > PY - 0.6 - v.len; y -= 0.28) { seg([v.x, y, CZ - 0.03], [v.x - 0.18, y - 0.16, CZ - 0.03]); seg([v.x, y, CZ - 0.03], [v.x + 0.18, y - 0.16, CZ - 0.03]); }
    }
    strokeWith([226, 176, 96], d(CZ), 1.4, stageLight);
    // 顶部帷幔（垂花）
    for (let i = 0; i < 7; i++) {
      const a = -PX + i * (2 * PX / 7), b = a + 2 * PX / 7;
      const pts = [[a, PY + 0.02, CZ - 0.1], [b, PY + 0.02, CZ - 0.1]];
      for (let k = 1; k < 8; k++) { const u = k / 8; pts.push([b - (b - a) * u, PY - 0.25 - Math.sin(u * Math.PI) * 0.75, CZ - 0.1]); }
      fillPoly(pts, [120, 18, 26], d(CZ), stageLight);
    }
    // 舞台台面与台口前沿
    fillPoly(quadY(STAGE_Y, -PX - 0.9, PX + 0.9, STAGE_Z, CZ), [48, 32, 22], d(STAGE_Z), stageLight);
    fillPoly(quadZ(STAGE_Z, -PX - 0.9, PX + 0.9, 0, STAGE_Y), [18, 14, 12], d(STAGE_Z));
    fillPoly(quadZ(STAGE_Z - 0.01, -PX - 0.9, PX + 0.9, 0.05, 0.3), [168, 120, 56], d(STAGE_Z), 0.8);
    ctx.beginPath();
    if (poly(quadZ(STAGE_Z - 0.02, -PX - 0.9, PX + 0.9, STAGE_Y - 0.02, STAGE_Y + 0.02))) {
      ctx.save(); add();
      ctx.strokeStyle = 'rgba(80,110,255,0.4)'; ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(60,90,255,0.8)'; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.restore();
    }

    // 座椅：弧形排，从远到近
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      if (row.z < cam.z - 1) continue;
      const dist = row.z - cam.z;
      ctx.beginPath(); let any = false;
      for (const s of row.seats) {
        const top = s.fy + 1.0, bot = s.fy + 0.38, hx = 0.27 * s.tx, hz = 0.27 * s.tz;
        any = poly([[s.x - hx, bot, s.z - hz], [s.x + hx, bot, s.z + hz], [s.x + hx, top, s.z + hz], [s.x + hx * 0.7, top + 0.09, s.z + hz * 0.7], [s.x - hx * 0.7, top + 0.09, s.z - hz * 0.7], [s.x - hx, top, s.z - hz]]) || any;
      }
      if (any) { ctx.fillStyle = shade([206, 26, 36], dist); ctx.fill(); }
      ctx.beginPath(); any = false;
      for (const s of row.seats) {
        const top = s.fy + 1.0, hx = 0.22 * s.tx, hz = 0.22 * s.tz;
        any = poly([[s.x - hx, top + 0.01, s.z - hz - 0.01], [s.x + hx, top + 0.01, s.z + hz - 0.01], [s.x + hx * 0.8, top + 0.09, s.z + hz * 0.8 - 0.01], [s.x - hx * 0.8, top + 0.09, s.z - hz * 0.8 - 0.01]]) || any;
      }
      if (any) { ctx.fillStyle = shade([246, 84, 80], dist, 0.85); ctx.fill(); }
      // 排尾木质侧板
      ctx.beginPath(); any = false;
      for (const s of row.seats) if (s.end) {
        const ex = s.x + Math.sign(s.x) * -0.3 * s.tx;
        any = poly([[ex, s.fy, s.z - 0.25], [ex, s.fy, s.z + 0.2], [ex, s.fy + 0.6, s.z + 0.2], [ex, s.fy + 0.68, s.z - 0.25]]) || any;
      }
      if (any) { ctx.fillStyle = shade([132, 88, 44], dist); ctx.fill(); }
      // 观众头部
      ctx.beginPath(); any = false;
      for (const s of row.seats) {
        if (!s.occupied) continue;
        const c = toCam(s.x, s.fy + 1.3, s.z + 0.25);
        if (c[2] < 1.4) continue;
        const rr = Math.min(F * 0.05, (0.12 / c[2]) * F);
        ctx.moveTo(sx(c) + rr, sy(c)); ctx.ellipse(sx(c), sy(c), rr, rr * 1.15, 0, 0, Math.PI * 2);
        any = true;
      }
      if (any) { ctx.fillStyle = shade([44, 26, 24], dist); ctx.fill(); }
      add();
      if (phones > 0.01) for (const s of row.seats) if (s.phone) glow(s.cool ? COOL : WARM, s.px, s.py, s.z + 0.2, 0.5, phones * (0.6 + 0.4 * Math.sin(t * s.sp + s.ph)));
      glow(WARM, -1.1, floorY(row.z) + 0.06, row.z, 0.28, 0.7);
      glow(WARM, 1.1, floorY(row.z) + 0.06, row.z, 0.28, 0.7);
      normal();
    }

    // 弧形楼座（入场时在头顶）：雕花金色底面 + 金色栏板
    const N = 18;
    const front = Array.from({ length: N + 1 }, (_, i) => -HW + (2 * HW * i) / N);
    const under = [[-HW, 5.6, -4], [HW, 5.6, -4]];
    for (let i = N; i >= 0; i--) under.push([front[i], 5.6, balconyFront(front[i])]);
    fillPoly(under, [150, 98, 44], 4);
    ctx.beginPath();
    for (const k of [0.55, 0.75, 0.9]) for (let i = 0; i < N; i++) {
      const x0 = front[i] * k, x1 = front[i + 1] * k;
      seg([x0, 5.59, -4 + (balconyFront(x0) + 4) * k], [x1, 5.59, -4 + (balconyFront(x1) + 4) * k]);
    }
    strokeWith(GOLD_LIGHT, 4, 1.4);
    for (let i = 0; i < N; i++) {
      const x0 = front[i], x1 = front[i + 1], z0 = balconyFront(x0), z1 = balconyFront(x1);
      fillPoly([[x0, 5.6, z0], [x1, 5.6, z1], [x1, 7.3, z1], [x0, 7.3, z0]], GOLD, (z0 + z1) / 2 - cam.z);
      fillPoly([[x0, 6.05, z0 + 0.01], [x1, 6.05, z1 + 0.01], [x1, 6.85, z1 + 0.01], [x0, 6.85, z0 + 0.01]], [214, 196, 160], (z0 + z1) / 2 - cam.z, 0.85);
    }
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x0 = front[i], x1 = front[i + 1];
      for (const y of [5.65, 6.0, 6.9, 7.25]) seg([x0, y, balconyFront(x0) + 0.02], [x1, y, balconyFront(x1) + 0.02]);
      for (let u = 0; u < 1; u += 0.34) { const xa = x0 + (x1 - x0) * u, xb = x0 + (x1 - x0) * (u + 0.17); seg([xa, 6.1, balconyFront(xa) + 0.02], [xb, 6.8, balconyFront(xb) + 0.02]); seg([xb, 6.1, balconyFront(xb) + 0.02], [xa, 6.8, balconyFront(xa) + 0.02]); }
    }
    strokeWith([150, 92, 40], 6, 1.3);
    add();
    for (let z = -2; z < 7; z += 2.6) for (let x = -9; x <= 9; x += 4.5) if (z < balconyFront(x) - 0.5) glow(WARM, x, 5.58, z, 1.0, 0.7 * house + 0.08);
    normal();

    // 剧院大门（入口）
    if (cam.z < 0.4) {
      const o = doorOpen * 1.95;
      fillPoly(quadZ(0.06, -1.85 - o, -o, FOYER_Y, 3.6), [140, 22, 30], 2.5);
      fillPoly(quadZ(0.06, o, 1.85 + o, FOYER_Y, 3.6), [140, 22, 30], 2.5);
      for (const [x0, x1] of [[-1.65 - o, -0.2 - o], [0.2 + o, 1.65 + o]]) {
        fillPoly(quadZ(0.055, x0, x1, 2.25, 3.35), [110, 16, 24], 2.5);
        fillPoly(quadZ(0.055, x0, x1, FOYER_Y + 0.25, 2.05), [110, 16, 24], 2.5);
      }
      fillPoly(quadZ(0.05, -0.22 - o, -0.1 - o, 2.0, 2.5), GOLD_LIGHT, 2.5);
      fillPoly(quadZ(0.05, 0.1 + o, 0.22 + o, 2.0, 2.5), GOLD_LIGHT, 2.5);
      if (doorOpen < 0.98) {
        const a = toCam(0, 3.55, 0.03), b2 = toCam(0, FOYER_Y + 0.02, 0.03);
        if (a[2] > NEAR && b2[2] > NEAR) {
          ctx.save(); add();
          ctx.strokeStyle = `rgba(255,200,130,${0.9 * (1 - doorOpen)})`; ctx.lineWidth = 2 + doorOpen * 30;
          ctx.shadowColor = 'rgba(255,170,80,1)'; ctx.shadowBlur = 40;
          ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b2), sy(b2)); ctx.stroke(); ctx.restore();
        }
      }
      LIGHT = 1;
      const wall = [150, 98, 44];
      fillPoly(quadZ(0, -HW, -1.85, 0, CEIL), wall, 2.5);
      fillPoly(quadZ(0, 1.85, HW, 0, CEIL), wall, 2.5);
      fillPoly(quadZ(0, -1.85, 1.85, 3.6, CEIL), wall, 2.5);
      fillPoly([[-2.3, 3.6, -0.02], [2.3, 3.6, -0.02], [2.3, 4.0, -0.02], [0, 4.7, -0.02], [-2.3, 4.0, -0.02]], GOLD_LIGHT, 2.5, 0.9);
      fillPoly(quadZ(-0.015, -2.3, -1.85, FOYER_Y, 3.6), GOLD, 2.5);
      fillPoly(quadZ(-0.015, 1.85, 2.3, FOYER_Y, 3.6), GOLD, 2.5);
      for (const s of [-1, 1]) {
        fillPoly(quadZ(-0.015, s * 3.2 - 0.9, s * 3.2 + 0.9, 1.4, 4.6), GOLD_DARK, 2.5);
        fillPoly(quadZ(-0.02, s * 3.2 - 0.75, s * 3.2 + 0.75, 1.55, 4.45), [176, 116, 50], 2.5);
      }
      fillPoly(quadY(FOYER_Y, -HW, HW, -4, 0), [96, 18, 22], 1.5);
      add();
      glow(WARM, -4.6, 2.9, -0.05, 2.4, 0.7);
      glow(WARM, 4.6, 2.9, -0.05, 2.4, 0.7);
      glow(WARM, -4.6, 2.9, -0.05, 0.6, 1);
      glow(WARM, 4.6, 2.9, -0.05, 0.6, 1);
      normal();
    }

    // 暖色空气感 + 胶片颗粒
    const haze = ctx.createLinearGradient(0, 0, 0, H);
    haze.addColorStop(0, `rgba(255,170,80,${0.10 * house})`);
    haze.addColorStop(0.5, `rgba(255,150,70,${0.04 * house})`);
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    add(); ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H); normal();
    ctx.globalAlpha = 0.08; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grainPattern;
    ctx.save(); ctx.translate((t * 997) % 128, (t * 613) % 128); ctx.fillRect(-128, -128, W + 256, H + 256); ctx.restore();
    normal();
  }
  const grainPattern = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  })();

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
  ui('skip').addEventListener('click', () => { state.playing = true; state.clock = Math.max(state.clock, LIGHT_AT - 0.6); });
  ui('replay').addEventListener('click', () => {
    if (location.search.indexOf('intro=') < 0) history.replaceState(null, '', location.pathname + location.hash);
    setMode('full');
    state.playing = true;
    scrollTo({ top: Math.max(0, root.getBoundingClientRect().top + scrollY - 1), behavior: 'auto' });
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
    if (mode === 'full' && state.playing) state.clock += dt;
    const rect = root.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    if (mode === 'full') state.p = state.target = timeToP(state.clock);
    const p = state.p, t = state.time;

    // 灯亮：越过 0.8 后按时间播放点亮动画，往回滚则熄灭
    state.litTarget = mode === 'stage' || p >= 0.8 ? 1 : 0;
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
    else z = -1.6 + 11.8 * easeInOut(clamp((p - 0.1) / 0.64));
    const walking = p > 0.1 && p < 0.74 ? 1 : 0;
    cam.x = Math.sin(z * 0.9) * 0.04 * walking;
    cam.z = z;
    cam.y = floorY(z) + 2.35 + Math.sin(z * 4.2) * 0.025 * walking;
    const yaw = state.yaw, pitch = state.pitch - 0.11 + 0.05 * smooth(0.5, 0.74, p);
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
    ui('hint').textContent = COPY[curLang()].next;
    set('hint', smooth(0.7, 1, lit));
    if (sound.murmur) sound.murmur.gain.setTargetAtTime(sound.on ? 0.05 * house * (1 - dark) + (lit > 0 ? 0.008 : 0) : 0, sound.ac.currentTime, 0.2);
  }

  /* ---------- 加载页 ---------- */
  function finishLoader() {
    const loader = ui('loader');
    if (!loader) { state.playing = true; return; }
    loader.classList.add('done');
    state.playing = true;
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
