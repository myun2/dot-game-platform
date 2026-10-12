/* tests/core.cjs — 画面なしで本体と同梱カートを検査する
   実行: node tests/core.cjs */
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'core.js'));
const Carts = require(path.join(root, 'carts.js'));
require(path.join(root, 'audio.js'));
const Player = require(path.join(root, 'player.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function machine(code, setup) {
  const rom = C.newRom();
  rom.code = code;
  if (setup) setup(rom);
  const voices = [], logs = [], saved = [];
  const m = C.createMachine(rom, {
    seed: 1, voice: (...a) => voices.push(a), log: (...a) => logs.push(a),
    loadData: () => [7], saveData: d => saved.push(d),
  });
  return { rom, m, voices, logs, saved };
}
const at = (m, x, y) => m.screen[y * C.W + x];
const count = (m, c) => m.screen.reduce((n, v) => n + (v === c), 0);
function dump(m) { // 目で確かめたいとき用
  const ch = ' .+#';
  for (let y = 0; y < C.H; y += 2) {
    let s = '';
    for (let x = 0; x < C.W; x++) s += ch[Math.max(at(m, x, y), at(m, x, y + 1))];
    console.log(s);
  }
}

test('カートリッジは保存して読み戻すと同じになる', () => {
  for (const s of Carts.samples) {
    const a = s.make();
    const json = JSON.stringify(C.encodeCart(a));
    const b = C.decodeCart(json);
    assert.deepStrictEqual(b, a);
    assert.strictEqual(JSON.stringify(C.encodeCart(b)), json);
  }
  assert.throws(() => C.decodeCart('{"title":"x"}'));
});

test('図形ははみ出しても壊れず、範囲内だけ塗る', () => {
  const { m } = machine(`draw {
    CLS 0
    RECTF -5, -5, 10, 10, 3
    RECT 150, 140, 50, 50, 2
    PSET 999, 999, 3
    LINE 0, 143, 159, 143, 1
    CIRCF 80, 72, 4, 2
  }`);
  assert(m.boot(), m.error && m.error.message);
  m.frame(0);
  assert.strictEqual(at(m, 0, 0), 3);
  assert.strictEqual(at(m, 4, 4), 3);
  assert.strictEqual(at(m, 5, 5), 0);
  assert.strictEqual(at(m, 150, 140), 2);
  assert.strictEqual(at(m, 151, 141), 0);
  assert.strictEqual(count(m, 1), 160);
  assert.strictEqual(at(m, 80, 72), 2);
  assert.strictEqual(at(m, 84, 72), 2);
  assert.strictEqual(at(m, 85, 72), 0);
});

test('スプライトは色 0 が透明で、反転とカメラが効く', () => {
  const { m } = machine(`draw {
    CLS 1
    CAMERA 10, 0
    SPR 1, 10, 0
    SPR 1, 30.9, 0, 1
    PAL 3, 2
    SPR 1, 50, 0
    PAL
  }`, rom => C.drawArt(rom, 1, ['3.......', '........']));
  assert(m.boot(), m.error && m.error.message);
  m.frame(0);
  assert.strictEqual(at(m, 0, 0), 3);
  assert.strictEqual(at(m, 1, 0), 1);   // 透明なので CLS の色のまま
  assert.strictEqual(at(m, 27, 0), 3);  // 左右反転。小数の座標は切り捨て
  assert.strictEqual(at(m, 40, 0), 2);  // PAL で 3 → 2
});

test('マップはタイル 0 を飛ばして描き、MSET は ROM を書き換えない', () => {
  const { m, rom } = machine('init {\n MSET 1, 0, 1\n}\ndraw {\n CLS 0\n MAP\n}', rom => {
    C.drawArt(rom, 1, Array(8).fill('22222222'));
    rom.map[0] = 1;
  });
  assert(m.boot(), m.error && m.error.message);
  m.frame(0);
  assert.strictEqual(count(m, 2), 128);
  assert.strictEqual(rom.map[1], 0);
});

test('文字と数が描け、座標を省くと続きに書く', () => {
  const { m } = machine('draw {\n CLS 0\n PRINT "I", 0, 0, 3\n PRINT 1\n}');
  assert(m.boot(), m.error && m.error.message);
  m.frame(0);
  assert.deepStrictEqual([0, 1, 2].map(x => at(m, x, 0)), [3, 3, 3]);
  assert.deepStrictEqual([0, 1, 2].map(x => at(m, x, 1)), [0, 3, 0]);
  assert.deepStrictEqual([4, 5, 6].map(x => at(m, x, 1)), [3, 3, 0]);  // 「1」の 2 行目
});

test('定数・変数・配列・式・関数', () => {
  const { m, logs } = machine(`
    init {
      for (i: 0..3) {
        arr[i] = i * i
      }
      x = x + tbl[1] / 8               # 小数もそのまま
      MUL tbl[0], -2
      LOG x, N, K, arr[3], tbl[0], tbl[2]
      LOG INT(-1.5), MAX(2, 7) % 4, ABS(-3) - -1, p, q
      i = RND(5)
    }
    # 宣言はどこに書いてもよい
    consts {
      N = 3 * (2 + 2) - $0A / 2        # 定数式 = 7
      K = N + 1, J = 0
    }
    variables {
      x = 1.5
      tbl = [10, 20, 'A']
      arr[4], i
      p, q = 3                         # 1 行にいくつでも
    }`);
  assert(m.boot(), m.error && m.error.message + ' @' + m.error.line);
  assert.deepStrictEqual(logs, [[4, 7, 8, 9, -20, 65], [-2, 3, 4, 0, 3]]);
  const i = m.ram[m.vars.I];
  assert(Number.isInteger(i) && i >= 0 && i < 5);
});

test('if / else if / else、while、and / or / not、CALL / RET', () => {
  const { m, logs } = machine(`
    variables {
      v, n
    }
    init {
      for (v: 1..4) {
        CALL kind
      }
      n = 1
      while (n < 100) {
        MUL n, 2
      }
      LOG n
      if (not v == 5 or n == 128 and v > 100) {
        LOG "bad"
      }
      if (v == 5 && (n + 1) * 2 == 258 && !BTN A || v == 99) {
        LOG "done"
      }
    }
    kind {
      if (v == 1) {
        LOG "one"
      } else if (v == 2) {
        LOG "two"
        RET                            # ブロックの途中から戻ってよい
      } else {
        if (v >= 4) {
          LOG "big"
        }
      }
    }`);
  assert(m.boot(), m.error && m.error.message + ' @' + m.error.line);
  assert.deepStrictEqual(logs.map(l => l[0]), ['one', 'two', 'big', 128, 'done']);
});

test('reset は変数をぜんぶ variables の値に戻す', () => {
  const { m, logs } = machine(`
    variables {
      x = 5, xs = [1, 2], n
    }
    init {
      x = 9
      xs[1] = 7
      n = 3
      log x, xs[1], n
      reset
      log x, xs[1], n
    }`);
  assert(m.boot(), m.error && m.error.message + ' @' + m.error.line);
  assert.deepStrictEqual(logs, [[9, 7, 3], [5, 2, 0]]);
});

test('BTNP は押した瞬間の 1 フレームだけ真になる', () => {
  const { m, logs } = machine(`
    variables {
      held, hit
    }
    update {
      held = 0
      hit = 0
      if (BTN A) {
        held = 1
      }
      if (BTNP A) {
        hit = 1
      }
      LOG held, hit
    }`);
  assert(m.boot(), m.error && m.error.message + ' @' + m.error.line);
  m.frame(0); m.frame(1 << C.BTN.A); m.frame(1 << C.BTN.A); m.frame(0);
  assert.deepStrictEqual(logs, [[0, 0], [1, 1], [1, 0], [0, 0]]);
});

test('効果音はステップごとに鳴り、終わると止まる', () => {
  const { m, voices } = machine('init {\n SFX 0\n}', rom => { C.parseNotes(rom.sfx[0], 'C3 C4:1'); rom.sfx[0].speed = 2; });
  assert(m.boot(), m.error && m.error.message);
  voices.length = 0;
  for (let i = 0; i < 6; i++) m.frame(0);
  assert.strictEqual(voices.length, 3);
  assert.deepStrictEqual(voices[0].slice(0, 2), [0, 0]);
  assert(Math.abs(voices[0][2] - 130.81) < 0.01 && voices[0][3] === 1);
  assert(Math.abs(voices[1][2] - 261.63) < 0.01 && Math.abs(voices[1][3] - 1 / 3) < 1e-9);
  assert.deepStrictEqual(voices[2], [0, 0, 0, 0]);
  assert.strictEqual(m.channels[0].sfx, -1);
});

test('セーブデータは読めて、書くとホストに渡る', () => {
  const { m, logs, saved } = machine('variables {\n v\n}\ninit {\n DGET v, 0\n LOG v\n DSET 1, 42\n}');
  assert(m.boot(), m.error && m.error.message);
  m.frame(0);
  assert.deepStrictEqual(logs, [[7]]);
  assert.deepStrictEqual(saved, [[7, 42]]);
});

const V = 'variables {\n v, t[3], i = 5\n}\n';  // 3 行ぶん
test('実行時エラーは行番号つきで止まる', () => {
  const cases = [
    [V + 'update {\n DIV v, 0\n}', 5, /0 で割/],
    [V + 'update {\n v = 1 / v\n}', 5, /0 で割/],
    [V + 'update {\n t[i] = 1\n}', 5, /範囲外/],
    ['update {\n while (1) {\n }\n}', 3, /無限ループ/],
    ['update {\n CALL update\n}', 2, /call が深/],
  ];
  for (const [code, line, re] of cases) {
    const { m } = machine(code);
    assert(m.boot(), code + ' → ' + (m.error && m.error.message));
    m.frame(0);
    assert(m.error && re.test(m.error.message), code + ' → ' + (m.error && m.error.message));
    assert.strictEqual(m.error.line, line, code);
    const frames = m.frameCount;
    m.frame(0);
    assert.strictEqual(m.frameCount, frames);
  }
});

test('文法エラーは行番号つきで起動に失敗する', () => {
  const cases = [
    ['init {\n Foo 1\n}', 2, /知らない命令.*Foo/],
    [V + 'init {\n Add v\n}', 5, /Add の引数/],
    ['init {\n 5 = 1\n}', 2, /書き込み先/],
    [V + 'init {\n ADD v\n}', 5, /引数/],
    [V + 'init {\n v = 1, 2\n}', 5, /余分/],
    ['init {\n CALL nowhere\n}', 2, /ブロックはありません/],
    [V + 'init {\n v = nothing\n}', 5, /定義されていません/],
    ['init {\n}\ninit {\n}', 3, /2 回/],
    ['variables {\n v\n v\n}', 3, /2 回/],
    ['variables {\n add\n}', 2, /名前に使えません/],
    ['variables {\n a\n}', 2, /システム定数/],
    ['consts {\n TIME = 1\n}', 2, /システム定数/],
    ['init {\n SCREEN_W = 1\n}', 2, /書きかえられません/],
    ['init {\n PRINT "abc, 1, 2\n}', 2, /読めません/],
    [V + 'init {\n if (v == 1) {\n  v = 2\n}', 4, /閉じる }/],
    ['init {\n}\n}', 3, /名前 \{/],
    ['CLS 0', 1, /ブロックの中/],
    [V + 'init {\n if (v == 1) {\n }\n else {\n }\n}', 7, /同じ行/],
    [V + 'init {\n if (v == 1) { v = 2 }\n}', 5, /改行/],
    [V + 'init {\n if v == 1 {\n }\n}', 5, /"\("/],
    [V + 'init {\n v = (1 + 2\n}', 5, /"\)"/],
    ['variables {\n v\n t[v]\n}', 3, /決まった数/],
    ['consts {\n k = 1 / 0\n}', 2, /0 で割/],
    [V + 'init {\n v = init\n}', 5, /ブロックの名前/],
    [V + 'init {\n init()\n}', 5, /call init/],
    [V + 'init {\n for (v = 1, 3) {\n }\n}', 5, /for は/],
    [V + 'init {\n SET v, 1\n}', 5, /SET はありません/],
    ['VAR v', 1, /名前 \{/],
    ['variables {\n v\n', 1, /閉じる }/],
  ];
  for (const [code, line, re] of cases) {
    const { m } = machine(code);
    assert.strictEqual(m.boot(), false, code);
    assert(re.test(m.error.message), code + ' → ' + m.error.message);
    assert.strictEqual(m.error.line, line, code + ' → ' + m.error.message);
  }
  assert.throws(() => C.assemble('init {\n FOO\n}'), e => e.line === 2);
  assert.strictEqual(C.assemble('variables {\n v = [1, 2]\n}\ninit {\n}').words, 2);
});

test('大文字で書かれた命令は小文字にそろえられる（文字列・コメント・名前はそのまま）', () => {
  const before = 'consts {\n  SPEED = 2\n}\nINIT {\n  CLS 0   # CLS で消す\n  PRINT "PRINT A", SPEED, MAX(1, TIME)\n  IF (BTN LEFT AND x == \'A\') {\n    CALL Draw\n  }\n}';
  const after = 'consts {\n  SPEED = 2\n}\nINIT {\n  cls 0   # CLS で消す\n  print "PRINT A", SPEED, max(1, TIME)\n  if (btn LEFT and x == \'A\') {\n    call Draw\n  }\n}';
  assert.strictEqual(C.lowerCommands(before), after);
  for (const s of Carts.samples) { const code = s.make().code; assert.strictEqual(C.lowerCommands(code), code); }
});

test('同梱カートはでたらめな入力で回しても落ちない', () => {
  for (const s of Carts.samples.concat({ name: 'blank', make: Carts.blank })) {
    for (let seed = 1; seed <= 20; seed++) {
      const m = C.createMachine(s.make(), { seed });
      assert(m.boot(), s.name + ': ' + (m.error && m.error.message + ' @' + m.error.line));
      let input = 0, r = seed;
      for (let f = 0; f < 3000; f++) {
        if (f % 7 === 0) { r = (r * 1103515245 + 12345) >>> 0; input = (r >>> 16) & 255; }
        m.frame(input);
        assert(!m.error, s.name + ' f' + f + ': ' + (m.error && m.error.message + ' @' + m.error.line));
      }
    }
  }
});

test('DOT JUMP は穴とトゲの手前で跳べばクリアできる', () => {
  const rom = Carts.samples[0].make();
  let best = 0;
  const m = C.createMachine(rom, { seed: 1, saveData: d => { best = d[0]; } });
  assert(m.boot(), m.error && m.error.message);
  const v = name => m.ram[m.vars[name]];
  assert.strictEqual(v('TOTAL'), 16);
  const tile = (x, y) => rom.map[y * C.MAP_W + x];
  const danger = x => !(rom.flags[tile(x, 16)] & 1) || tile(x, 15) === 5;
  let a = false, grounded = 0, f = 0;
  for (; f < 1800 && v('STATE') === 0; f++) {
    const ground = v('GROUND') === 1;
    grounded += ground;
    a = ground ? !a && danger(Math.floor((v('PX') + 4) / 8) + 1) : a;
    m.frame(1 << C.BTN.RIGHT | (a ? 1 << C.BTN.A : 0));
  }
  assert(!m.error, m.error && m.error.message + ' @' + m.error.line);
  assert.strictEqual(v('STATE'), 2, 'x=' + v('PX') + ' で終了');
  assert(best > 0 && v('COINS') > 0);
  assert(grounded > f / 3, '地面の判定が途切れている');
  console.log('     クリアタイム ' + (best / 60).toFixed(1) + ' 秒、コイン ' + v('COINS') + '/' + v('TOTAL'));
  for (let i = 0; i < 40; i++) m.frame(0);            // クリア画面で少し待ち、A でやり直す
  m.frame(1 << C.BTN.A);
  assert(!m.error, m.error && m.error.message + ' @' + m.error.line);
  assert.deepStrictEqual(['STATE', 'COINS', 'FRAMES', 'TOTAL'].map(v), [0, 0, 0, 16]);
  assert(Math.abs(v('PX') - 16) < 2 && v('PY') >= 96);
});

test('単体 HTML に本体とカートが入る', () => {
  const html = Player.exportHTML(Carts.samples[0].make());
  assert(html.includes('globalThis.DotCore=(function'));
  assert(html.includes('"title":"DOT JUMP"'));
  assert.strictEqual(html.split('</script>').length, 2);
});

if (process.argv.includes('--dump')) {
  const m = C.createMachine(Carts.samples[0].make(), { seed: 1 });
  m.boot();
  for (let f = 0; f < 40; f++) m.frame(0);
  dump(m);
}
console.log(passed + ' passed');
