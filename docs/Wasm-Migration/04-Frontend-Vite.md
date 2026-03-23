# Frontend with Vite (Wasm Plan)

## 採用理由

- 既存 PoC と同じ技術スタックを維持できる。
- Worker と型管理を TypeScript で安全に扱える。
- GitHub Pages 公開手順を既存資産と統一できる。

## 追加する責務

1. Pyodide ローダ
- 初回ロードとキャッシュ制御

2. Conversion Worker
- Python 実行をメインスレッドから隔離

3. Download Manager
- PMX/ZIP の Blob 生成と保存

4. Error Presenter
- Python 例外をユーザー向け文言へ整形

## 推奨ディレクトリ

- `frontend/src/wasm/pyodideLoader.ts`
- `frontend/src/workers/convertWorker.ts`
- `frontend/src/services/convertClient.ts`
- `frontend/src/types/convert.ts`
- `frontend/scripts/sync_py_src.mjs`
- `frontend/public/py_src/*`

## 最小 UI 機能

1. VRM ファイル選択
2. 変換オプション入力（最小）
3. 進捗バー表示
4. 変換結果ダウンロード
5. エラー再試行

## 注意点

- 初回ロード遅延を想定し、ローディング状態を明示する。
- 大容量ファイルでメモリ圧迫しやすいため、不要参照を早期解放する。

## 実装メモ（2026-03-23）

- dev/build 時に `sync_py_src.mjs` で `src/{config,mmd,module,service,utils}` の Python ファイルを `frontend/public/py_src` へ同期する。
- Worker は `py_src_manifest.json` を読み込み、Pyodide FS 上へ配置してから `service.Vrm2PmxBytesService.convert_vrm_bytes` を呼び出す。

## 公開運用ポリシー（現行）

- 公開時の既定は Wasm モード（バックエンドフォールバック無効）。
- ローカル検証時のみ `VITE_ENABLE_BACKEND_FALLBACK=true` で backend を有効化する。
- 利用者増加後に失敗レポートが蓄積した段階で、backend 常設の必要性を再評価する。
