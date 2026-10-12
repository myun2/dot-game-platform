/* editor.js — 開発画面（コード・スプライト・マップ・サウンドの各エディタとカートの出し入れ）
   編集中のカート（rom）の配列は実機と共有しているので、必ず中身を書き換える。差し替えるのは setRom だけ。 */
(function (root) {
  'use strict';
  const C = root.DotCore, Player = root.DotPlayer, Carts = root.DotCarts;
  const { TILE, SHEET, SHEET_PX, MAP_W, MAP_H, SFX_STEPS, PITCHES } = C;
  const $ = id => document.getElementById(id);

  const STORE = 'dot-cart-v4';                        // v1, v2 は古い言語のカート
  const LINE_H = 18, CODE_PAD = 8;                       // style.css の #code と合わせる
  const SFX = { LBL: 30, CW: 26, RH: 9, VOL_Y: 440, VOL_H: 40 };
  const STATE_TEXT = { idle: '停止中', running: '実行中', paused: '一時停止', crashed: 'エラーで停止' };
  const PALETTE_NAMES = { paper: 'ペーパー', mono: 'モノクロ', leaf: 'リーフ', sea: 'シー', amber: 'アンバー', ice: 'アイス' };
  const MARK = '#ff6b81';

  let rom, player, colors;
  let tab = 'code';
  const sel = { n: 1, size: 1 };                         // 選択中のタイル（スプライトとマップで共通）
  let color = 3, tool = 'pen', mapTool = 'pen', showGrid = true, clip = null;
  let sfxN = 0, playhead = -1, previewTimer = 0, blipTimer = 0;
  let errLine = 0, lineCount = 0, saveTimer = 0, checkTimer = 0, dirty = false, gfxDirty = true;
  const undo = [];

  const sheet = document.createElement('canvas');        // 現在の色で描いたスプライトシート（等倍）
  sheet.width = sheet.height = SHEET_PX;
  const sheetG = sheet.getContext('2d');
  const ctx = id => { const g = $(id).getContext('2d'); g.imageSmoothingEnabled = false; return g; };
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  // ---- 保存 ------------------------------------------------------------
  function save() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORE, JSON.stringify(C.encodeCart(rom)));
      $('saved').textContent = '自動保存済み';
    } catch (e) { $('saved').textContent = '自動保存できません'; }
  }
  function touch() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
    $('saved').textContent = '';
  }
  function pushUndo(kind) {
    undo.push({ kind, data: rom[kind].slice() });
    if (undo.length > 60) undo.shift();
  }
  function popUndo() {
    const u = undo.pop();
    if (!u) return;
    rom[u.kind].set(u.data);
    invalidate(u.kind === 'gfx');
    touch();
  }

  // ---- 再描画 ----------------------------------------------------------
  function invalidate(gfx) {
    if (gfx) gfxDirty = true;
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(redraw);
  }
  function redraw() {
    dirty = false;
    if (gfxDirty) { renderSheet(); gfxDirty = false; }
    if (tab === 'sprite') { drawSheetView(); drawPix(); }
    if (tab === 'map') { drawPicker(); drawMap(); }
    if (tab === 'sound') drawSfx();
  }
  function renderSheet() {
    const img = sheetG.createImageData(SHEET_PX, SHEET_PX), d = img.data;
    const rgb = colors.map(c => { const v = parseInt(c.slice(1), 16); return [v >> 16, v >> 8 & 255, v & 255]; });
    for (let i = 0; i < rom.gfx.length; i++) {
      const c = rgb[rom.gfx[i]];
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    sheetG.putImageData(img, 0, 0);
  }
  function setColors() {
    colors = C.PALETTES[rom.palette];
    document.querySelectorAll('#colors button').forEach((b, i) => { b.style.background = colors[i]; });
    invalidate(true);
  }

  // ポインタのドラッグ。toPos で升目の座標に直し、途中の升も fn に渡す
  function drag(el, toPos, h) {
    let active = false, last = null;
    const pos = e => { const r = el.getBoundingClientRect(); return toPos((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      last = pos(e);
      active = h.down(last, e) !== false;
    });
    el.addEventListener('pointermove', e => {
      const p = pos(e);
      if (h.hover) h.hover(p);
      if (!active) return;
      between(last, p, q => h.move(q, e));
      last = p;
    });
    const end = () => { if (active && h.up) h.up(); active = false; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  function between(a, b, fn) {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (!n) { fn(b); return; }
    for (let i = 1; i <= n; i++) fn(Object.assign({}, b, { x: Math.round(a.x + (b.x - a.x) * i / n), y: Math.round(a.y + (b.y - a.y) * i / n) }));
  }
  function flood(get, set, x, y, w, h, v) {
    const from = get(x, y);
    if (from === v) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || get(cx, cy) !== from) continue;
      set(cx, cy, v);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  function toolbar(id, set) {
    const box = $(id);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      box.querySelectorAll('[data-tool]').forEach(o => o.classList.toggle('on', o === b));
      set(b.dataset.tool);
    });
  }

  // ---- コード ----------------------------------------------------------
  const code = $('code'), gutter = $('gutter');
  function syncGutter() {
    const n = code.value.split('\n').length;
    if (n !== lineCount) {
      lineCount = n;
      let s = '';
      for (let i = 1; i <= n; i++) s += i + '\n';
      gutter.textContent = s;
    }
    gutter.scrollTop = code.scrollTop;
    $('errline').hidden = !errLine;
    if (errLine) $('errline').style.top = (CODE_PAD + (errLine - 1) * LINE_H - code.scrollTop) + 'px';
  }
  function markError(line) { errLine = line; syncGutter(); }
  // 書いているそばから文法を確かめて、エラーをその行に出す
  function check() {
    const box = $('asm-status');
    try {
      const p = C.assemble(rom.code);
      box.textContent = 'OK — ' + p.count + ' 命令、変数 ' + p.words + ' / ' + C.RAM_SIZE + ' 個';
      box.classList.remove('err');
    } catch (e) {
      box.textContent = (e.line ? e.line + ' 行目: ' : '') + e.message;
      box.classList.add('err');
      markError(e.line || 0);
    }
  }
  function codeChanged() {
    rom.code = code.value;
    errLine = 0;
    syncGutter();
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, 250);
    touch();
  }
  function jumpToLine(n) {
    switchTab('code');
    const lines = code.value.split('\n');
    let at = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) at += lines[i].length + 1;
    code.focus();
    code.setSelectionRange(at, at + (lines[n - 1] || '').length);
    code.scrollTop = Math.max(0, (n - 6) * LINE_H);
    syncGutter();
  }
  code.addEventListener('input', codeChanged);
  code.addEventListener('scroll', syncGutter);
  code.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (!document.execCommand('insertText', false, '  ')) {
      code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
      codeChanged();
    }
  });

  // ---- 実行とログ ------------------------------------------------------
  function addLog(text, onClick) {
    const box = $('log'), line = document.createElement('div');
    line.textContent = text;
    if (onClick) { line.className = 'err'; line.addEventListener('click', onClick); }
    box.appendChild(line);
    while (box.childNodes.length > 200) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function run() {
    stopPreview();
    $('log').textContent = '';
    markError(0);
    if (document.activeElement) document.activeElement.blur();  // キー入力を実機に渡す
    player.run();
  }
  function onState(s) {
    $('state').textContent = STATE_TEXT[s];
    $('status').classList.toggle('error', s === 'crashed');
  }
  function onError(err) {
    markError(err.line);
    addLog((err.line ? err.line + ' 行目: ' : '') + err.message, err.line ? () => jumpToLine(err.line) : () => switchTab('code'));
  }

  // ---- スプライト ------------------------------------------------------
  function origin() { // 編集する範囲（シート上のピクセル）
    const s = sel.size;
    return { x: Math.min(sel.n % SHEET, SHEET - s) * TILE, y: Math.min(sel.n >> 4, SHEET - s) * TILE, w: s * TILE };
  }
  const gpx = (o, x, y) => rom.gfx[(o.y + y) * SHEET_PX + o.x + x];
  function spx(o, x, y, c) { rom.gfx[(o.y + y) * SHEET_PX + o.x + x] = c; }
  function select(n) {
    sel.n = clamp(n, 0, C.TILES - 1);
    const f = rom.flags[sel.n];
    document.querySelectorAll('#flags input').forEach((box, i) => { box.checked = !!(f >> i & 1); });
    $('sprite-info').textContent = 'タイル ' + sel.n + '（列 ' + sel.n % SHEET + '、行 ' + (sel.n >> 4) + '）';
    invalidate();
  }
  function drawSheet(g, size, o) {
    const k = size / SHEET_PX;
    g.drawImage(sheet, 0, 0, size, size);
    g.fillStyle = 'rgba(128,128,128,.22)';
    for (let i = 1; i < SHEET; i++) { g.fillRect(i * TILE * k, 0, 1, size); g.fillRect(0, i * TILE * k, size, 1); }
    g.strokeStyle = MARK;
    g.lineWidth = 2;
    g.strokeRect(o.x * k + 1, o.y * k + 1, o.w * k - 2, o.w * k - 2);
  }
  const sheetViewG = ctx('sheet-view'), pixG = ctx('pix');
  function drawSheetView() { drawSheet(sheetViewG, 384, origin()); }
  function drawPix() {
    const o = origin(), k = 256 / o.w;
    pixG.drawImage(sheet, o.x, o.y, o.w, o.w, 0, 0, 256, 256);
    pixG.fillStyle = 'rgba(128,128,128,.25)';
    for (let i = 1; i < o.w; i++) { pixG.fillRect(i * k, 0, 1, 256); pixG.fillRect(0, i * k, 256, 1); }
    if (sel.size > 1) { pixG.fillStyle = MARK; pixG.fillRect(127, 0, 2, 256); pixG.fillRect(0, 127, 256, 2); }
  }
  function gfxChanged() { invalidate(true); touch(); }

  drag($('sheet-view'), (u, v) => ({ x: clamp(Math.floor(u * SHEET), 0, SHEET - 1), y: clamp(Math.floor(v * SHEET), 0, SHEET - 1) }), {
    down(p) { select(p.y * SHEET + p.x); },
    move(p) { select(p.y * SHEET + p.x); },
  });
  drag($('pix'), (u, v) => { const w = origin().w; return { x: clamp(Math.floor(u * w), 0, w - 1), y: clamp(Math.floor(v * w), 0, w - 1) }; }, {
    down(p, e) {
      const o = origin();
      if (e.button === 2) { pickColor(gpx(o, p.x, p.y)); return false; }
      pushUndo('gfx');
      if (tool === 'fill') { flood((x, y) => gpx(o, x, y), (x, y, c) => spx(o, x, y, c), p.x, p.y, o.w, o.w, color); gfxChanged(); return false; }
      spx(o, p.x, p.y, color);
      gfxChanged();
    },
    move(p) { spx(origin(), p.x, p.y, color); gfxChanged(); },
  });
  function pickColor(c) {
    color = c;
    document.querySelectorAll('#colors button').forEach((b, i) => b.classList.toggle('on', i === c));
  }
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.title = '色 ' + i;
    b.setAttribute('aria-label', '色 ' + i);
    b.addEventListener('click', () => pickColor(i));
    $('colors').appendChild(b);
  }
  for (let i = 0; i < 8; i++) {
    const label = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      rom.flags[sel.n] = box.checked ? rom.flags[sel.n] | 1 << i : rom.flags[sel.n] & ~(1 << i);
      touch();
    });
    label.append(box, String(i));
    $('flags').appendChild(label);
  }
  toolbar('tools', t => { tool = t; });
  $('size').addEventListener('change', e => { sel.size = +e.target.value; invalidate(); });
  $('ops').addEventListener('click', e => {
    const op = e.target.dataset.op, o = origin(), w = o.w;
    if (!op) return;
    const src = [];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) src.push(gpx(o, x, y));
    if (op === 'copy') { clip = { w, data: src }; return; }
    if (op === 'paste' && !clip) return;
    pushUndo('gfx');
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        let c = 0;
        if (op === 'fliph') c = src[y * w + (w - 1 - x)];
        else if (op === 'flipv') c = src[(w - 1 - y) * w + x];
        else if (op === 'rot') c = src[(w - 1 - x) * w + y];
        else if (op === 'paste') c = x < clip.w && y < clip.w ? clip.data[y * clip.w + x] : src[y * w + x];
        spx(o, x, y, c);
      }
    }
    gfxChanged();
  });

  // ---- マップ ----------------------------------------------------------
  const pickerG = ctx('map-picker'), mapG = ctx('map-view');
  const MAP_PX = 1024, CELL = MAP_PX / MAP_W;
  const mget = (x, y) => rom.map[y * MAP_W + x];
  function mset(x, y, n) { rom.map[y * MAP_W + x] = n; }
  function drawPicker() {
    drawSheet(pickerG, 256, { x: (sel.n % SHEET) * TILE, y: (sel.n >> 4) * TILE, w: TILE });
  }
  function drawMap() {
    const g = mapG;
    g.fillStyle = colors[0];
    g.fillRect(0, 0, MAP_PX, MAP_PX);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const n = mget(x, y);
        if (n) g.drawImage(sheet, (n % SHEET) * TILE, (n >> 4) * TILE, TILE, TILE, x * CELL, y * CELL, CELL, CELL);
      }
    }
    g.fillStyle = 'rgba(128,128,128,.18)';
    for (let i = 1; i < MAP_W; i++) { g.fillRect(i * CELL, 0, 1, MAP_PX); g.fillRect(0, i * CELL, MAP_PX, 1); }
    if (!showGrid) return;
    g.fillStyle = MARK;
    for (let x = C.W / TILE; x < MAP_W; x += C.W / TILE) g.fillRect(x * CELL - 1, 0, 2, MAP_PX);
    for (let y = C.H / TILE; y < MAP_H; y += C.H / TILE) g.fillRect(0, y * CELL - 1, MAP_PX, 2);
  }
  function mapChanged() { invalidate(); touch(); }
  drag($('map-picker'), (u, v) => ({ x: clamp(Math.floor(u * SHEET), 0, SHEET - 1), y: clamp(Math.floor(v * SHEET), 0, SHEET - 1) }), {
    down(p) { select(p.y * SHEET + p.x); },
    move(p) { select(p.y * SHEET + p.x); },
  });
  drag($('map-view'), (u, v) => ({ x: clamp(Math.floor(u * MAP_W), 0, MAP_W - 1), y: clamp(Math.floor(v * MAP_H), 0, MAP_H - 1) }), {
    down(p, e) {
      if (e.button === 2) { select(mget(p.x, p.y)); return false; }
      pushUndo('map');
      if (mapTool === 'fill') { flood(mget, mset, p.x, p.y, MAP_W, MAP_H, sel.n); mapChanged(); return false; }
      mset(p.x, p.y, sel.n);
      mapChanged();
    },
    move(p) { mset(p.x, p.y, sel.n); mapChanged(); },
    hover(p) { $('map-info').textContent = 'x ' + p.x + '  y ' + p.y + '  タイル ' + mget(p.x, p.y) + '　／　選択中 ' + sel.n; },
  });
  toolbar('map-tools', t => { mapTool = t; });
  $('map-grid').addEventListener('change', e => { showGrid = e.target.checked; invalidate(); });

  // ---- サウンド --------------------------------------------------------
  const sfxG = ctx('sfx-grid');
  const NOTE_COLOR = ['', '#8a4a44', '#c05f54', '#f2796a'];
  function drawSfx() {
    const g = sfxG, s = rom.sfx[sfxN], { LBL, CW, RH, VOL_Y, VOL_H } = SFX, gridW = SFX_STEPS * CW, gridH = PITCHES * RH;
    g.fillStyle = '#1e2038';
    g.fillRect(0, 0, 446, 480);
    g.font = '8px ui-monospace, Menlo, monospace';
    for (let r = 0; r < PITCHES; r++) {
      const p = PITCHES - 1 - r, name = C.pitchName(p), black = name.includes('#');
      g.fillStyle = black ? '#181a30' : '#272a48';
      g.fillRect(LBL, r * RH, gridW, RH - 1);
      if (black) continue;
      g.fillStyle = p % 12 ? '#8d91b3' : '#dcdef0';
      g.fillText(name, 4, r * RH + RH - 2);
    }
    g.fillStyle = '#272a48';
    g.fillRect(LBL, VOL_Y, gridW, VOL_H);
    g.fillStyle = '#8d91b3';
    g.fillText('VOL', 4, VOL_Y + 12);
    g.fillStyle = '#1e2038';
    for (let i = 1; i < SFX_STEPS; i++) g.fillRect(LBL + i * CW - 1, 0, i % 4 ? 1 : 2, 480);
    if (playhead >= 0) {
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(LBL + playhead * CW, 0, CW, 480);
    }
    for (let i = 0; i < SFX_STEPS; i++) {
      const v = s.vol[i];
      if (!v) continue;
      g.fillStyle = NOTE_COLOR[v];
      g.fillRect(LBL + i * CW + 1, (PITCHES - 1 - s.pitch[i]) * RH, CW - 3, RH - 1);
      g.fillRect(LBL + i * CW + 1, VOL_Y + VOL_H - v * 12, CW - 3, v * 12);
    }
    g.fillStyle = '#343861';
    g.fillRect(LBL, gridH, gridW, 1);
  }
  function refreshSfx() {
    const s = rom.sfx[sfxN];
    $('sfx-wave').value = s.wave;
    $('sfx-speed').value = s.speed;
    document.querySelectorAll('#sfx-slots button').forEach((b, i) => {
      b.classList.toggle('on', i === sfxN);
      b.classList.toggle('used', !C.sfxEmpty(rom.sfx[i]));
    });
    invalidate();
  }
  function sfxChanged() { refreshSfx(); touch(); }
  function stopPreview() {
    if (!previewTimer) return;
    clearInterval(previewTimer);
    previewTimer = 0;
    playhead = -1;
    $('sfx-play').textContent = '▶ 試聴';
    player.audio.silence();
    invalidate();
  }
  function preview() {
    stopPreview();
    const s = rom.sfx[sfxN];
    let len = SFX_STEPS;
    while (len > 0 && !s.vol[len - 1]) len--;
    if (!len) return;
    player.audio.resume();
    $('sfx-play').textContent = '■ 止める';
    let step = 0;
    const next = () => {
      if (step >= len) { stopPreview(); return; }
      const v = s.vol[step];
      player.audio.voice(0, s.wave, v ? C.pitchFreq(s.pitch[step]) : 0, v / 3);
      playhead = step++;
      invalidate();
    };
    next();
    previewTimer = setInterval(next, 1000 / C.FPS * s.speed);
  }
  function blip(s, i) { // 置いた音を短く鳴らす
    if (previewTimer) return;
    player.audio.resume();
    player.audio.voice(0, s.wave, C.pitchFreq(s.pitch[i]), s.vol[i] / 3);
    clearTimeout(blipTimer);
    blipTimer = setTimeout(() => { if (!previewTimer) player.audio.silence(); }, 140);
  }
  let sfxMode = '';
  function sfxPos(u, v) {
    const px = u * 446, py = v * 480;
    return {
      x: clamp(Math.floor((px - SFX.LBL) / SFX.CW), 0, SFX_STEPS - 1),
      y: clamp(Math.floor(py / SFX.RH), 0, PITCHES - 1),
      level: py >= SFX.VOL_Y ? clamp(3 - Math.floor((py - SFX.VOL_Y) / (SFX.VOL_H / 4)), 0, 3) : -1,
    };
  }
  function sfxApply(q) {
    const s = rom.sfx[sfxN], i = q.x, p = PITCHES - 1 - q.y;
    if (sfxMode === 'vol') { if (q.level < 0 || s.vol[i] === q.level) return; s.vol[i] = q.level; }
    else if (sfxMode === 'erase') { if (!s.vol[i] || s.pitch[i] !== p) return; s.vol[i] = 0; }
    else { if (q.level >= 0 || (s.vol[i] && s.pitch[i] === p)) return; s.pitch[i] = p; s.vol[i] = s.vol[i] || 3; }
    if (s.vol[i]) blip(s, i);
    sfxChanged();
  }
  drag($('sfx-grid'), sfxPos, {
    down(q) {
      const s = rom.sfx[sfxN];
      sfxMode = q.level >= 0 ? 'vol' : (s.vol[q.x] && s.pitch[q.x] === PITCHES - 1 - q.y ? 'erase' : 'paint');
      sfxApply(q);
    },
    move: sfxApply,
  });
  for (let i = 0; i < C.SFX_COUNT; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    b.addEventListener('click', () => { stopPreview(); sfxN = i; refreshSfx(); });
    $('sfx-slots').appendChild(b);
  }
  C.WAVES.forEach((name, i) => $('sfx-wave').add(new Option(name, i)));
  $('sfx-wave').addEventListener('change', e => { rom.sfx[sfxN].wave = +e.target.value; sfxChanged(); });
  $('sfx-speed').addEventListener('change', e => {
    rom.sfx[sfxN].speed = clamp(Math.round(+e.target.value) || 1, 1, 32);
    sfxChanged();
  });
  $('sfx-play').addEventListener('click', () => { if (previewTimer) stopPreview(); else preview(); });
  $('sfx-clear').addEventListener('click', () => { stopPreview(); rom.sfx[sfxN].vol.fill(0); sfxChanged(); });

  // ---- タブ ------------------------------------------------------------
  function switchTab(name) {
    tab = name;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== 'panel-' + name; });
    if (name !== 'sound') stopPreview();
    if (name === 'code') syncGutter();
    invalidate();
  }
  $('tabs').addEventListener('click', e => { if (e.target.dataset.tab) switchTab(e.target.dataset.tab); });

  // ---- カートの出し入れ ------------------------------------------------
  function setRom(r) {
    stopPreview();
    rom = r;
    rom.code = C.lowerCommands(rom.code);
    undo.length = 0;
    player.load(rom);
    $('title').value = rom.title;
    $('palette').value = rom.palette;
    $('log').textContent = '';
    code.value = rom.code;
    code.scrollTop = 0;
    lineCount = 0;
    markError(0);
    check();
    sfxN = 0;
    setColors();
    select(1);
    refreshSfx();
    save();
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileName = () => rom.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cart';

  // ページ内のダイアログ。ボタンの fn が false を返すと開いたままにする
  // opts.area を渡すと文字の欄を出す（readonly なら書き出し用、そうでなければ貼りつけ用）
  function ask(text, buttons, opts) {
    opts = opts || {};
    const area = $('modal-area'), box = $('modal-buttons');
    $('modal-text').textContent = text;
    $('modal-text').classList.remove('err');
    area.hidden = opts.area == null;
    area.value = opts.area || '';
    area.readOnly = !!opts.readonly;
    box.textContent = '';
    buttons.forEach((def, i) => {
      const b = document.createElement('button');
      b.textContent = def.label;
      if (i === 0) b.className = 'primary';
      b.addEventListener('click', () => { if (!def.fn || def.fn() !== false) $('modal').hidden = true; });
      box.appendChild(b);
    });
    $('modal').hidden = false;
    (area.hidden ? box.firstChild : area).focus();
    if (opts.readonly) area.select();
  }
  function modalError(text) {
    $('modal-text').textContent = text;
    $('modal-text').classList.add('err');
    return false;
  }
  const CANCEL = { label: 'やめる' };
  function replaceCart(make) {
    ask('いま編集中のカートリッジは置き換えられます。', [{ label: '置き換える', fn: () => setRom(make()) }, CANCEL]);
  }
  function load(text) {
    try { setRom(C.decodeCart(text)); } catch (e) { return modalError('読み込めませんでした: ' + e.message); }
  }
  // 書き出し。ファイル保存が効かない場所でも、コピーして持ち出せるようにする
  function exportText(what, name, text, type) {
    const buttons = [{
      label: 'コピー',
      fn() {
        const done = () => { $('modal-text').textContent = 'コピーしました。'; };
        const area = $('modal-area');
        area.focus();
        area.select();
        try { navigator.clipboard.writeText(text).then(done, () => modalError('コピーできませんでした。欄の文字を選んでコピーしてください。')); }
        catch (e) { modalError('コピーできませんでした。欄の文字を選んでコピーしてください。'); }
        return false;
      },
    }];
    if (!root.DOT_HOSTED) buttons.push({ label: 'ファイルに保存', fn: () => download(name, text, type) });
    buttons.push({ label: '閉じる' });
    ask(what + '（' + name + '）', buttons, { area: text, readonly: true });
  }

  $('title').addEventListener('input', e => { rom.title = e.target.value.trim() || 'UNTITLED'; touch(); });
  $('run').addEventListener('click', run);
  $('stop').addEventListener('click', () => player.stop());
  $('new').addEventListener('click', () => replaceCart(Carts.blank));
  Carts.samples.forEach((s, i) => $('samples').add(new Option(s.name, i)));
  $('samples').addEventListener('change', e => {
    const s = Carts.samples[e.target.value];
    e.target.value = '';
    if (s) replaceCart(s.make);
  });
  $('export').addEventListener('click', () => {
    exportText('カートリッジ。「読み込み」で開けます', fileName() + '.dot.json', JSON.stringify(C.encodeCart(rom)), 'application/json');
  });
  $('export-html').addEventListener('click', () => {
    exportText('これ 1 枚で遊べる HTML', fileName() + '.html', Player.exportHTML(rom), 'text/html');
  });
  $('import').addEventListener('click', () => {
    ask('カートリッジ（.dot.json）の中身を貼りつけるか、ファイルを選んでください。いま編集中のものは置き換えられます。', [
      { label: '読み込む', fn: () => load($('modal-area').value) },
      { label: 'ファイルを選ぶ', fn: () => { $('file').click(); return false; } },
      CANCEL,
    ], { area: '' });
  });
  $('file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && load(await f.text()) !== false) $('modal').hidden = true;
  });
  $('modal').addEventListener('keydown', e => { if (e.key === 'Escape') $('modal').hidden = true; });
  Object.keys(C.PALETTES).forEach(k => $('palette').add(new Option('画面: ' + (PALETTE_NAMES[k] || k), k)));
  $('palette').addEventListener('change', e => {
    rom.palette = e.target.value;
    player.setPalette(rom.palette);
    setColors();
    touch();
  });

  root.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 's') { e.preventDefault(); save(); }
    else if (e.key === 'z' && !e.shiftKey && (tab === 'sprite' || tab === 'map') && e.target.tagName !== 'INPUT') { e.preventDefault(); popUndo(); }
  });
  root.addEventListener('beforeunload', save);

  // ---- 起動 ------------------------------------------------------------
  player = Player.mount($('console'), { onState, onError, onLog: text => addLog(text) });
  pickColor(3);
  let saved = null;
  try { const text = localStorage.getItem(STORE); if (text) saved = C.decodeCart(text); } catch (e) { /* 壊れていたらサンプルから */ }
  setRom(saved || Carts.samples[0].make());
})(typeof globalThis !== 'undefined' ? globalThis : this);
