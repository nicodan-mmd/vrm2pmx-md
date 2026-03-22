# Local Run Guide (Wasm Plan)

## Prerequisites

- Python 3.x（コア検証用）
- Node.js 22+
- npm

## 1. Python 側の最小確認

`bytes -> bytes` 変換 API を先にローカル Python で検証する。

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -q
```

必要に応じて変換コア専用テストを `src` 側へ追加する。

## 2. Frontend 開発起動

```powershell
cd frontend
npm install
npm run dev
```

Open:

- http://127.0.0.1:5173/

## 3. 動作確認フロー

1. `.vrm` ファイルを選択する。
2. `Convert and Download PMX` を押す。
3. Pyodide 初期化完了を待つ。
4. 進捗表示が更新され、ファイルがダウンロードされる。

## 4. GitHub Pages 公開確認

- Vite build 成果物を `dist` として出力する。
- リポジトリ名付き URL の場合は Vite `base` 設定を合わせる。
- 静的配信のみで変換が成立することを確認する。
