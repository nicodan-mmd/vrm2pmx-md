# Rust Conversion Notes

This directory tracks the plan for introducing a Rust-based conversion path into vrm2pmx without replacing the current Python path upfront.

---

## 膝伸び問題 — 現状と残課題（2026-03-28 時点）

### 問題の症状

Rust モード（`pmxWriter.js`）で変換した PMX を MMD で使うと、膝が不自然に伸びる。
Python 版では再現しない。

### これまでの修正（v19〜v21）

| バージョン | 修正内容                                                                                              | 確認状態        |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| v19        | D-bone 作成・`deformRedirectMap`・`resolveVertexDeform` リダイレクト実装                              | ✅              |
| v20        | 重複ウエイト合算（Map ベース deduplication）                                                          | ✅              |
| v21        | D-bone `flags=282`（回転付与）・`effectIndex`・`effectFactor=1.0`・PMX シリアライザ付与データ書き出し | ✅ 属性確認済み |

v21 PMX を Python で直接読み込み確認：

```text
{'左足D': (282, 144, 1.0), '左ひざD': (282, 145, 1.0), '左足首D': (282, 146, 1.0)}
```

D-bone の付与属性は正しく出力されている。しかし膝伸びは未解消。

---

### ★ 未修正の根本原因（次の会話で対応すること）

#### 原因 1（最重要）：`腰キャンセル` 骨に rotation append が設定されていない

**Python の実装** (`src/mmd/VrmReader.py` L2555 付近):

```python
elif "腰キャンセル" in bone_name:
    pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0100   # = 258: 回転可 + 回転付与
    pmx.bones[bone_name].effect_index = pmx.bones["腰"].index  # 付与親 = 腰
    pmx.bones[bone_name].effect_factor = -1                    # 付与率 -1.0（打ち消し）
```

`腰キャンセル` は「腰ボーンの回転を -1.0 倍で打ち消す」特殊骨。
これにより `足D → ひざD → 足首D` の D-bone チェーンが腰の回転の影響を受けないようになっている。

**Rust の現状** (`frontend/public/rust/pmxWriter.js` `ensureWaistCancel` 関数):

```javascript
out.push({
  nameJp: cancelName,
  flags: 0x0002 | 0x0004, // = 6: 回転付与なし！
  // effectIndex / effectFactor なし
});
```

**必要な修正**:

```javascript
out.push({
  nameJp: cancelName,
  flags: 0x0002 | 0x0100, // = 258: 回転付与あり
  effectIndex: waistIndex, // 腰ボーンのインデックス
  effectFactor: -1.0, // 打ち消し
});
```

`waistIndex` はすでに同関数の前に `const waistIndex = nameToIndex.get("腰") ?? centerIndex;` として定義済み（L651 付近）。

---

#### 原因 2（副次的）：D-bone の変形階層 (layer) が 0 のまま

**Python**:

```python
pmx.bones[bone_name].layer = 1   # D-bone は layer=1
```

**Rust**:

```javascript
w.i32(0); // layer — 全骨が 0 固定（L1285 付近）
```

PMX フォーマットでは layer=1 の骨は layer=0 より後に変形計算される。
D-bone は付与元（`左ひざ` など）が計算された後に計算されるべきなので layer=1 が正しい。

**必要な修正 (2 箇所)**:

1. D-bone 作成時に `layer: 1` を追加:

```javascript
out.push({
  nameJp: def.dName,
  // ...
  layer: 1, // ← 追加
  effectIndex: srcIdx,
  effectFactor: 1.0,
});
```

2. PMX ボーン書き出し (`w.i32(0); // layer` の行) を変更:

```javascript
w.i32(typeof bone.layer === "number" ? bone.layer : 0);
```

---

### 修正対象ファイル

`frontend/public/rust/pmxWriter.js` の 3 箇所:

| #   | 箇所                       | 行 (目安) | 修正内容                                                                 |
| --- | -------------------------- | --------- | ------------------------------------------------------------------------ |
| 1   | `ensureWaistCancel` 関数内 | ~657      | `flags` を 6 → 258、`effectIndex: waistIndex`、`effectFactor: -1.0` 追加 |
| 2   | `addDeformBones` 関数内    | ~795      | D-bone push に `layer: 1` 追加                                           |
| 3   | PMX ボーン書き出しループ内 | ~1285     | `w.i32(0)` → `w.i32(typeof bone.layer === "number" ? bone.layer : 0)`    |

---

### 比較ツール・ファイル

- 比較スクリプト: `tmp/compare_pmx.py`
- Python v6 (正解): `D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\PMX_Convert\python\プロレスラー_リンリン6\プロレスラー_リンリン.pmx`
- Rust v21 (現行): `D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\PMX_Convert\rust\プロレスラー_リンリン21\プロレスラー_リンリン.pmx`
- 次回版は v22 として保存することを推奨

### ビルド手順

```bash
cd frontend
npm run build   # または Vite Dev で確認
```

---

## Goals

- Add an experimental Rust conversion mode behind an explicit frontend toggle.
- Keep the current Python/Wasm route intact as the safe fallback path.
- Stabilize the browser-facing input/output contract before porting heavy logic.
- Treat PMX Tailor v2 integration as a separate post-conversion stage.
- Avoid user-facing regressions while validating Rust quality and performance.

## Recommended Branch Flow

- Branch A: feature/rust-conversion-poc
- Branch B: feature/rust-wasm-core
- Branch C: feature/rust-worker-validation
- Branch D: feature/pmx-tailor-v2-postprocess

## Document Index

- 01-Roadmap.md: phases, milestones, and gates
- 02-Architecture.md: target architecture and boundaries
- 03-Browser-Contract.md: browser runtime input/output contract
- 04-Frontend-Vite.md: UI, worker, and toggle behavior
- 05-Test-Strategy.md: comparison and regression strategy
- 06-Local-Run.md: local development and verification flow
- 07_Risks-Diagnostics.md: risks, diagnostics, and rollback rules
- 08-Execution-Checklist.md: step-by-step implementation checklist
- 09-Phase0-Inventory.md: existing Python path inventory for port planning
- 10-PMX-Tailor-v2-Coordination.md: post-conversion integration boundary
- Comparisons/README.md: continuous comparison workflow and record format
- Comparisons/CHECKPOINTS.md: user verification checkpoints (3 times)

## Notes

- The initial Rust mode can ship as an experimental path with explicit fallback.
- The Rust checkbox is for validation only and can be hidden after stabilization.
- PMX Tailor v2 should be integrated after the Rust conversion contract is stable.
- Keep per-change comparison records under Comparisons/records for rollback and audit.

## User Verification Checkpoints

- Checkpoint 1: after stage 03 (contract and mode visibility are stable)
- Checkpoint 2: after stage 06 (local run flow and artifacts are stable)
- Checkpoint 3: after stage 09 (phase-0 inventory-based parity check is stable)
- At each checkpoint, notify the user to validate loadability with external applications.
