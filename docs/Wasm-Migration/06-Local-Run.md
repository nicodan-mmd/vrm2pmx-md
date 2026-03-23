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

バックエンド自動フォールバックをローカルで有効化する場合:

```powershell
cd frontend
Copy-Item .env.example .env -Force
(Get-Content .env) -replace "VITE_ENABLE_BACKEND_FALLBACK=false", "VITE_ENABLE_BACKEND_FALLBACK=true" | Set-Content .env
npm run dev
```

Open:

- http://127.0.0.1:5173/

## 3. 動作確認フロー

1. `.vrm` ファイルを選択する。
2. `Convert and Download PMX` を押す。
3. Pyodide 初期化完了を待つ。
4. 進捗表示が更新され、`result.pmx` と `tex/*` を含む ZIP がダウンロードされる。

### 3.1 FastAPI なし確認（Wasm 単独）

1. FastAPI を起動しない（または停止する）。
2. `Test-NetConnection 127.0.0.1 -Port 8000` で `TcpTestSucceeded = False` を確認する。
3. `frontend/.env` で `VITE_ENABLE_BACKEND_FALLBACK=false` を確認する。
4. `npm run dev -- --host 127.0.0.1` で frontend を起動し、`http://127.0.0.1:5173/` を開く。
5. `Convert mode` が `Wasm` の状態で `.vrm` を変換する。
6. 期待結果:
	- 進捗表示が更新される
	- `*.zip` がダウンロードされ、その中に `result.pmx` と `tex/*` が含まれる
	- backend 接続エラーが表示されない

## 4. GitHub Pages 公開確認

- Vite build 成果物を `dist` として出力する。
- リポジトリ名付き URL の場合は Vite `base` 設定を合わせる。
- 静的配信のみで変換が成立することを確認する。
- 公開時は `VITE_ENABLE_BACKEND_FALLBACK=false` を維持する。
