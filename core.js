/* core.js — DOT 本体（仮想ゲーム機）。画面や音の出力先には一切依存しない。
   ブラウザでは window.DotCore、Node では require('./core.js') で読める。 */
(function (root, factory) {
  const api = factory();
  api.SOURCE = '(' + factory.toString() + ')()';
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DotCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- 仕様 ------------------------------------------------------------
  const W = 160, H = 144, FPS = 60;
  const TILE = 8, SHEET = 16, SHEET_PX = SHEET * TILE, TILES = SHEET * SHEET;
  const MAP_W = 64, MAP_H = 64;
  const SFX_COUNT = 32, SFX_STEPS = 16, PITCHES = 48, CHANNELS = 4;
  const DATA_SLOTS = 16;
  const BTN = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, A: 4, B: 5, START: 6, SELECT: 7 };
  const WAVES = ['矩形波 50%', '矩形波 25%', '三角波', 'ノイズ'];
  // 色 0 がいちばん明るく、3 がいちばん暗い
  const PALETTES = {
    paper: ['#f4f0e4', '#b9bbcc', '#5d6189', '#1b1d3a'],
    mono: ['#e8e8e8', '#a0a0a0', '#585858', '#101010'],
    leaf: ['#eef5c8', '#a9c85a', '#4c7a3a', '#16301f'],
    sea: ['#c5f0e0', '#62c0a8', '#1f7f76', '#06333a'],
    amber: ['#fff2c8', '#f0a848', '#a04820', '#2a1010'],
    ice: ['#f0f6ff', '#9db8e8', '#4a5fa8', '#161a3c'],
  };
  const DEFAULT_PALETTE = 'paper';

  // ---- フォント（3x5、1 文字 = 上から 5 行ぶんの 8 進数）----------------
  const FONT = (
    '00000 22202 55000 57575 36736 51245 25253 22000 12221 42224 05250 02720 00024 00700 00002 11244 ' + // SP ! " # $ % & ' ( ) * + , - . /
    '75557 26227 71747 71717 55711 74717 74757 71111 75757 75717 ' +                                     // 0-9
    '02020 02024 12421 07070 42124 71202 25543 ' +                                                       // : ; < = > ? @
    '25755 65656 34443 65556 74647 74644 34553 55755 72227 11152 55655 44447 57555 ' +                   // A-M
    '65555 25552 65644 25563 65655 34216 72222 55557 55552 55575 55255 55222 71247 ' +                   // N-Z
    '64446 44211 31113 25000 00007 42000 ' +                                                             // [ \ ] ^ _ `
    '32623 22222 62326 03600'                                                                            // { | } ~
  ).split(' ');
  function glyph(code) {
    if (code >= 32 && code <= 96) return FONT[code - 32];
    if (code >= 123 && code <= 126) return FONT[65 + code - 123];
    return FONT[31]; // ?
  }

  // ---- 音程 ------------------------------------------------------------
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitchFreq = p => 130.8128 * Math.pow(2, p / 12); // 0 = C3
  const pitchName = p => NOTE_NAMES[p % 12] + (3 + Math.floor(p / 12));
  /* "C4 E4:2 - G4" のような文字列を効果音に書き込む（- は休符、:n は音量 1〜3） */
  function parseNotes(sfx, text) {
    text.trim().split(/\s+/).slice(0, SFX_STEPS).forEach((tok, i) => {
      const m = /^([A-G]#?)(\d)(?::([0-3]))?$/i.exec(tok);
      if (!m) { sfx.vol[i] = 0; return; }
      const p = (+m[2] - 3) * 12 + NOTE_NAMES.indexOf(m[1].toUpperCase());
      sfx.pitch[i] = Math.max(0, Math.min(PITCHES - 1, p));
      sfx.vol[i] = m[3] == null ? 3 : +m[3];
    });
    return sfx;
  }

  // ---- カートリッジ ----------------------------------------------------
  function newSfx() {
    return { wave: 0, speed: 4, pitch: new Uint8Array(SFX_STEPS), vol: new Uint8Array(SFX_STEPS) };
  }
  function newRom() {
    return {
      title: 'UNTITLED', palette: DEFAULT_PALETTE, code: '',
      gfx: new Uint8Array(SHEET_PX * SHEET_PX),  // 1 要素 = 1 ピクセル（0〜3）
      map: new Uint8Array(MAP_W * MAP_H),        // 1 要素 = タイル番号
      flags: new Uint8Array(TILES),              // タイルごとに 8 ビット
      sfx: Array.from({ length: SFX_COUNT }, newSfx),
    };
  }
  const sfxEmpty = s => s.vol.every(v => !v);

  const HEX = '0123456789abcdef';
  const hexVal = ch => { const v = parseInt(ch, 16); return v >= 0 ? v : 0; };
  // 末尾のゼロは落として保存し、読むときに補う
  function encPixels(px) {
    let s = '';
    for (let i = 0; i < px.length; i += 2) s += HEX[(px[i] & 3) << 2 | (px[i + 1] & 3)];
    return s.replace(/0+$/, '');
  }
  function decPixels(s, px) {
    px.fill(0);
    const n = Math.min(s.length, px.length >> 1);
    for (let i = 0; i < n; i++) { const v = hexVal(s[i]); px[i * 2] = v >> 2; px[i * 2 + 1] = v & 3; }
  }
  function encBytes(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
    return s.replace(/(00)+$/, '');
  }
  function decBytes(s, b) {
    b.fill(0);
    const n = Math.min(s.length >> 1, b.length);
    for (let i = 0; i < n; i++) b[i] = hexVal(s[i * 2]) << 4 | hexVal(s[i * 2 + 1]);
  }

  function encodeCart(rom) {
    const sfx = [];
    rom.sfx.forEach((s, i) => {
      if (sfxEmpty(s)) return;
      let n = '';
      for (let k = 0; k < SFX_STEPS; k++) n += HEX[s.pitch[k] >> 4] + HEX[s.pitch[k] & 15] + HEX[s.vol[k] & 3];
      sfx.push({ i, w: s.wave, s: s.speed, n });
    });
    return {
      dot: 1, title: rom.title, palette: rom.palette, code: rom.code,
      gfx: encPixels(rom.gfx), map: encBytes(rom.map), flags: encBytes(rom.flags), sfx,
    };
  }
  function decodeCart(cart) {
    if (typeof cart === 'string') cart = JSON.parse(cart);
    if (!cart || cart.dot !== 1) throw new Error('DOT のカートリッジではありません');
    const rom = newRom();
    rom.title = String(cart.title || 'UNTITLED');
    rom.palette = PALETTES[cart.palette] ? cart.palette : DEFAULT_PALETTE;
    rom.code = String(cart.code || '');
    decPixels(String(cart.gfx || ''), rom.gfx);
    decBytes(String(cart.map || ''), rom.map);
    decBytes(String(cart.flags || ''), rom.flags);
    for (const e of Array.isArray(cart.sfx) ? cart.sfx : []) {
      const s = rom.sfx[e.i];
      if (!s) continue;
      s.wave = e.w & 3;
      s.speed = Math.max(1, Math.min(32, e.s | 0));
      const n = String(e.n || '');
      for (let k = 0; k < SFX_STEPS; k++) {
        s.pitch[k] = Math.min(PITCHES - 1, hexVal(n[k * 3]) << 4 | hexVal(n[k * 3 + 1]));
        s.vol[k] = hexVal(n[k * 3 + 2]) & 3;
      }
    }
    return rom;
  }

  /* 文字で描いた絵をタイル n の位置から書き込む（'.' = 0、'1'〜'3' = 色） */
  function drawArt(rom, n, rows) {
    const ox = (n % SHEET) * TILE, oy = (n >> 4) * TILE;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (ox + x < SHEET_PX && oy + y < SHEET_PX) rom.gfx[(oy + y) * SHEET_PX + ox + x] = hexVal(row[x]) & 3;
      }
    });
  }

  // ---- 言語 --------------------------------------------------------------
  // カートのコードは DOT 言語: consts { } / variables { } / 名前 { } のブロックに、1 行 1 命令で書く。
  const RAM_SIZE = 4096, STACK_SIZE = 256;
  const INIT_BUDGET = 2000000, FRAME_BUDGET = 200000; // 1 回の呼び出しで実行できる命令数
  const CONSTS = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, A: 4, B: 5, START: 6, SELECT: 7, SCREEN_W: W, SCREEN_H: H };
  // 引数の種類: d = 書き込み先の変数  s = 値  t = 値か "文字列"。大文字は省略できる
  const OPS = {
    ADD: 'ds', SUB: 'ds', MUL: 'ds', DIV: 'ds', MOD: 'ds', INC: 'd', DEC: 'd', NEG: 'd',
    CLS: 'S', PSET: 'ssS', PGET: 'dss', LINE: 'ssssS', RECT: 'ssssS', RECTF: 'ssssS', CIRC: 'sssS', CIRCF: 'sssS',
    SPR: 'sssSSS', MAP: 'SSSSSS', MGET: 'dss', MSET: 'sss', FGET: 'dsS', RELOAD: '',
    PRINT: 'tSSS', CAMERA: 'SS', PAL: 'SS', SFX: 'sSS', SRAND: 's', DGET: 'ds', DSET: 'ss', LOG: 'tTTTTTTT', RESET: '',
  };
  const WORDS = ['CONSTS', 'VARIABLES', 'IF', 'ELSE', 'WHILE', 'FOR', 'AND', 'OR', 'NOT', 'BTN', 'BTNP',
    'CALL', 'RET', 'TIME', 'INT', 'ABS', 'MIN', 'MAX', 'RND'];

  class AsmError extends Error {
    constructor(message, line) { super(message); this.line = line; }
  }

  // コメントを落とす
  function clean(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '#') break;
      if (ch === '"') {
        const end = text.indexOf('"', i + 1);
        if (end < 0) { out += text.slice(i); break; }
        out += text.slice(i, end + 1);
        i = end;
      } else if (ch === "'" && text[i + 2] === "'") { out += text.substr(i, 3); i += 2; }
      else out += ch;
    }
    return out;
  }
  const TOKEN = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|\$([0-9A-Fa-f]+)|([A-Za-z_]\w*)|"([^"]*)"|'(.)'|(==|!=|<>|<=|>=|&&|\|\||\.\.|[-+*\/%()\[\]{},<>=:!]))/y;
  function tokenize(text, line) {
    const out = [];
    TOKEN.lastIndex = 0;
    for (let at = 0; text.slice(at).trim();) {
      const m = TOKEN.exec(text);
      if (!m) throw new AsmError('読めません: ' + text.slice(at).trim(), line);
      at = TOKEN.lastIndex;
      if (m[1] != null) out.push({ t: 'num', v: +m[1] });
      else if (m[2] != null) out.push({ t: 'num', v: parseInt(m[2], 16) });
      else if (m[3] != null) out.push({ t: 'name', v: m[3].toUpperCase(), raw: m[3] }); // 大文字と小文字は区別しない
      else if (m[4] != null) out.push({ t: 'str', v: m[4] });
      else if (m[5] != null) out.push({ t: 'num', v: m[5].charCodeAt(0) });
      else out.push({ t: 'op', v: m[6] });
    }
    return out;
  }
  const OPS_HINT = { SET: ' はありません。「変数 = 値」と書きます', VAR: ' はありません。変数は variables { } に書きます', CONST: ' はありません。定数は consts { } に書きます' };
  const show = t => t.t === 'str' ? '"' + t.v + '"' : String(t.raw || t.v);

  /* 命令とキーワードを小文字にそろえる（文字列・コメント・変数名・定数名はそのまま）。
     大文字で書かれた以前のカートを読みこんだときに使う */
  function lowerCommands(source) {
    return source.split('\n').map(text => {
      const code = clean(text);
      const out = code.replace(/"[^"]*"?|'.'|[A-Za-z_]\w*/g, w => {
        const up = w.toUpperCase();
        return w[0] !== '"' && w[0] !== "'" && up !== 'TIME' && (WORDS.includes(up) || up in OPS) ? w.toLowerCase() : w;
      });
      return out + text.slice(code.length);
    }).join('\n');
  }

  /* カートのコードの文法だけ確かめる。失敗すると AsmError（message, line）を投げる */
  function assemble(source) {
    return createMachine(newRom()).compile(source);
  }

  // ---- 本体 ------------------------------------------------------------
  /* host: { voice(ch, wave, freq, vol), log(...), loadData(), saveData(arr), seed } すべて省略可 */
  function createMachine(rom, host) {
    host = host || {};
    const screen = new Uint8Array(W * H);
    const map = new Uint8Array(MAP_W * MAP_H);
    const pal = [0, 1, 2, 3];
    const channels = [];
    for (let i = 0; i < CHANNELS; i++) channels.push({ sfx: -1, step: 0, tick: 0, loop: false, len: 0 });
    let camX = 0, camY = 0, buttons = 0, prev = 0, frameNo = 0, seed = 1;
    let error = null, data = [], dataDirty = false;
    const flr = Math.floor;

    // -- 描画 --
    function px(x, y, k) { if (x >= 0 && x < W && y >= 0 && y < H) screen[y * W + x] = k; }
    function hline(x0, x1, y, k) {
      if (y < 0 || y >= H) return;
      if (x0 < 0) x0 = 0;
      if (x1 >= W) x1 = W - 1;
      for (let x = x0; x <= x1; x++) screen[y * W + x] = k;
    }
    function cls(c = 0) { screen.fill(c & 3); }
    function camera(x = 0, y = 0) { camX = flr(x) || 0; camY = flr(y) || 0; }
    function palette(from, to) {
      if (from == null) { pal[0] = 0; pal[1] = 1; pal[2] = 2; pal[3] = 3; } else pal[from & 3] = to & 3;
    }
    function pset(x, y, c = 3) { px(flr(x) - camX, flr(y) - camY, pal[c & 3]); }
    function pget(x, y) {
      x = flr(x) - camX; y = flr(y) - camY;
      return x >= 0 && x < W && y >= 0 && y < H ? screen[y * W + x] : 0;
    }
    function line(x0, y0, x1, y1, c = 3) {
      x0 = flr(x0) - camX; y0 = flr(y0) - camY; x1 = flr(x1) - camX; y1 = flr(y1) - camY;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, k = pal[c & 3];
      if (!(dx + dy < 4096)) return;
      let err = dx - dy;
      for (;;) {
        px(x0, y0, k);
        if (x0 === x1 && y0 === y1) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }
    function rectfill(x, y, w, h, c = 3) {
      x = flr(x) - camX; y = flr(y) - camY;
      const k = pal[c & 3], x1 = x + flr(w) - 1, y1 = Math.min(y + flr(h), H);
      for (let j = Math.max(y, 0); j < y1; j++) hline(x, x1, j, k);
    }
    function rect(x, y, w, h, c = 3) {
      x = flr(x) - camX; y = flr(y) - camY; w = flr(w); h = flr(h);
      if (!(w > 0 && h > 0)) return;
      const k = pal[c & 3], y1 = Math.min(y + h - 1, H);
      hline(x, x + w - 1, y, k);
      hline(x, x + w - 1, y + h - 1, k);
      for (let j = Math.max(y + 1, 0); j < y1; j++) { px(x, j, k); px(x + w - 1, j, k); }
    }
    function circle(x, y, r, c, fill) {
      x = flr(x) - camX; y = flr(y) - camY; r = Math.min(flr(r), 1024);
      if (!(r >= 0)) return;
      const k = pal[c & 3];
      let dx = r, dy = 0, err = 1 - r;
      while (dx >= dy) {
        if (fill) {
          hline(x - dx, x + dx, y + dy, k); hline(x - dx, x + dx, y - dy, k);
          hline(x - dy, x + dy, y + dx, k); hline(x - dy, x + dy, y - dx, k);
        } else {
          px(x + dx, y + dy, k); px(x - dx, y + dy, k); px(x + dx, y - dy, k); px(x - dx, y - dy, k);
          px(x + dy, y + dx, k); px(x - dy, y + dx, k); px(x + dy, y - dx, k); px(x - dy, y - dx, k);
        }
        dy++;
        if (err < 0) err += 2 * dy + 1; else { dx--; err += 2 * (dy - dx) + 1; }
      }
    }
    const circ = (x, y, r, c = 3) => circle(x, y, r, c, false);
    const circfill = (x, y, r, c = 3) => circle(x, y, r, c, true);

    // スプライトシートの矩形を画面へ。opaque でなければ色 0 は透明
    function blit(sx, sy, w, h, dx, dy, fx, fy, opaque) {
      const gfx = rom.gfx;
      for (let j = 0; j < h; j++) {
        const y = dy + j;
        if (y < 0 || y >= H) continue;
        const row = (sy + (fy ? h - 1 - j : j)) * SHEET_PX + sx;
        for (let i = 0; i < w; i++) {
          const x = dx + i;
          if (x < 0 || x >= W) continue;
          const c = gfx[row + (fx ? w - 1 - i : i)];
          if (c || opaque) screen[y * W + x] = pal[c];
        }
      }
    }
    function spr(n, x, y, w = 1, h = 1, flipX = false, flipY = false) {
      n &= 255;
      const sx = (n % SHEET) * TILE, sy = (n >> 4) * TILE;
      const pw = Math.max(0, Math.min(flr(w * TILE), SHEET_PX - sx)), ph = Math.max(0, Math.min(flr(h * TILE), SHEET_PX - sy));
      blit(sx, sy, pw, ph, flr(x) - camX, flr(y) - camY, flipX, flipY, false);
    }
    // マップを描く。タイル 0 は「なにもない」として飛ばす
    function drawMap(mx = 0, my = 0, x = 0, y = 0, w = MAP_W, h = MAP_H) {
      mx = flr(mx); my = flr(my); x = flr(x) - camX; y = flr(y) - camY;
      for (let j = 0; j < h; j++) {
        const ty = my + j, dy = y + j * TILE;
        if (ty < 0 || ty >= MAP_H || dy <= -TILE || dy >= H) continue;
        for (let i = 0; i < w; i++) {
          const tx = mx + i, dx = x + i * TILE;
          if (tx < 0 || tx >= MAP_W || dx <= -TILE || dx >= W) continue;
          const n = map[ty * MAP_W + tx];
          if (n) blit((n % SHEET) * TILE, (n >> 4) * TILE, TILE, TILE, dx, dy, false, false, true);
        }
      }
    }
    function mget(x, y) {
      x = flr(x); y = flr(y);
      return x >= 0 && x < MAP_W && y >= 0 && y < MAP_H ? map[y * MAP_W + x] : 0;
    }
    function mset(x, y, n) {
      x = flr(x); y = flr(y);
      if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H) map[y * MAP_W + x] = n;
    }
    function fget(n, bit) {
      const f = rom.flags[n & 255];
      return bit == null ? f : (f >> (bit & 7) & 1) === 1;
    }
    function reload() { map.set(rom.map); }
    function print(str, x = 0, y = 0, c = 3) {
      str = String(str).toUpperCase();
      x = flr(x) - camX; y = flr(y) - camY;
      const x0 = x, k = pal[c & 3];
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '\n') { x = x0; y += 6; continue; }
        const g = glyph(str.charCodeAt(i));
        for (let r = 0; r < 5; r++) {
          const bits = g.charCodeAt(r) - 48;
          if (bits & 4) px(x, y + r, k);
          if (bits & 2) px(x + 1, y + r, k);
          if (bits & 1) px(x + 2, y + r, k);
        }
        x += 4;
      }
      return x + camX;
    }

    // -- 入力 --
    const btn = i => (buttons >> (i & 7) & 1) === 1;
    const btnp = i => (buttons >> (i & 7) & 1) === 1 && (prev >> (i & 7) & 1) === 0;

    // -- 音（1 フレームごとにステップを進め、変化だけを host.voice に伝える）--
    function voice(ch, wave, freq, vol) { if (host.voice) host.voice(ch, wave, freq, vol); }
    function stopChannel(i) { channels[i].sfx = -1; voice(i, 0, 0, 0); }
    function silence() { for (let i = 0; i < CHANNELS; i++) stopChannel(i); }
    function sfx(n, ch, loop) {
      if (n == null || n < 0) {
        for (let i = 0; i < CHANNELS; i++) if (ch == null || ch < 0 || ch === i) stopChannel(i);
        return;
      }
      const s = rom.sfx[n | 0];
      if (!s) return;
      if (ch == null || ch < 0 || ch >= CHANNELS) {
        ch = channels.findIndex(c => c.sfx < 0);
        if (ch < 0) ch = channels.findIndex(c => !c.loop);
        if (ch < 0) ch = CHANNELS - 1;
      }
      ch |= 0;
      let len = SFX_STEPS;
      if (!loop) while (len > 0 && !s.vol[len - 1]) len--;
      if (!len) { stopChannel(ch); return; }
      const c = channels[ch];
      c.sfx = n | 0; c.step = 0; c.tick = 0; c.loop = !!loop; c.len = len;
    }
    function tickSound() {
      for (let i = 0; i < CHANNELS; i++) {
        const c = channels[i];
        if (c.sfx < 0) continue;
        const s = rom.sfx[c.sfx];
        if (c.tick === 0) {
          const v = s.vol[c.step];
          voice(i, s.wave, v ? pitchFreq(s.pitch[c.step]) : 0, v / 3);
        }
        if (++c.tick >= Math.max(1, s.speed)) {
          c.tick = 0;
          if (++c.step >= c.len) { if (c.loop) c.step = 0; else stopChannel(i); }
        }
      }
    }

    // -- そのほか --
    function rnd(n = 1) {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Array.isArray(n) ? n[flr(r * n.length)] : r * n;
    }
    function srand(s) { seed = s >>> 0; }
    const dget = i => +data[i & (DATA_SLOTS - 1)] || 0;
    function dset(i, v) { data[i & (DATA_SLOTS - 1)] = +v || 0; dataDirty = true; }
    function log(...args) { if (host.log) host.log(...args); }

    // -- プログラム --
    const ram = new Float64Array(RAM_SIZE), stack = [];
    let prog = null, pc = -1, cur = 0, curX = 0, curY = 0, curC = 3;
    const FUNCS = { // [引数の数, 関数, 毎回結果が変わるか]
      INT: [1, Math.floor], ABS: [1, Math.abs], MIN: [2, Math.min], MAX: [2, Math.max],
      RND: [1, n => n > 0 ? flr(rnd(n)) : 0, true],
    };
    const DIVIDE = (x, y) => { if (!y) throw new Error('0 で割りました'); return x / y; };
    const REMAIN = (x, y) => { if (!y) throw new Error('0 で割りました'); return x % y; };
    const MATH = { ADD: (x, y) => x + y, SUB: (x, y) => x - y, MUL: (x, y) => x * y, DIV: DIVIDE, MOD: REMAIN };
    const CMP = {
      '==': (x, y) => x === y, '=': (x, y) => x === y, '!=': (x, y) => x !== y, '<>': (x, y) => x !== y,
      '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y,
    };

    /* ソースを、実行する関数の列（code）に直す。失敗すると AsmError を投げる */
    function compile(source) {
      const syms = new Map(), funcs = new Map(), spell = new Map(), vars = {}, blocks = [], image = [], code = [], lines = [];
      let lineNo = 0, tk = [], ti = 0;
      const err = m => { throw new AsmError(m, lineNo); };
      const sp = name => spell.get(name) || name.toLowerCase(); // エラーには書かれたとおりの綴りで出す
      for (const k in CONSTS) syms.set(k, { kind: 'const', v: CONSTS[k] });

      const isOp = v => ti < tk.length && tk[ti].t === 'op' && tk[ti].v === v;
      const eat = v => isOp(v) ? (ti++, true) : false;
      const eatWord = v => ti < tk.length && tk[ti].t === 'name' && tk[ti].v === v ? (ti++, true) : false;
      const need = v => { if (!eat(v)) err('"' + v + '" が必要です'); };
      const emit = f => { code.push(f); lines.push(lineNo); };
      const konst = v => ({ k: true, v, f: () => v });
      function claim(name) {
        if (name in CONSTS || name === 'TIME') err(sp(name) + ' はシステム定数なので、名前に使えません');
        if (WORDS.includes(name) || name in OPS) err(sp(name) + ' は名前に使えません');
        if (syms.has(name) || funcs.has(name)) err('同じ名前が 2 回定義されています: ' + sp(name));
      }
      function word() {
        const t = tk[ti++];
        if (!t || t.t !== 'name') err('名前が必要です');
        return t.v;
      }

      // 式 → { f: 値を返す関数, k: 定数か, v: 定数の値 }
      function calc(a, b, fn) {
        if (a.k && b.k) return konst(fn(a.v, b.v));
        const x = a.f, y = b.f;
        return { f: () => fn(x(), y()) };
      }
      function cell(name, s) { // 変数（配列なら添字つき）の読み書き
        const addr = s.addr, size = s.size;
        if (!eat('[')) return { get: () => ram[addr], set: v => { ram[addr] = v; } };
        const ix = expr().f;
        need(']');
        const at = () => {
          const i = Math.floor(ix());
          if (!(i >= 0 && i < size)) throw new Error(sp(name) + '[' + i + '] は範囲外です（大きさ ' + size + '）');
          return addr + i;
        };
        return { get: () => ram[at()], set: v => { ram[at()] = v; } };
      }
      function atom() {
        const t = tk[ti++];
        if (!t) err('値がありません');
        if (t.t === 'num') return konst(t.v);
        if (t.t === 'op' && t.v === '(') { const e = expr(); need(')'); return e; }
        if (t.t === 'op' && t.v === '-') { const e = atom(), g = e.f; return e.k ? konst(-e.v) : { f: () => -g() }; }
        if (t.t !== 'name') err('値として読めません: ' + show(t));
        if (t.v === 'TIME') return { f: () => frameNo };
        if (FUNCS[t.v]) {
          const [n, fn, impure] = FUNCS[t.v];
          need('(');
          const a = [expr()];
          while (eat(',')) a.push(expr());
          need(')');
          if (a.length !== n) err(sp(t.v) + ' の引数は ' + n + ' 個です');
          if (!impure && a.every(e => e.k)) return konst(fn(...a.map(e => e.v)));
          const g = a.map(e => e.f);
          return n === 1 ? { f: () => fn(g[0]()) } : { f: () => fn(g[0](), g[1]()) };
        }
        const s = syms.get(t.v);
        if (!s) err(funcs.has(t.v) ? sp(t.v) + ' はブロックの名前なので、値には使えません' : '定義されていません: ' + sp(t.v) + '（変数は variables { } に書きます）');
        return s.kind === 'const' ? konst(s.v) : { f: cell(t.v, s).get };
      }
      function term() {
        let a = atom();
        for (;;) {
          if (eat('*')) a = calc(a, atom(), MATH.MUL);
          else if (eat('/')) a = calc(a, atom(), DIVIDE);
          else if (eat('%')) a = calc(a, atom(), REMAIN);
          else return a;
        }
      }
      function expr() {
        let a = term();
        for (;;) {
          if (eat('+')) a = calc(a, term(), MATH.ADD);
          else if (eat('-')) a = calc(a, term(), MATH.SUB);
          else return a;
        }
      }
      function fixed() {
        const e = expr();
        if (!e.k) err('ここには決まった数を書きます（変数は使えません）');
        return e.v;
      }
      function dest() {
        const t = tk[ti++], s = t && t.t === 'name' ? syms.get(t.v) : null;
        if (t && t.t === 'name' && (t.v in CONSTS || t.v === 'TIME')) err(sp(t.v) + ' はシステム定数なので、書きかえられません');
        if (t && t.t === 'name' && funcs.has(t.v)) err(sp(t.v) + ' を呼ぶには「call ' + sp(t.v) + '」と書きます');
        if (t && t.t === 'name' && !s) err(OPS_HINT[t.v] ? sp(t.v) + OPS_HINT[t.v] : '知らない命令か、定義されていない変数です: ' + sp(t.v));
        if (!s || s.kind !== 'var') err('書き込み先は変数にします' + (t ? ': ' + show(t) : ''));
        return cell(t.v, s);
      }
      // 条件 → 真偽を返す関数。NOT、AND、OR の順に強く結びつく
      function test() {
        if (eatWord('NOT') || eat('!')) { const c = test(); return () => !c(); }
        if (eatWord('BTN')) { const b = expr().f; return () => btn(b()); }
        if (eatWord('BTNP')) { const b = expr().f; return () => btnp(b()); }
        const a = expr().f, t = tk[ti];
        if (t && t.t === 'op' && CMP[t.v]) { ti++; const fn = CMP[t.v], b = expr().f; return () => fn(a(), b()); }
        return () => a() !== 0;
      }
      function both() {
        let c = test();
        while (eatWord('AND') || eat('&&')) { const x = c, y = test(); c = () => x() && y(); }
        return c;
      }
      function cond() {
        let c = both();
        while (eatWord('OR') || eat('||')) { const x = c, y = both(); c = () => x() || y(); }
        return c;
      }
      function jumpUnless(c) { // 条件が偽なら、あとで決まる行き先へ飛ぶ
        const j = { to: -1 };
        emit(() => { if (!c()) pc = j.to; });
        return j;
      }
      function jump() {
        const j = { to: -1 };
        emit(() => { pc = j.to; });
        return j;
      }

      function instruction(op) {
        const spec = OPS[op], a = [];
        while (ti < tk.length && a.length < spec.length) {
          const kind = spec[a.length].toLowerCase();
          if (kind === 'd') a.push(dest());
          else if (kind === 't' && tk[ti].t === 'str') a.push({ str: tk[ti++].v });
          else a.push(expr());
          if (!eat(',')) break;
        }
        const min = spec.replace(/[A-Z]/g, '').length, n = a.length;
        if (n < min || ti < tk.length) err(sp(op) + ' の引数は ' + (min === spec.length ? min : min + '〜' + spec.length) + ' 個です');
        const g = a.map(o => o.f), d = a[0];
        const arg = (i, v) => i < n ? g[i]() : v;
        if (MATH[op]) { const fn = MATH[op]; return () => { d.set(fn(d.get(), g[1]())); }; }
        switch (op) {
          case 'INC': return () => { d.set(d.get() + 1); };
          case 'DEC': return () => { d.set(d.get() - 1); };
          case 'NEG': return () => { d.set(-d.get()); };
          case 'CLS': return () => { cls(arg(0, 0)); };
          case 'PSET': return () => { pset(g[0](), g[1](), arg(2, 3)); };
          case 'PGET': return () => { d.set(pget(g[1](), g[2]())); };
          case 'LINE': return () => { line(g[0](), g[1](), g[2](), g[3](), arg(4, 3)); };
          case 'RECT': return () => { rect(g[0](), g[1](), g[2](), g[3](), arg(4, 3)); };
          case 'RECTF': return () => { rectfill(g[0](), g[1](), g[2](), g[3](), arg(4, 3)); };
          case 'CIRC': return () => { circle(g[0](), g[1](), g[2](), arg(3, 3), false); };
          case 'CIRCF': return () => { circle(g[0](), g[1](), g[2](), arg(3, 3), true); };
          case 'SPR': return () => { const f = arg(3, 0); spr(g[0](), g[1](), g[2](), arg(4, 1), arg(5, 1), (f & 1) === 1, (f & 2) === 2); };
          case 'MAP': return () => { drawMap(arg(0, 0), arg(1, 0), arg(2, 0), arg(3, 0), arg(4, MAP_W), arg(5, MAP_H)); };
          case 'MGET': return () => { d.set(mget(g[1](), g[2]())); };
          case 'MSET': return () => { mset(g[0](), g[1](), g[2]()); };
          case 'FGET': return () => { d.set(n > 2 ? +fget(g[1](), g[2]()) : fget(g[1]())); };
          case 'RELOAD': return reload;
          case 'RESET': return () => { ram.set(prog.image); }; // すべての変数を variables { } の値に戻す
          case 'PRINT': {
            const text = d.str != null ? () => d.str : () => String(Math.round(g[0]() * 100) / 100);
            return () => { // 座標を省くと直前の続きに、色を省くと直前の色で書く
              if (n > 2) { curX = g[1](); curY = g[2](); }
              if (n > 3) curC = g[3]();
              curX = print(text(), curX, curY, curC);
            };
          }
          case 'CAMERA': return () => { camera(arg(0, 0), arg(1, 0)); };
          case 'PAL': return () => { if (n) palette(g[0](), arg(1, 0)); else palette(); };
          case 'SFX': return () => { sfx(g[0](), arg(1, -1), arg(2, 0) !== 0); };
          case 'SRAND': return () => { srand(g[0]()); };
          case 'DGET': return () => { d.set(dget(g[1]())); };
          case 'DSET': return () => { dset(g[0](), g[1]()); };
          default: return () => { log(...a.map(o => o.str != null ? o.str : o.f())); }; // LOG
        }
      }

      const ret = () => { pc = stack.pop(); };
      function paren() { // ( 条件 )
        need('(');
        const c = cond();
        need(')');
        return c;
      }
      function open(block) { need('{'); blocks.push(block); }
      function endLine() {
        if (ti >= tk.length) return;
        const before = tk[ti - 1];
        err(before && before.t === 'op' && before.v === '{' ? '「{」のあとは改行します' : '余分な文字があります: ' + show(tk[ti]));
      }

      // consts { } の 1 行: 名前 = 値, …
      function constLine() {
        while (ti < tk.length) {
          const name = word();
          claim(name);
          need('=');
          syms.set(name, { kind: 'const', v: fixed() });
          if (!eat(',')) break;
        }
      }
      // variables { } の 1 行: 名前 / 名前 = 値 / 名前[大きさ] / 名前 = [値, …] をカンマで並べる
      function varLine() {
        while (ti < tk.length) {
          const name = word(), addr = image.length;
          claim(name);
          if (eat('[')) {
            const size = fixed();
            need(']');
            if (!(size >= 1 && size <= RAM_SIZE)) err('配列の大きさは 1 以上にします');
            for (let i = 0; i < Math.floor(size); i++) image.push(0);
          } else if (eat('=')) {
            if (eat('[')) { do image.push(fixed()); while (eat(',')); need(']'); } else image.push(fixed());
          } else image.push(0);
          if (image.length > RAM_SIZE) err('変数がメモリに収まりません（' + RAM_SIZE + ' 個まで）');
          syms.set(name, { kind: 'var', addr, size: image.length - addr });
          vars[name] = addr;
          if (!eat(',')) break;
        }
      }

      // ブロックの中の 1 行
      function statement() {
        const top = blocks[blocks.length - 1];
        if (eat('}')) {
          if (top.kind === 'IF' && eatWord('ELSE')) {
            if (!top.skip) err('else のあとに else は続けられません');
            top.ends.push(jump());
            top.skip.to = code.length;
            top.skip = eatWord('IF') ? jumpUnless(paren()) : null;
            need('{');
            return;
          }
          blocks.pop();
          if (top.kind === 'FUNC') { emit(ret); return; }
          if (top.kind === 'FOR') emit(() => { top.v.set(top.v.get() + 1); });
          if (top.kind !== 'IF') jump().to = top.start;
          if (top.skip) top.skip.to = code.length;
          if (top.ends) for (const j of top.ends) j.to = code.length;
          return;
        }
        const head = tk[0].t === 'name' ? tk[0].v : '';
        ti = 1;
        switch (head) {
          case 'IF': open({ kind: 'IF', line: lineNo, skip: jumpUnless(paren()), ends: [] }); return;
          case 'WHILE': { const start = code.length; open({ kind: 'WHILE', line: lineNo, start, skip: jumpUnless(paren()) }); return; }
          case 'FOR': {
            need('(');
            const v = dest();
            if (!eat(':')) err('for は「for (変数: はじめ..おわり) {」と書きます');
            const from = expr().f;
            if (!eat('..')) err('for は「for (変数: はじめ..おわり) {」と書きます');
            const to = expr().f;
            need(')');
            emit(() => { v.set(from()); });
            const start = code.length;
            open({ kind: 'FOR', line: lineNo, start, skip: jumpUnless(() => v.get() <= to()), v });
            return;
          }
          case 'ELSE': err('else は「} else {」のように、閉じる } と同じ行に書きます'); return;
          case 'RET': emit(ret); return;
          case 'CALL': {
            const name = word(), j = funcs.get(name);
            if (!j) err('そのブロックはありません: ' + sp(name));
            emit(() => {
              if (stack.length >= STACK_SIZE) throw new Error('call が深すぎます（自分自身を呼び続けていませんか）');
              stack.push(pc);
              pc = j.to;
            });
            return;
          }
          default: {
            if (Object.prototype.hasOwnProperty.call(OPS, head)) { emit(instruction(head)); return; }
            ti = 0;
            const d = dest(); // 代入: 変数 = 値
            if (!eat('=')) err('「変数 = 値」か命令を書きます');
            const v = expr().f;
            emit(() => { d.set(v()); });
          }
        }
      }

      try {
        const rows = source.split('\n').map(r => clean(r).trim());
        const each = fn => rows.forEach((text, idx) => {
          if (!text) return;
          lineNo = idx + 1;
          tk = tokenize(text, lineNo);
          for (const t of tk) if (t.t === 'name' && !spell.has(t.v)) spell.set(t.v, t.raw);
          ti = 0;
          fn();
        });
        const closes = () => tk[0].t === 'op' && tk[0].v === '}';
        const opens = () => { const t = tk[tk.length - 1]; return t.t === 'op' && t.v === '{'; };

        // 1 回目: 定数・変数・ブロックの名前を集める（書く順番を問わないように）
        let mode = '', depth = 0, opened = 0;
        each(() => {
          if (mode) {
            if (closes()) { ti = 1; mode = ''; } else if (mode === 'CONSTS') constLine(); else varLine();
            endLine();
          } else if (depth) {
            depth += opens() - closes();
          } else {
            if (tk[0].t !== 'name' || tk.length < 2 || !opens()) err('ここには「名前 {」を書きます（命令はブロックの中に書きます）');
            const name = tk[0].v;
            ti = 2;
            endLine();
            opened = lineNo;
            if (name === 'CONSTS' || name === 'VARIABLES') mode = name;
            else { claim(name); funcs.set(name, { to: -1 }); depth = 1; }
          }
        });
        if (mode || depth) { lineNo = opened; err('閉じる } がありません'); }

        // 2 回目: ブロックの中身を命令に直す
        each(() => {
          if (mode) { if (closes()) mode = ''; return; }
          if (!blocks.length) {
            const name = tk[0].v;
            if (name === 'CONSTS' || name === 'VARIABLES') { mode = name; return; }
            funcs.get(name).to = code.length;
            blocks.push({ kind: 'FUNC', line: lineNo });
            return;
          }
          statement();
          endLine();
        });
      } catch (e) {
        throw e instanceof AsmError ? e : new AsmError(e.message, lineNo);
      }
      const entry = {};
      for (const k of ['INIT', 'UPDATE', 'DRAW']) entry[k.toLowerCase()] = funcs.has(k) ? funcs.get(k).to : -1;
      return { code, lines, entry, vars, image: Float64Array.from(image), count: code.length, words: image.length };
    }

    // ラベル entry を呼び出し、対応する RET まで走らせる
    function run(entry, budget) {
      if (entry < 0) return;
      const code = prog.code;
      stack.length = 0;
      stack.push(-1);
      pc = entry;
      for (let n = 0; pc !== -1; n++) {
        if (!(pc >= 0 && pc < code.length)) throw new Error('プログラムの終わりを越えました');
        if (n >= budget) throw new Error('処理が時間内に終わりません（無限ループ？）');
        cur = pc++;
        code[cur]();
      }
    }

    const api = { cls, camera, pal: palette, pset, pget, line, rect, rectfill, circ, circfill, spr, map: drawMap, print };

    function fail(e) {
      const at = e instanceof AsmError ? e.line : (prog ? prog.lines[cur] : 0);
      error = { message: String((e && e.message) || e), line: at || 0 };
      silence();
    }
    /* カートを最初から起動する。成功すれば true */
    function boot() {
      error = null; prog = null; frameNo = 0; buttons = prev = 0; dataDirty = false;
      cur = 0; curX = curY = 0; curC = 3;
      camera(); palette(); silence();
      seed = (host.seed != null ? host.seed : Date.now()) >>> 0;
      screen.fill(0);
      map.set(rom.map);
      ram.fill(0);
      data = host.loadData ? host.loadData() : [];
      if (!Array.isArray(data)) data = [];
      try {
        prog = compile(rom.code);
        ram.set(prog.image);
        run(prog.entry.init, INIT_BUDGET);
      } catch (e) { fail(e); }
      return !error;
    }
    /* 1 フレーム進める。input は BTN のビットを立てた整数 */
    function frame(input) {
      if (error || !prog) return;
      prev = buttons; buttons = input | 0;
      try {
        run(prog.entry.update, FRAME_BUDGET);
        run(prog.entry.draw, FRAME_BUDGET);
      } catch (e) { fail(e); return; }
      tickSound();
      frameNo++;
      if (dataDirty) { dataDirty = false; if (host.saveData) host.saveData(data.slice(0, DATA_SLOTS)); }
    }

    return {
      screen, map, channels, ram, api, compile, boot, frame, silence,
      get vars() { return prog ? prog.vars : {}; },
      get error() { return error; },
      get frameCount() { return frameNo; },
    };
  }

  return {
    W, H, FPS, TILE, SHEET, SHEET_PX, TILES, MAP_W, MAP_H, SFX_COUNT, SFX_STEPS, PITCHES, CHANNELS, DATA_SLOTS,
    BTN, WAVES, PALETTES, DEFAULT_PALETTE, pitchFreq, pitchName, parseNotes,
    RAM_SIZE, newRom, newSfx, sfxEmpty, encodeCart, decodeCart, drawArt, assemble, lowerCommands, createMachine,
  };
});
