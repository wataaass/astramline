# 次のアストラム PWA 完全版

4つのPDFから抽出した `astram_trips.csv` を同梱しています。

## 収録
- 平日 下り（広域公園前方面）
- 平日 上り（本通方面）
- 土曜休日 下り（広域公園前方面）
- 土曜休日 上り（本通方面）

収録列車数: 490本

## 起動
```bash
python3 -m http.server 8000
```
その後、ブラウザで `http://localhost:8000/astram_pwa_complete/` を開いてください。
