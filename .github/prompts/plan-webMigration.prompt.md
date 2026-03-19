## Plan: Web PoC 移行（2ブランチ運用）

PoC前提で、先にエラー整理ブランチで土台を安定化し、その後にWebモダン化ブランチで FastAPI + 分離フロントを進める方針です。
最終ドキュメントは docs/Web-Migration（新規）に集約する前提で組んでいます。

## Steps
1. ブランチ戦略を固定する
   ブランチA: refactor/errors-fix
   ブランチB: feature/web-modernization
   ブランチBはブランチA完了後に開始。
2. ブランチAで診断ノイズを除去する
   .venv を解析対象から外し、src配下のみを品質ゲート化。
3. ブランチAで例外とログを統一する
   GUI前提の stdout 依存を弱め、monitor未指定でも動くログ設計へ寄せる。
4. ブランチAで回帰確認を行う
   既存GUIの VRM→PMX 変換が維持されることを確認して確定。
5. ブランチBで GUI依存設定を外だしする
   Bone/Physics 設定を form層から切り離し、コア変換がGUI importしない構造にする。
6. ブランチBで FastAPI 最小APIを実装する
   POST /api/convert（同期返却）で VRM受信→変換→PMXバイナリ返却。
7. ブランチBでフロント分離PoCを実装する
   フロントは別起動で API を叩き、ダウンロード完了まで確認。
8. ブランチBで API契約を確定する
   400/500、CORS、サイズ上限、タイムアウトを明文化。
9. E2Eで成立判定する
   フロント→API→変換→ダウンロードを通しで確認し、GUI版との差分を評価。
10. docs/Web-Migration に移行ドキュメントを整備する
    目的、構成、API仕様、セットアップ、検証手順、トラブルシュートを配置。

## Relevant files
- src/service/Vrm2PmxExportService.py
- src/mmd/VrmReader.py
- src/form/worker/ExportWorkerThread.py
- src/form/panel/BonePanel.py
- src/form/panel/PhysicsPanel.py
- src/utils/MLogger.py
- src/utils/MException.py
- .vscode/settings.json

## Verification
1. ブランチA: src配下の診断で .venv 由来ノイズが出ない。
2. ブランチA: 既存GUIでVRM→PMXが従来通り成功する。
3. ブランチB: FastAPIローカル起動と /health 応答が通る。
4. ブランチB: /api/convert でPMXバイナリ返却が成功する。
5. ブランチB: フロントとバックを別プロセスで起動し、E2Eが通る。
6. docs/Web-Migration: 初見再現可能な手順になっている。

## Decisions
- 含む: PoCに必要な最小Web化（同期API返却）とフロント/バック分離実行。
- 含まない: 本番向けの認証、ジョブキュー、監視高度化、マルチテナント。
- ドキュメントは docs/Web-Migration に集約。

## Notes for refinement
- 初期フロントは Vite + React + TypeScript で管理し、成立確認を優先する。
- 必要に応じて HTML + Fetch の最小版を切り替え可能な予備案として維持する。
- 大きいVRM対応として、PoC段階でも最大ファイルサイズとタイムアウトを先に規定。
