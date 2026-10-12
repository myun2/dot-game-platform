/* player.js — 実機の見た目と入出力。本体（core.js）を画面・キー・音につなぐ。
   エディタと、書き出した単体 HTML の両方がこれを使う。 */
(function (root, factory) {
  const api = factory(root);
  api.SOURCE = '(' + factory.toString() + ')(globalThis)';
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DotPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const KEYS = {
    ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3,
    KeyZ: 4, KeyX: 5, Enter: 6, ShiftLeft: 7, ShiftRight: 7,
  };
  const START = 6;

  const CSS = [
    '.dot-console{box-sizing:border-box;width:380px;max-width:100%;margin:0 auto;padding:18px 18px 26px;background:#2d3250;border-radius:28px;box-shadow:inset 0 0 0 2px #3d4369,0 10px 30px rgba(0,0,0,.45);font-family:ui-sans-serif,system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}',
    '.dot-bezel{background:#14162a;border-radius:16px;padding:12px}',
    '.dot-screen{display:block;width:100%;aspect-ratio:160/144;image-rendering:pixelated;background:#1b1d3a;border-radius:4px}',
    '.dot-brand{margin:12px 0 0;text-align:center;font-weight:800;letter-spacing:.5em;text-indent:.5em;color:#f7c873;font-size:13px}',
    '.dot-brand small{display:none}',
    '.dot-console button{border:0;padding:0;font:inherit;cursor:pointer;touch-action:none}',
    '.dot-console button.on{filter:brightness(.7)}',
    '.dot-meta{display:flex;justify-content:center;gap:12px;margin-top:14px}',
    '.dot-meta button{background:#434a75;border-radius:6px;padding:6px 12px;font-size:9px;font-weight:700;color:#c9cde6;letter-spacing:.12em}',
    '.dot-controls{display:flex;justify-content:space-between;align-items:center;margin:16px 6px 0}',
    '.dot-dpad{display:grid;grid-template:repeat(3,36px)/repeat(3,36px);gap:3px}',
    '.dot-dpad button{background:#f4f0e4;color:#2d3250;font-size:11px;border-radius:10px}',
    '.dot-dpad [data-btn="2"]{grid-area:1/2}',
    '.dot-dpad [data-btn="0"]{grid-area:2/1}',
    '.dot-dpad i{grid-area:2/2}',
    '.dot-dpad [data-btn="1"]{grid-area:2/3}',
    '.dot-dpad [data-btn="3"]{grid-area:3/2}',
    '.dot-ab{display:flex;gap:14px}',
    '.dot-ab button{width:56px;height:56px;border-radius:18px;background:#f2796a;color:#3a1512;font-weight:800}',
  ].join('\n');

  const MARKUP =
    '<div class="dot-console">' +
      '<div class="dot-bezel"><canvas class="dot-screen" width="160" height="144"></canvas></div>' +
      '<div class="dot-brand">DOT</div>' +
      '<div class="dot-meta"><button data-btn="7">SELECT</button><button data-btn="6">START</button></div>' +
      '<div class="dot-controls">' +
        '<div class="dot-dpad">' +
          '<button data-btn="2" aria-label="上">▲</button><button data-btn="0" aria-label="左">◀</button><i></i>' +
          '<button data-btn="1" aria-label="右">▶</button><button data-btn="3" aria-label="下">▼</button>' +
        '</div>' +
        '<div class="dot-ab"><button data-btn="5">B</button><button data-btn="4">A</button></div>' +
      '</div>' +
    '</div>';

  function injectCSS() {
    if (document.getElementById('dot-player-css')) return;
    const style = document.createElement('style');
    style.id = 'dot-player-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  function rgba(hex) { // '#rrggbb' → ImageData にそのまま書ける 32bit 値
    const v = parseInt(hex.slice(1), 16);
    return (0xff000000 | (v & 0xff) << 16 | (v & 0xff00) | v >> 16) >>> 0;
  }
  function typing(t) {
    return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function show(v) {
    if (typeof v === 'string') return v;
    try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); }
  }

  /* opts: { onState(state), onError({message, line}), onLog(text) }
     state は 'idle' | 'running' | 'paused' | 'crashed' */
  function mount(el, opts) {
    opts = opts || {};
    const Core = root.DotCore;
    const STEP = 1000 / Core.FPS;
    injectCSS();
    el.innerHTML = MARKUP;
    const canvas = el.querySelector('canvas'), g = canvas.getContext('2d');
    const img = g.createImageData(Core.W, Core.H), buf = new Uint32Array(img.data.buffer);
    const lut = new Uint32Array(4);
    const audio = root.DotAudio ? root.DotAudio.create() : null;
    let rom = Core.newRom(), machine = null, state = 'idle';
    let raf = 0, last = 0, acc = 0, keys = 0, touch = 0;

    const saveKey = () => 'dot-save:' + rom.title;
    const host = {
      voice(ch, wave, freq, vol) { if (audio) audio.voice(ch, wave, freq, vol); },
      log(...args) { const text = args.map(show).join(' '); if (opts.onLog) opts.onLog(text); else console.log(text); },
      loadData() { try { return JSON.parse(localStorage.getItem(saveKey())) || []; } catch (e) { return []; } },
      saveData(d) { try { localStorage.setItem(saveKey(), JSON.stringify(d)); } catch (e) { /* 保存できない環境 */ } },
    };

    function setState(s) { state = s; if (opts.onState) opts.onState(s); }
    function render() {
      const s = machine.screen;
      for (let i = 0; i < s.length; i++) buf[i] = lut[s[i]];
      g.putImageData(img, 0, 0);
    }
    function setPalette(name) {
      (Core.PALETTES[name] || Core.PALETTES[Core.DEFAULT_PALETTE]).forEach((c, i) => { lut[i] = rgba(c); });
      if (machine) render();
    }
    function halt() {
      cancelAnimationFrame(raf);
      raf = 0;
      machine.silence();
    }

    function idle() {
      const a = machine.api, title = rom.title.slice(0, 38);
      a.camera(); a.pal(); a.cls(0);
      a.rectfill(0, 52, 160, 23, 3);
      a.print(title, 80 - title.length * 2, 57, 0);
      a.print('PRESS START', 58, 66, 1);
      a.print('DOT SYSTEM', 60, 132, 2);
      render();
      setState('idle');
    }
    function crash() {
      halt();
      const a = machine.api, err = machine.error;
      a.camera(); a.pal(); a.cls(3);
      a.print(err.line ? 'ERROR  LINE ' + err.line : 'ERROR', 4, 4, 0);
      const text = err.message.replace(/\s+/g, ' ');
      for (let i = 0; i * 38 < text.length && i < 18; i++) a.print(text.slice(i * 38, i * 38 + 38), 4, 16 + i * 7, 1);
      render();
      setState('crashed');
      if (opts.onError) opts.onError(err);
    }
    function tick(now) {
      raf = requestAnimationFrame(tick);
      acc += Math.min(now - last, 100);
      last = now;
      let n = 0;
      for (; acc >= STEP && n < 4; n++) { machine.frame(keys | touch); acc -= STEP; }
      if (machine.error) { crash(); return; }
      if (n) render();
    }
    function loop() {
      last = performance.now(); acc = STEP;
      raf = requestAnimationFrame(tick);
      setState('running');
    }

    function load(r) {
      if (machine) halt();
      rom = r;
      machine = Core.createMachine(rom, host);
      setPalette(rom.palette);
      idle();
    }
    function run() {
      halt();
      if (audio) audio.resume();
      if (machine.boot()) loop(); else crash();
    }
    function stop() { halt(); idle(); }
    function togglePause() {
      if (state === 'running') { halt(); setState('paused'); } else if (state === 'paused') loop();
    }

    // -- キーボード --
    function press(b, down) {
      if (down) {
        if (audio) audio.resume();
        if (state === 'idle' || state === 'crashed') { if (b === START) run(); return; }
        keys |= 1 << b;
      } else keys &= ~(1 << b);
    }
    function onKey(e) {
      const b = KEYS[e.code];
      if (b === undefined || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (e.type === 'keydown') { if (!e.repeat) press(b, true); } else press(b, false);
    }
    root.addEventListener('keydown', onKey);
    root.addEventListener('keyup', onKey);
    root.addEventListener('blur', () => { keys = 0; touch = 0; });

    // -- 画面のボタン（タッチ・マウス）--
    el.querySelectorAll('[data-btn]').forEach(b => {
      const bit = 1 << +b.dataset.btn;
      const up = () => { touch &= ~bit; b.classList.remove('on'); };
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        if (audio) audio.resume();
        if ((state === 'idle' || state === 'crashed') && +b.dataset.btn === START) run(); else touch |= bit;
      });
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', e => e.preventDefault());
    });

    load(rom);
    return {
      load, run, stop, togglePause, setPalette, audio,
      get state() { return state; },
      get machine() { return machine; },
    };
  }

  /* カートを、これ 1 枚で遊べる HTML にする */
  function exportHTML(rom) {
    const Core = root.DotCore, Audio = root.DotAudio;
    const esc = s => s.replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
    const cart = JSON.stringify(Core.encodeCart(rom)).replace(/</g, '\\u003c');
    const close = '<' + '/script>';
    return '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(rom.title) + '</title>\n' +
      '<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#17182a}#dot{width:100%;padding:12px;box-sizing:border-box}</style>\n' +
      '</head>\n<body>\n<div id="dot"></div>\n<script>\n' +
      'globalThis.DotCore=' + Core.SOURCE + ';\n' +
      'globalThis.DotAudio=' + Audio.SOURCE + ';\n' +
      'globalThis.DotPlayer=' + api.SOURCE + ';\n' +
      'var player=DotPlayer.mount(document.getElementById("dot"));\n' +
      'player.load(DotCore.decodeCart(' + cart + '));\nplayer.run();\n' +
      close + '\n</body>\n</html>\n';
  }

  const api = { mount, exportHTML, CSS };
  return api;
});
