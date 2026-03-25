# Architecture

## 現状

- VRM1.0 読み込みは成立している。
- 変換ロジックは現行generic実装が主で、VRoid由来ロジックは未統合。
- frontend 側にモード切替ボタンは置かない方針。

## 目標

- 判定層で入力メタデータを判定し、Profileを自動選択する。
- 共通層に汎用処理を寄せ、Profile層は固有処理のみ担当する。
- 非VRoid VRM経路を既存互換として保護する。

## 論理構成

1. Detection Layer
- 役割: 入力メタデータから変換経路を判定する
- 入力: extensions, version, 追加ヒント
- 出力: profile種別（generic/vroid）と判定理由

2. Common Conversion Layer
- 役割: 共通処理（読込、画像展開、accessor、テクスチャ配置）
- 制約: ドメイン固有分岐を持ち込まない

3. Profile Layer
- GenericProfile: 既存VRM変換を保持
- VroidProfile: VRoid由来の固有変換を担当
- 制約: 分岐はprofile内に閉じる

4. Frontend Layer
- 役割: 変換開始、進捗表示、判定結果表示、失敗時案内
- 方針: ボタン追加なし、自動判定のみ

## 分離原則

- 判定ロジックは変換本体に埋め込まない。
- 共通層は I/O と汎用変換のみを扱う。
- Profile層の仕様変更が他層へ波及しない境界を保つ。

## 後方互換ガード

- 非VRoid VRMの既存成功ケースは常時回帰対象。
- 新機能追加時は先にgeneric回帰を通し、その後VRoid統合を行う。

## 想定実装ポイント

- src/mmd/VrmReader.py
- src/service/Vrm2PmxExportService.py
- src/config/default_pairs.py
- src/module/MOptions.py
- frontend/src/workers/convertWorker.ts
- frontend/src/App.tsx
