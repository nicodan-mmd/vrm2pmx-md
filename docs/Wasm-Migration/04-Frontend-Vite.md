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

## 最小 UI 機能

1. VRM ファイル選択
2. 変換オプション入力（最小）
3. 進捗バー表示
4. 変換結果ダウンロード
5. エラー再試行

## 注意点

- 初回ロード遅延を想定し、ローディング状態を明示する。
- 大容量ファイルでメモリ圧迫しやすいため、不要参照を早期解放する。
