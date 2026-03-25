# VRoid-Migration

更新日: 2026-03-25

## 目的

- VRM1.0 読み込み済みの現状を前提に、変換品質の改善を中心に VRoid 由来ロジックを段階統合する。
- VRoid 専用化は行わず、非VRoidの既存VRM変換成功ケースを維持する。
- UI にモード切替ボタンは追加せず、ファイルメタデータで自動判定する。

## スコープ

- 対象: Python本体（src）、frontend
- 非対象: backend API、desktop GUI（wxPython）

## 完了条件（Definition of Done）

- 非VRoid VRM（既存成功サンプル）の変換結果が回帰しない。
- VRM1.0 / VRoid サンプルで変換が完走する。
- 自動判定（メタデータ判定）で変換経路を選択できる。
- 判定不能・失敗時のユーザー案内が明確で再試行可能である。
- 本ディレクトリの計画・検証・リスク文書が矛盾なく更新されている。

## ドキュメント一覧

1. 01-Roadmap.md: フェーズ計画と依存関係
2. 02-Architecture.md: 判定層/共通層/Profile層の責務
3. 03-Data-Model-Analysis.md: 判定キーとデータ差分
4. 04-Implementation-Plan.md: 実装手順と取り込み順序
5. 05-Test-Strategy.md: 回帰戦略と受け入れ判定
6. 06-Validation-Checklist.md: 実施チェック項目
7. 07-Risks-Mitigation.md: リスク・監視・ロールバック
8. 08-Phase0-Inventory.md: Phase 0 の棚卸し記録

## 合意済み制約

- 変換中心で進める（読込拡張は優先度を下げる）。
- 非VRoid互換維持を最優先ガードレールにする。
- ボタン追加ではなく自動判定を採用する。
