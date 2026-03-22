# Test Strategy

## 目的

- 変換品質を維持しつつ、実行基盤を FastAPI からブラウザ実行へ移す。

## Test Layer

1. Core Unit Test (Python)
- `bytes` 入出力 API の正常系
- 異常入力時の例外とメッセージ

2. Worker Contract Test (TS)
- `convertVrm` request/response の型整合
- progress event の順序と最終完了

3. Browser Integration Test
- ファイル入力からダウンロード開始まで
- 大きめ入力で UI がフリーズしないこと

4. Regression Test
- 同一入力に対する出力差分チェック
- 主要モデルのスモーク変換

## 最低限の合格条件

1. FastAPI なしで PMX ダウンロードが完了する。
2. 例外時に UI へエラーメッセージが表示される。
3. Worker 実行中も UI が操作不能にならない。
4. 既知サンプルで重大な変換劣化がない。

## 計測項目

- 初回ロード時間
- 変換時間（小/中/大モデル）
- ピークメモリ使用量（目視でも可）
