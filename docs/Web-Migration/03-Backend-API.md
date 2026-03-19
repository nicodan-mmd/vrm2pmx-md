# Backend API (PoC)

## Endpoint
POST /api/convert

## Request
- Content-Type: multipart/form-data
- vrm_file: VRM binary
- bone_config: optional JSON string
- physics_config: optional JSON string

## Response
- 200: application/zip (PMX + tex folder)
- 400: 入力不正
- 500: 変換失敗

## 実装メモ
- 一時ディレクトリに VRM を保存して変換する。
- 変換後の `result.pmx` と `tex/` を ZIP 化して返却する。
- まずは同期処理で実装し、必要時にジョブ化する。
