# Data Model Analysis

## 目的

- 自動判定に使うメタデータキーを明確化し、誤判定を防ぐ。
- VRM0.x / VRM1.0 / VRoid の差分を、変換実装に必要な観点で整理する。

## 判定対象メタデータ（候補）

1. extensions.VRM の有無
2. extensions.VRMC_vrm の有無
3. extensions.VRMC_springBone の有無
4. humanoid 関連情報の配置
5. expression / blendShape 関連情報の配置
6. ベンダー・生成ツール情報（存在する場合のみ補助的に使用）

## 判定順序（案）

1. VRMC_vrm が存在する場合は VRM1.x 系として扱う。
2. VRM が存在する場合は VRM0.x 系として扱う。
3. 追加メタデータで VRoid 系特徴を満たす場合のみ vroid profile 候補にする。
4. 判定不能時は安全側（generic もしくは停止）へフォールバックする。

## 変換観点での差分

1. Morph/Expression
- VRM0.x: blendShape 系中心
- VRM1.x: expression 系
- VRoid: 表情系マッピングに固有処理が必要

2. Bone Mapping
- 共通骨格を基準にしつつ、VRoid特有の補正処理を profile 内で適用

3. Physics
- springBone 相当情報の扱い差分があるため、共通層ではなく profile 側で吸収

4. Material/Texture
- 共通抽出は共通層、固有パラメータ解釈は profile 側で分離

## データ契約方針

- Detection Layer の返却値は「profile種別 + 判定理由 + フォールバック有無」に統一。
- Frontend には内部実装詳細を渡さず、ユーザー向けメッセージのみ提示。

## 未決定事項（Phase 0で確定）

1. 判定不能時の最終方針（generic固定 or 明示停止）
2. VRoid判定に使う補助キーの閾値
3. 回帰サンプルの最終採用セット
