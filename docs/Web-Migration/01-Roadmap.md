# Roadmap

## Phase A: エラー整理

1. .venv を解析対象から除外して診断ノイズを削減する。
2. 例外処理とログ処理の責務を整理する。
3. GUI 変換の回帰確認を行う。

## Phase B: Web モダン化

1. GUI 依存設定を src/config に外だしする。
2. FastAPI で POST /api/convert を実装する。
3. Vite + React + TypeScript でフロントを分離実装する。
4. E2E でアップロードからPMXダウンロードまで確認する。

## Deliverables

- API サーバーをローカル起動できる。
- フロントを別プロセスで起動し、API 呼び出しが成功する。
- docs/Web-Migration の手順だけで再現可能。
