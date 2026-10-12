/* bundle.cjs — 開発環境まるごとを 1 枚の HTML にまとめる（どこかに置いて公開する用）
   実行: node bundle.cjs 出力先.html [--hosted]
   --hosted: ファイル保存が効かない場所（ページ埋め込み型のホスティング）向け。<html> などの外枠を省き、保存ボタンを出さない */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const out = process.argv[2], hosted = process.argv.includes('--hosted');
if (!out) { console.error('使いかた: node bundle.cjs 出力先.html [--hosted]'); process.exit(1); }

const page = read('index.html');
const body = /<body>([\s\S]*?)<script src=/.exec(page)[1].trim();
const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => {
  const src = read(m[1]);
  if (/<\/script/i.test(src)) throw new Error(m[1] + ' に </script が含まれています');
  return '<script>\n' + src + '</script>';
});
const title = hosted ? 'DOT 仮想携帯ゲーム機' : /<title>(.*?)<\/title>/.exec(page)[1];
const inner = '<title>' + title + '</title>\n<style>\n' + read('style.css') + '</style>\n\n' + body + '\n\n' +
  (hosted ? '<script>window.DOT_HOSTED = true;</script>\n' : '') + scripts.join('\n') + '\n';
fs.writeFileSync(out, hosted ? inner :
  '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n' + inner + '</body>\n</html>\n');
console.log(out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
