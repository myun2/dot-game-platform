/* carts.js — 同梱カートリッジ（新規作成のひな形とサンプル） */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.DotCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DotCarts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  // ---- 新規 ------------------------------------------------------------
  const BLANK_CODE = `# 新しいカートリッジ
# init は起動時に 1 回、update と draw は毎秒 60 回呼ばれる

variables {
}

init {
}

update {
}

draw {
  cls 0
  print "HELLO, DOT!", 58, 68, 3
}
`;
  function blank() {
    const r = C.newRom();
    r.code = BLANK_CODE;
    return r;
  }

  // ---- HELLO -----------------------------------------------------------
  const HELLO_CODE = `# HELLO — 十字キーで動かす。A で音が鳴る

variables {
  x = 76
  y = 68
}

update {
  if (btn LEFT) {
    x = x - 1
  }
  if (btn RIGHT) {
    x = x + 1
  }
  if (btn UP) {
    y = y - 1
  }
  if (btn DOWN) {
    y = y + 1
  }
  x = max(0, min(x, SCREEN_W - 8))   # 画面の外に出さない
  y = max(0, min(y, SCREEN_H - 8))
  if (btnp A) {                      # 押した瞬間だけ
    sfx 0
  }
}

draw {
  cls 0
  print "HELLO, DOT!", 58, 20, 3
  print "X ", 2, 136, 2              # 座標を省くと続きに書く
  print x
  print "  Y "
  print y
  spr 1, x, y
}
`;
  function hello() {
    const r = C.newRom();
    r.title = 'HELLO';
    r.code = HELLO_CODE;
    C.drawArt(r, 1, [
      '..3333..',
      '.311113.',
      '31311313',
      '31111113',
      '31311313',
      '31133113',
      '.311113.',
      '..3333..',
    ]);
    C.parseNotes(r.sfx[0], 'C5 E5 G5:2 C6:1');
    r.sfx[0].speed = 3;
    return r;
  }

  // ---- DOT JUMP --------------------------------------------------------
  const JUMP_CODE = `# DOT JUMP — コインを集めて旗をめざす
# タイル: 1-3 = 地面（フラグ 0 = 壁）  4 = コイン  5 = トゲ  6 = 旗

consts {
  SPEED   = 1.25
  JUMP    = -4.5
  GRAVITY = 0.25
}

variables {
  px = 16, py = 96  # プレイヤーの位置
  vx, vy            # プレイヤーの速さ（書かなければ 0）
  ground            # 1 = 地面の上
  face              # 1 = 左向き
  coins
  total
  state             # 0 = プレイ中  1 = ミス  2 = クリア
  timer
  frames
  tx, ty            # 以下は作業用
  t
  wall
  n
}

init {
  reload                      # 取ったコインを元に戻す
  for (ty: 0..17) {           # マップ上のコインを数える
    for (tx: 0..63) {
      mget t, tx, ty
      if (t == 4) {
        inc total
      }
    }
  }
  sfx 3, 0, 1                 # BGM をチャンネル 0 でループ
}

# 左上が (tx, ty) のプレイヤーが壁に重なっていれば wall が 1 以上になる
hit {
  wall = 0
  mget t, (tx + 1) / 8, ty / 8
  fget t, t, 0
  add wall, t
  mget t, (tx + 6) / 8, ty / 8
  fget t, t, 0
  add wall, t
  mget t, (tx + 1) / 8, (ty + 7) / 8
  fget t, t, 0
  add wall, t
  mget t, (tx + 6) / 8, (ty + 7) / 8
  fget t, t, 0
  add wall, t
}

update {
  if (state != 0) {           # ミス / クリアの画面。少し待ってから受けつける
    inc timer
    if (timer > 30) {
      if (btnp A or btnp START) {
        reset                 # 変数をぜんぶ variables の値に戻して、やり直す
        call init
      }
    }
    ret
  }
  inc frames

  vx = 0
  if (btn LEFT) {
    vx = -SPEED
    face = 1
  }
  if (btn RIGHT) {
    vx = SPEED
    face = 0
  }
  if (btnp A and ground == 1) {
    vy = JUMP
    sfx 0
  }
  if (not btn A and vy < -1) {   # 早く離すと低いジャンプ
    vy = -1
  }
  vy = min(vy + GRAVITY, 4)

  tx = max(0, min(px + vx, 63 * 8))   # 横: 壁なら動かない
  ty = py
  call hit
  if (wall == 0) {
    px = tx
  }

  tx = px                     # 縦: ぶつかったらタイルの境目にそろえる
  ty = py + vy
  call hit
  if (wall > 0) {
    if (vy > 0) {
      ty = int((ty + 7) / 8) * 8 - 8
    } else {
      ty = int(ty / 8) * 8 + 8
    }
    vy = 0
  }
  py = ty

  ty = ty + 1                 # 足の 1 ピクセル下が壁なら地面の上
  call hit
  ground = min(wall, 1)

  mget t, (px + 4) / 8, (py + 4) / 8   # 体のまんなかにあるタイル
  if (t == 4) {
    mset (px + 4) / 8, (py + 4) / 8, 0
    inc coins
    sfx 1
  }
  if (t == 5 or py > 144) {
    state = 1
    n = 2
    call finish
  }
  if (t == 6) {
    dget t, 0                 # ベストタイムをセーブデータ 0 に残す
    if (t == 0 or frames < t) {
      dset 0, frames
    }
    state = 2
    n = 4
    call finish
  }
}

# BGM を止めて効果音 n を鳴らす
finish {
  timer = 0
  sfx -1
  sfx n
}

draw {
  cls 0
  camera max(0, min(px - 76, 64 * 8 - SCREEN_W)), 0   # プレイヤーを追い、端で止まる
  map
  n = 18                      # スプライト: 16 = 立ち  17 = 歩き  18 = ジャンプ
  if (ground == 1) {
    n = 16
    if (vx != 0) {
      n = 16 + int(TIME / 8) % 2
    }
  }
  spr n, px, py, face

  camera
  print "COIN ", 2, 2, 3
  print coins
  print "/"
  print total
  print "TIME ", 110, 2
  t = frames
  call ptime

  if (state == 0) {
    ret
  }
  rectf 30, 56, 100, 30, 3
  rect 32, 58, 96, 26, 1
  if (state == 1) {
    print "GAME OVER", 62, 63, 0
  } else {
    print "CLEAR!", 68, 62, 0
    print "BEST ", 60, 69, 1
    dget t, 0
    call ptime
  }
  print "PRESS A", 66, 76, 0
}

# t フレームを「秒.1」の形で、文字の続きに書く
ptime {
  print int(t / 60)
  print "."
  print int(t / 6) % 10
}
`;
  function jump() {
    const r = C.newRom();
    r.title = 'DOT JUMP';
    r.code = JUMP_CODE;

    C.drawArt(r, 1, ['33333333', '31113113', '11211121', '22222222', '23222322', '22222222', '22322232', '22222222']); // 草
    C.drawArt(r, 2, ['22222222', '22322222', '22222232', '22222222', '23222222', '22222322', '22222222', '22232222']); // 土
    C.drawArt(r, 3, ['33333333', '22232222', '22232222', '22232222', '33333333', '22222223', '22222223', '22222223']); // レンガ
    C.drawArt(r, 4, ['..3333..', '.310013.', '31011113', '31011113', '31011113', '31111113', '.311113.', '..3333..']); // コイン
    C.drawArt(r, 5, ['........', '........', '.3...3..', '.3...3..', '323.323.', '323.323.', '32233223', '33333333']); // トゲ
    C.drawArt(r, 6, ['.3......', '.3333...', '.322233.', '.3222223', '.322233.', '.3333...', '.3......', '.3......']); // 旗
    C.drawArt(r, 7, ['........', '...11...', '.1100111', '10000001', '10000001', '.1111111', '........', '........']); // 雲
    C.drawArt(r, 16, ['..3333..', '.311113.', '.313133.', '.311113.', '..3333..', '.322223.', '.322223.', '.33..33.']); // 立ち
    C.drawArt(r, 17, ['..3333..', '.311113.', '.313133.', '.311113.', '..3333..', '.322223.', '3322223.', '3....33.']); // 歩き
    C.drawArt(r, 18, ['3.3333.3', '.311113.', '.313133.', '.311113.', '..3333..', '.322223.', '.33..33.', '........']); // ジャンプ
    r.flags[1] = r.flags[2] = r.flags[3] = 1;

    const set = (x, y, n) => { r.map[y * C.MAP_W + x] = n; };
    const gaps = [[14, 16], [30, 32], [45, 46]];
    for (let x = 0; x < C.MAP_W; x++) {
      if (gaps.some(([a, b]) => x >= a && x <= b)) continue;
      set(x, 16, 1);
      set(x, 17, 2);
    }
    for (const [y, a, b] of [[12, 8, 10], [12, 20, 23], [9, 25, 27], [12, 33, 34], [12, 50, 52], [9, 54, 56]]) {
      for (let x = a; x <= b; x++) set(x, y, 3);
    }
    for (const [x, y] of [[3, 15], [9, 11], [10, 11], [15, 12], [18, 15], [21, 11], [22, 11], [26, 8], [28, 15], [31, 12],
      [34, 11], [38, 12], [39, 12], [51, 11], [55, 8], [58, 15]]) set(x, y, 4);
    for (const x of [6, 38, 39, 48]) set(x, 15, 5);
    set(61, 15, 6);
    for (const [x, y] of [[3, 3], [12, 5], [19, 2], [29, 4], [37, 2], [45, 5], [53, 3], [60, 4]]) set(x, y, 7);

    const sound = (i, wave, speed, notes) => { const s = r.sfx[i]; s.wave = wave; s.speed = speed; C.parseNotes(s, notes); };
    sound(0, 0, 2, 'C4:2 E4:2 G4:2 C5:1');                                            // ジャンプ
    sound(1, 1, 3, 'B5 E6 E6:2 E6:1');                                                // コイン
    sound(2, 3, 4, 'C5 G4 E4 C4:2 G3:2 C3:1');                                        // ミス
    sound(3, 2, 10, 'C4:2 - G4:2 - E4:2 - G4:2 - A3:2 - E4:2 - C4:2 - E4:2 -');       // BGM
    sound(4, 0, 5, 'C5 E5 G5 C6 - G5 C6 C6:2 C6:1');                                  // クリア
    return r;
  }

  const samples = [
    { name: 'DOT JUMP（横スクロールアクション）', make: jump },
    { name: 'HELLO（最小のプログラム）', make: hello },
  ];
  return { blank, samples };
});
