# Browser Execution Contract (PoC)

## Entry Point

- Worker message: `convertVrm`

## Request

- `vrmBytes`: ArrayBuffer (required)
- `options`: object (optional)
  - `boneConfig`: object
  - `physicsConfig`: object
  - `morphConfig`: object

## Response

- success:
  - `status`: `ok`
  - `fileName`: `result.pmx` or `result.zip`
  - `mimeType`: `application/octet-stream` or `application/zip`
  - `data`: ArrayBuffer

- error:
  - `status`: `error`
  - `code`: string
  - `message`: string
  - `details`: optional object

## Progress Event

- event: `progress`
- payload:
  - `phase`: `init` | `parse` | `convert` | `package`
  - `percent`: number (0-100)
  - `message`: string

## 実装メモ

- Phase 2 は `result.pmx` 単体で開始する。
- Phase 3 で `result.zip` を追加する。
- Worker と UI 間は Transferable を使いコピーコストを下げる。
