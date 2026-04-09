import std/[json, os, strutils, uri, tables, sets, sequtils, algorithm, math]
import glb_parser, accessor, pmx_writer_lite

type ConvertResultMeta {.bycopy.} = object
  outPtr*: uint32
  outLen*: int32
  status*: int32
  errorCode*: int32

const
  CONVERT_OK = int32(0)
  CONVERT_ERR_INVALID_ARG = int32(1001)
  CONVERT_ERR_PARSE = int32(1002)
  CONVERT_ERR_BUILD = int32(1003)
  CONVERT_ERR_ALLOC = int32(1004)

var gLastErrorMsg = ""

proc setError(meta: ptr ConvertResultMeta, errorCode: int32, message: string): int32 =
  gLastErrorMsg = message
  if meta != nil:
    meta[].outPtr = uint32(0)
    meta[].outLen = int32(0)
    meta[].status = int32(1)
    meta[].errorCode = errorCode
  return int32(1)

type Mat4d = array[16, float64]
type Vec3d = tuple[x, y, z: float64]

proc shouldDebugVertex(vertexIndex: int): bool =
  let raw = getEnv("VRM_DEBUG_VERTEX_INDICES", "")
  if raw.len == 0:
    return false
  for token in raw.split(','):
    let trimmed = token.strip()
    if trimmed.len == 0:
      continue
    try:
      if parseInt(trimmed) == vertexIndex:
        return true
    except ValueError:
      discard
  return false

proc hexF32(value: float32): string =
  "0x" & toHex(cast[uint32](value), 8)

proc hexF64(value: float64): string =
  "0x" & toHex(cast[uint64](value), 16)

proc debugBoneWeights(vertexIndex: int, stage: string, bones: seq[int32], weights: seq[float64]) =
  if not shouldDebugVertex(vertexIndex):
    return
  echo "[nim][vertex=", vertexIndex, "][", stage, "] count=", bones.len
  for i in 0 ..< min(bones.len, weights.len):
    echo "  [", i, "] bone=", bones[i], " weight64=", weights[i], " ", hexF64(weights[i]), " weight32=", weights[i].float32, " ", hexF32(weights[i].float32)

proc identityMat4d(): Mat4d =
  result = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
  ]

proc mulMat4d(a, b: Mat4d): Mat4d =
  # Column-major 4x4 multiplication: result = a @ b
  for c in 0 ..< 4:
    for r in 0 ..< 4:
      var s = 0.0
      for k in 0 ..< 4:
        s += a[k * 4 + r] * b[c * 4 + k]
      result[c * 4 + r] = s

proc mulMat4Vec4(m: Mat4d, v: array[4, float64]): array[4, float64] =
  for r in 0 ..< 4:
    result[r] =
      m[0 * 4 + r] * v[0] +
      m[1 * 4 + r] * v[1] +
      m[2 * 4 + r] * v[2] +
      m[3 * 4 + r] * v[3]

proc getNodeLocalMatrix(node: JsonNode): Mat4d =
  if node.hasKey("matrix") and node["matrix"].kind == JArray and node["matrix"].len == 16:
    for i in 0 ..< 16:
      result[i] = node["matrix"][i].getFloat(0.0)
    return

  let t =
    if node.hasKey("translation") and node["translation"].kind == JArray and node["translation"].len >= 3:
      [
        node["translation"][0].getFloat(0.0),
        node["translation"][1].getFloat(0.0),
        node["translation"][2].getFloat(0.0),
      ]
    else:
      [0.0, 0.0, 0.0]

  let s =
    if node.hasKey("scale") and node["scale"].kind == JArray and node["scale"].len >= 3:
      [
        node["scale"][0].getFloat(1.0),
        node["scale"][1].getFloat(1.0),
        node["scale"][2].getFloat(1.0),
      ]
    else:
      [1.0, 1.0, 1.0]

  let q =
    if node.hasKey("rotation") and node["rotation"].kind == JArray and node["rotation"].len >= 4:
      [
        node["rotation"][0].getFloat(0.0),
        node["rotation"][1].getFloat(0.0),
        node["rotation"][2].getFloat(0.0),
        node["rotation"][3].getFloat(1.0),
      ]
    else:
      [0.0, 0.0, 0.0, 1.0]

  let qx = q[0]
  let qy = q[1]
  let qz = q[2]
  let qw = q[3]

  let r00 = 1.0 - 2.0 * (qy * qy + qz * qz)
  let r01 = 2.0 * (qx * qy - qz * qw)
  let r02 = 2.0 * (qx * qz + qy * qw)
  let r10 = 2.0 * (qx * qy + qz * qw)
  let r11 = 1.0 - 2.0 * (qx * qx + qz * qz)
  let r12 = 2.0 * (qy * qz - qx * qw)
  let r20 = 2.0 * (qx * qz - qy * qw)
  let r21 = 2.0 * (qy * qz + qx * qw)
  let r22 = 1.0 - 2.0 * (qx * qx + qy * qy)

  result = identityMat4d()
  result[0 * 4 + 0] = r00 * s[0]
  result[0 * 4 + 1] = r10 * s[0]
  result[0 * 4 + 2] = r20 * s[0]
  result[1 * 4 + 0] = r01 * s[1]
  result[1 * 4 + 1] = r11 * s[1]
  result[1 * 4 + 2] = r21 * s[1]
  result[2 * 4 + 0] = r02 * s[2]
  result[2 * 4 + 1] = r12 * s[2]
  result[2 * 4 + 2] = r22 * s[2]
  result[3 * 4 + 0] = t[0]
  result[3 * 4 + 1] = t[1]
  result[3 * 4 + 2] = t[2]

proc buildNodeWorldMatrices(jsonData: JsonNode): seq[Mat4d] =
  if not jsonData.hasKey("nodes"):
    return @[]

  let nodes = jsonData["nodes"]
  var worldMats = newSeq[Mat4d](nodes.len)
  var localMats = newSeq[Mat4d](nodes.len)
  var parents = newSeq[int](nodes.len)
  var resolved = newSeq[bool](nodes.len)

  for i in 0 ..< nodes.len:
    parents[i] = -1
    localMats[i] = getNodeLocalMatrix(nodes[i])

  for parentIdx, node in nodes.elems:
    if node.hasKey("children") and node["children"].kind == JArray:
      for child in node["children"]:
        let childIdx = child.getInt(-1)
        if childIdx >= 0 and childIdx < parents.len:
          parents[childIdx] = parentIdx

  proc resolveWorld(nodeIdx: int): Mat4d =
    if resolved[nodeIdx]:
      return worldMats[nodeIdx]
    let p = parents[nodeIdx]
    if p >= 0:
      worldMats[nodeIdx] = mulMat4d(resolveWorld(p), localMats[nodeIdx])
    else:
      worldMats[nodeIdx] = localMats[nodeIdx]
    resolved[nodeIdx] = true
    return worldMats[nodeIdx]

  for i in 0 ..< nodes.len:
    discard resolveWorld(i)
  result = worldMats

proc buildNodeParents(jsonData: JsonNode): seq[int] =
  if not jsonData.hasKey("nodes"):
    return @[]
  let nodes = jsonData["nodes"]
  result = newSeq[int](nodes.len)
  for i in 0 ..< nodes.len:
    result[i] = -1
  for parentIdx, node in nodes.elems:
    if node.hasKey("children") and node["children"].kind == JArray:
      for child in node["children"]:
        let childIdx = child.getInt(-1)
        if childIdx >= 0 and childIdx < result.len:
          result[childIdx] = parentIdx

proc getSkinIndexForMesh(jsonData: JsonNode, meshIdx: int): int =
  if not jsonData.hasKey("nodes"):
    return -1
  for nd in jsonData["nodes"]:
    if nd.hasKey("mesh") and nd["mesh"].getInt(-1) == meshIdx and nd.hasKey("skin"):
      return nd["skin"].getInt(-1)
  return -1

proc getSkinInverseBindMatricesForMesh(jsonData: JsonNode, binData: openArray[uint8], meshIdx: int): seq[Matrix4x4] =
  let skinIdx = getSkinIndexForMesh(jsonData, meshIdx)
  if skinIdx < 0 or not jsonData.hasKey("skins") or skinIdx >= jsonData["skins"].len:
    return @[]
  let skin = jsonData["skins"][skinIdx]
  if not skin.hasKey("inverseBindMatrices"):
    return @[]
  let accessorIdx = skin["inverseBindMatrices"].getInt(-1)
  if accessorIdx < 0:
    return @[]
  return readAccessorMat4(jsonData, binData, accessorIdx)

proc applySkinningPose(
  position: Vector3D,
  joints: (int, int, int, int),
  weights: (float32, float32, float32, float32),
  skinJoints: seq[int],
  inverseBindMatrices: seq[Matrix4x4],
  nodeWorldMatrices: seq[Mat4d],
): Vec3d =
  if skinJoints.len == 0 or nodeWorldMatrices.len == 0:
    return (x: float64(position.x), y: float64(position.y), z: float64(position.z))

  let jArr = [joints[0], joints[1], joints[2], joints[3]]
  let wArr = [weights[0], weights[1], weights[2], weights[3]]
  let source = [float64(position.x), float64(position.y), float64(position.z), 1.0]

  var skinned = [0.0, 0.0, 0.0, 0.0]
  var totalWeight = 0.0

  for i in 0 .. 3:
    let weight = float64(wArr[i])
    let jidx = jArr[i]
    if weight <= 0.0:
      continue
    if jidx < 0 or jidx >= skinJoints.len:
      continue

    let skinJointNodeIdx = skinJoints[jidx]
    if skinJointNodeIdx < 0 or skinJointNodeIdx >= nodeWorldMatrices.len:
      continue

    var bindM = identityMat4d()
    if jidx < inverseBindMatrices.len:
      for k in 0 ..< 16:
        bindM[k] = float64(inverseBindMatrices[jidx][k])

    let v1 = mulMat4Vec4(bindM, source)
    let v2 = mulMat4Vec4(nodeWorldMatrices[skinJointNodeIdx], v1)
    skinned[0] += weight * v2[0]
    skinned[1] += weight * v2[1]
    skinned[2] += weight * v2[2]
    skinned[3] += weight * v2[3]
    totalWeight += weight


  if totalWeight <= 0.0:
    return (x: float64(position.x), y: float64(position.y), z: float64(position.z))
  return (
    x: skinned[0] / totalWeight,
    y: skinned[1] / totalWeight,
    z: skinned[2] / totalWeight,
  )

const MIKU_METER = 12.5'f32

# Standard bone parent/tail/flag tables (106 entries matching BONE_PAIRS order)
const BONE_PARENT_IDX: array[106, int32] = [
  int32(-1),  # 0 全ての親
  int32(0),   # 1 センター
  int32(1),   # 2 グルーブ
  int32(2),   # 3 腰
  int32(3),   # 4 下半身
  int32(3),   # 5 上半身
  int32(5),   # 6 上半身2
  int32(6),   # 7 首
  int32(7),   # 8 頭
  int32(8),   # 9 両目
  int32(8),   # 10 左目
  int32(8),   # 11 右目
  int32(6),   # 12 左胸
  int32(12),  # 13 左胸先
  int32(6),   # 14 右胸
  int32(14),  # 15 右胸先
  int32(6),   # 16 左肩P
  int32(16),  # 17 左肩
  int32(17),  # 18 左肩C
  int32(18),  # 19 左腕
  int32(19),  # 20 左腕捩
  int32(19),  # 21 左腕捩1
  int32(19),  # 22 左腕捩2
  int32(19),  # 23 左腕捩3
  int32(20),  # 24 左ひじ
  int32(24),  # 25 左手捩
  int32(24),  # 26 左手捩1
  int32(24),  # 27 左手捩2
  int32(24),  # 28 左手捩3
  int32(25),  # 29 左手首
  int32(29),  # 30 左親指０
  int32(30),  # 31 左親指１
  int32(31),  # 32 左親指２
  int32(32),  # 33 左親指先
  int32(29),  # 34 左人指１
  int32(34),  # 35 左人指２
  int32(35),  # 36 左人指３
  int32(36),  # 37 左人指先
  int32(29),  # 38 左中指１
  int32(38),  # 39 左中指２
  int32(39),  # 40 左中指３
  int32(40),  # 41 左中指先
  int32(29),  # 42 左薬指１
  int32(42),  # 43 左薬指２
  int32(43),  # 44 左薬指３
  int32(44),  # 45 左薬指先
  int32(29),  # 46 左小指１
  int32(46),  # 47 左小指２
  int32(47),  # 48 左小指３
  int32(48),  # 49 左小指先
  int32(6),   # 50 右肩P
  int32(50),  # 51 右肩
  int32(51),  # 52 右肩C
  int32(52),  # 53 右腕
  int32(53),  # 54 右腕捩
  int32(53),  # 55 右腕捩1
  int32(53),  # 56 右腕捩2
  int32(53),  # 57 右腕捩3
  int32(54),  # 58 右ひじ
  int32(58),  # 59 右手捩
  int32(58),  # 60 右手捩1
  int32(58),  # 61 右手捩2
  int32(58),  # 62 右手捩3
  int32(59),  # 63 右手首
  int32(63),  # 64 右親指０
  int32(64),  # 65 右親指１
  int32(65),  # 66 右親指２
  int32(66),  # 67 右親指先
  int32(63),  # 68 右人指１
  int32(68),  # 69 右人指２
  int32(69),  # 70 右人指３
  int32(70),  # 71 右人指先
  int32(63),  # 72 右中指１
  int32(72),  # 73 右中指２
  int32(73),  # 74 右中指３
  int32(74),  # 75 右中指先
  int32(63),  # 76 右薬指１
  int32(76),  # 77 右薬指２
  int32(77),  # 78 右薬指３
  int32(78),  # 79 右薬指先
  int32(63),  # 80 右小指１
  int32(80),  # 81 右小指２
  int32(81),  # 82 右小指３
  int32(82),  # 83 右小指先
  int32(4),   # 84 腰キャンセル左
  int32(84),  # 85 左足
  int32(85),  # 86 左ひざ
  int32(86),  # 87 左足首
  int32(87),  # 88 左つま先
  int32(0),   # 89 左足ＩＫ
  int32(89),  # 90 左つま先ＩＫ
  int32(4),   # 91 腰キャンセル右
  int32(91),  # 92 右足
  int32(92),  # 93 右ひざ
  int32(93),  # 94 右足首
  int32(94),  # 95 右つま先
  int32(0),   # 96 右足ＩＫ
  int32(96),  # 97 右つま先ＩＫ
  int32(84),  # 98 左足D
  int32(98),  # 99 左ひざD
  int32(99),  # 100 左足首D
  int32(100), # 101 左足先EX
  int32(91),  # 102 右足D
  int32(102), # 103 右ひざD
  int32(103), # 104 右足首D
  int32(104), # 105 右足先EX
]

const BONE_TAIL_IDX: array[106, int32] = [
  int32(1),   # 0 全ての親→センター
  int32(-1),  # 1 センター (tail_pos mode; handled specially)
  int32(-1),  # 2 グルーブ (tail_pos mode; handled specially)
  int32(-1),  # 3 腰
  int32(-1),  # 4 下半身
  int32(6),   # 5 上半身→上半身2
  int32(7),   # 6 上半身2→首
  int32(8),   # 7 首→頭
  int32(-1),  # 8 頭
  int32(-1),  # 9 両目
  int32(-1),  # 10 左目
  int32(-1),  # 11 右目
  int32(13),  # 12 左胸→左胸先
  int32(-1),  # 13 左胸先
  int32(15),  # 14 右胸→右胸先
  int32(-1),  # 15 右胸先
  int32(-1),  # 16 左肩P (tail_pos mode)
  int32(19),  # 17 左肩→左腕
  int32(-1),  # 18 左肩C (tail_pos mode)
  int32(24),  # 19 左腕→左ひじ
  int32(-1),  # 20 左腕捩
  int32(-1),  # 21 左腕捩1
  int32(-1),  # 22 左腕捩2
  int32(-1),  # 23 左腕捩3
  int32(29),  # 24 左ひじ→左手首
  int32(-1),  # 25 左手捩
  int32(-1),  # 26 左手捩1
  int32(-1),  # 27 左手捩2
  int32(-1),  # 28 左手捩3
  int32(-1),  # 29 左手首
  int32(31),  # 30 左親指０→左親指１
  int32(32),  # 31 左親指１→左親指２
  int32(33),  # 32 左親指２→左親指先
  int32(-1),  # 33 左親指先
  int32(35),  # 34 左人指１→左人指２
  int32(36),  # 35 左人指２→左人指３
  int32(37),  # 36 左人指３→左人指先
  int32(-1),  # 37 左人指先
  int32(39),  # 38 左中指１→左中指２
  int32(40),  # 39 左中指２→左中指３
  int32(41),  # 40 左中指３→左中指先
  int32(-1),  # 41 左中指先
  int32(43),  # 42 左薬指１→左薬指２
  int32(44),  # 43 左薬指２→左薬指３
  int32(45),  # 44 左薬指３→左薬指先
  int32(-1),  # 45 左薬指先
  int32(47),  # 46 左小指１→左小指２
  int32(48),  # 47 左小指２→左小指３
  int32(49),  # 48 左小指３→左小指先
  int32(-1),  # 49 左小指先
  int32(-1),  # 50 右肩P (tail_pos mode)
  int32(53),  # 51 右肩→右腕
  int32(-1),  # 52 右肩C (tail_pos mode)
  int32(58),  # 53 右腕→右ひじ
  int32(-1),  # 54 右腕捩
  int32(-1),  # 55 右腕捩1
  int32(-1),  # 56 右腕捩2
  int32(-1),  # 57 右腕捩3
  int32(63),  # 58 右ひじ→右手首
  int32(-1),  # 59 右手捩
  int32(-1),  # 60 右手捩1
  int32(-1),  # 61 右手捩2
  int32(-1),  # 62 右手捩3
  int32(-1),  # 63 右手首
  int32(65),  # 64 右親指０→右親指１
  int32(66),  # 65 右親指１→右親指２
  int32(67),  # 66 右親指２→右親指先
  int32(-1),  # 67 右親指先
  int32(69),  # 68 右人指１→右人指２
  int32(70),  # 69 右人指２→右人指３
  int32(71),  # 70 右人指３→右人指先
  int32(-1),  # 71 右人指先
  int32(73),  # 72 右中指１→右中指２
  int32(74),  # 73 右中指２→右中指３
  int32(75),  # 74 右中指３→右中指先
  int32(-1),  # 75 右中指先
  int32(77),  # 76 右薬指１→右薬指２
  int32(78),  # 77 右薬指２→右薬指３
  int32(79),  # 78 右薬指３→右薬指先
  int32(-1),  # 79 右薬指先
  int32(81),  # 80 右小指１→右小指２
  int32(82),  # 81 右小指２→右小指３
  int32(83),  # 82 右小指３→右小指先
  int32(-1),  # 83 右小指先
  int32(-1),  # 84 腰キャンセル左
  int32(86),  # 85 左足→左ひざ
  int32(87),  # 86 左ひざ→左足首
  int32(88),  # 87 左足首→左つま先
  int32(-1),  # 88 左つま先
  int32(-1),  # 89 左足ＩＫ
  int32(-1),  # 90 左つま先ＩＫ
  int32(-1),  # 91 腰キャンセル右
  int32(93),  # 92 右足→右ひざ
  int32(94),  # 93 右ひざ→右足首
  int32(95),  # 94 右足首→右つま先
  int32(-1),  # 95 右つま先
  int32(-1),  # 96 右足ＩＫ
  int32(-1),  # 97 右つま先ＩＫ
  int32(-1),  # 98 左足D
  int32(-1),  # 99 左ひざD
  int32(-1),  # 100 左足首D
  int32(-1),  # 101 左足先EX
  int32(-1),  # 102 右足D
  int32(-1),  # 103 右ひざD
  int32(-1),  # 104 右足首D
  int32(-1),  # 105 右足先EX
]

const BONE_DEFAULT_FLAG: array[106, int16] = [
  int16(0x001f),  # 0 全ての親
  int16(0),       # 1 センター (special; set in buildModel)
  int16(0),       # 2 グルーブ (special; set in buildModel)
  int16(0x001b),  # 3 腰
  int16(0x001b),  # 4 下半身
  int16(0x001b),  # 5 上半身
  int16(0x001b),  # 6 上半身2
  int16(0x001b),  # 7 首
  int16(0x001b),  # 8 頭
  int16(0x001b),  # 9 両目
  int16(0x001b),  # 10 左目
  int16(0x001b),  # 11 右目
  int16(0x001b),  # 12 左胸
  int16(0x0003),  # 13 左胸先
  int16(0x001b),  # 14 右胸
  int16(0x0003),  # 15 右胸先
  int16(0x001a),  # 16 左肩P (tail_pos mode)
  int16(0x001b),  # 17 左肩
  int16(0x0102),  # 18 左肩C (append rotation)
  int16(0x001b),  # 19 左腕
  int16(0x001b),  # 20 左腕捩
  int16(0x001b),  # 21 左腕捩1
  int16(0x001b),  # 22 左腕捩2
  int16(0x001b),  # 23 左腕捩3
  int16(0x001b),  # 24 左ひじ
  int16(0x001b),  # 25 左手捩
  int16(0x001b),  # 26 左手捩1
  int16(0x001b),  # 27 左手捩2
  int16(0x001b),  # 28 左手捩3
  int16(0x001b),  # 29 左手首
  int16(0x001b),  # 30 左親指０
  int16(0x001b),  # 31 左親指１
  int16(0x001b),  # 32 左親指２
  int16(0x0003),  # 33 左親指先
  int16(0x001b),  # 34 左人指１
  int16(0x001b),  # 35 左人指２
  int16(0x001b),  # 36 左人指３
  int16(0x0003),  # 37 左人指先
  int16(0x001b),  # 38 左中指１
  int16(0x001b),  # 39 左中指２
  int16(0x001b),  # 40 左中指３
  int16(0x0003),  # 41 左中指先
  int16(0x001b),  # 42 左薬指１
  int16(0x001b),  # 43 左薬指２
  int16(0x001b),  # 44 左薬指３
  int16(0x0003),  # 45 左薬指先
  int16(0x001b),  # 46 左小指１
  int16(0x001b),  # 47 左小指２
  int16(0x001b),  # 48 左小指３
  int16(0x0003),  # 49 左小指先
  int16(0x001a),  # 50 右肩P (tail_pos mode)
  int16(0x001b),  # 51 右肩
  int16(0x0102),  # 52 右肩C (append rotation)
  int16(0x001b),  # 53 右腕
  int16(0x001b),  # 54 右腕捩
  int16(0x001b),  # 55 右腕捩1
  int16(0x001b),  # 56 右腕捩2
  int16(0x001b),  # 57 右腕捩3
  int16(0x001b),  # 58 右ひじ
  int16(0x001b),  # 59 右手捩
  int16(0x001b),  # 60 右手捩1
  int16(0x001b),  # 61 右手捩2
  int16(0x001b),  # 62 右手捩3
  int16(0x001b),  # 63 右手首
  int16(0x001b),  # 64 右親指０
  int16(0x001b),  # 65 右親指１
  int16(0x001b),  # 66 右親指２
  int16(0x0003),  # 67 右親指先
  int16(0x001b),  # 68 右人指１
  int16(0x001b),  # 69 右人指２
  int16(0x001b),  # 70 右人指３
  int16(0x0003),  # 71 右人指先
  int16(0x001b),  # 72 右中指１
  int16(0x001b),  # 73 右中指２
  int16(0x001b),  # 74 右中指３
  int16(0x0003),  # 75 右中指先
  int16(0x001b),  # 76 右薬指１
  int16(0x001b),  # 77 右薬指２
  int16(0x001b),  # 78 右薬指３
  int16(0x0003),  # 79 右薬指先
  int16(0x001b),  # 80 右小指１
  int16(0x001b),  # 81 右小指２
  int16(0x001b),  # 82 右小指３
  int16(0x0003),  # 83 右小指先
  int16(0x001b),  # 84 腰キャンセル左
  int16(0x001b),  # 85 左足
  int16(0x001b),  # 86 左ひざ
  int16(0x001b),  # 87 左足首
  int16(0x0003),  # 88 左つま先
  int16(0x001b),  # 89 左足ＩＫ
  int16(0x001b),  # 90 左つま先ＩＫ
  int16(0x001b),  # 91 腰キャンセル右
  int16(0x001b),  # 92 右足
  int16(0x001b),  # 93 右ひざ
  int16(0x001b),  # 94 右足首
  int16(0x0003),  # 95 右つま先
  int16(0x001b),  # 96 右足ＩＫ
  int16(0x001b),  # 97 右つま先ＩＫ
  int16(0x001b),  # 98 左足D
  int16(0x001b),  # 99 左ひざD
  int16(0x001b),  # 100 左足首D
  int16(0x001b),  # 101 左足先EX
  int16(0x001b),  # 102 右足D
  int16(0x001b),  # 103 右ひざD
  int16(0x001b),  # 104 右足首D
  int16(0x001b),  # 105 右足先EX
]

# BONE_PAIRS: English node name -> PMX bone index (order matches Python's config/default_pairs.py)
const BONE_PAIRS_EN = [
  "Root", "Center", "Groove", "J_Bip_C_Hips", "J_Bip_C_Spine",
  "J_Bip_C_Chest", "J_Bip_C_UpperChest", "J_Bip_C_Neck", "J_Bip_C_Head", "J_Adj_FaceEye",
  "J_Adj_L_FaceEye", "J_Adj_R_FaceEye", "J_Sec_L_Bust1", "J_Sec_L_Bust2", "J_Sec_R_Bust1",
  "J_Sec_R_Bust2", "shoulderP_L", "J_Bip_L_Shoulder", "shoulderC_L", "J_Bip_L_UpperArm",
  "arm_twist_L", "arm_twist_L1", "arm_twist_L2", "arm_twist_L3", "J_Bip_L_LowerArm",
  "wrist_twist_L", "wrist_twist_L1", "wrist_twist_L2", "wrist_twist_L3", "J_Bip_L_Hand",
  "J_Bip_L_Thumb1", "J_Bip_L_Thumb2", "J_Bip_L_Thumb3", "J_Bip_L_Thumb3_end", "J_Bip_L_Index1",
  "J_Bip_L_Index2", "J_Bip_L_Index3", "J_Bip_L_Index3_end", "J_Bip_L_Middle1", "J_Bip_L_Middle2",
  "J_Bip_L_Middle3", "J_Bip_L_Middle3_end", "J_Bip_L_Ring1", "J_Bip_L_Ring2", "J_Bip_L_Ring3",
  "J_Bip_L_Ring3_end", "J_Bip_L_Little1", "J_Bip_L_Little2", "J_Bip_L_Little3", "J_Bip_L_Little3_end",
  "shoulderP_R", "J_Bip_R_Shoulder", "shoulderC_R", "J_Bip_R_UpperArm", "arm_twist_R",
  "arm_twist_R1", "arm_twist_R2", "arm_twist_R3", "J_Bip_R_LowerArm", "wrist_twist_R",
  "wrist_twist_R1", "wrist_twist_R2", "wrist_twist_R3", "J_Bip_R_Hand", "J_Bip_R_Thumb1",
  "J_Bip_R_Thumb2", "J_Bip_R_Thumb3", "J_Bip_R_Thumb3_end", "J_Bip_R_Index1", "J_Bip_R_Index2",
  "J_Bip_R_Index3", "J_Bip_R_Index3_end", "J_Bip_R_Middle1", "J_Bip_R_Middle2", "J_Bip_R_Middle3",
  "J_Bip_R_Middle3_end", "J_Bip_R_Ring1", "J_Bip_R_Ring2", "J_Bip_R_Ring3", "J_Bip_R_Ring3_end",
  "J_Bip_R_Little1", "J_Bip_R_Little2", "J_Bip_R_Little3", "J_Bip_R_Little3_end", "leftWaistCancel",
  "J_Bip_L_UpperLeg", "J_Bip_L_LowerLeg", "J_Bip_L_Foot", "J_Bip_L_ToeBase_end", "leg_IK_L",
  "toe_IK_L", "rightWaistCancel", "J_Bip_R_UpperLeg", "J_Bip_R_LowerLeg", "J_Bip_R_Foot",
  "J_Bip_R_ToeBase_end", "leg_IK_R", "toe_IK_R", "leg_LD", "knee_LD",
  "ankle_LD", "J_Bip_L_ToeBase", "leg_RD", "knee_RD", "ankle_RD",
  "J_Bip_R_ToeBase"
]

const BONE_PAIRS_JA = [
  "全ての親", "センター", "グルーブ", "腰", "下半身",
  "上半身", "上半身2", "首", "頭", "両目",
  "左目", "右目", "左胸", "左胸先", "右胸",
  "右胸先", "左肩P", "左肩", "左肩C", "左腕",
  "左腕捩", "左腕捩1", "左腕捩2", "左腕捩3", "左ひじ",
  "左手捩", "左手捩1", "左手捩2", "左手捩3", "左手首",
  "左親指０", "左親指１", "左親指２", "左親指先", "左人指１",
  "左人指２", "左人指３", "左人指先", "左中指１", "左中指２",
  "左中指３", "左中指先", "左薬指１", "左薬指２", "左薬指３",
  "左薬指先", "左小指１", "左小指２", "左小指３", "左小指先",
  "右肩P", "右肩", "右肩C", "右腕", "右腕捩",
  "右腕捩1", "右腕捩2", "右腕捩3", "右ひじ", "右手捩",
  "右手捩1", "右手捩2", "右手捩3", "右手首", "右親指０",
  "右親指１", "右親指２", "右親指先", "右人指１", "右人指２",
  "右人指３", "右人指先", "右中指１", "右中指２", "右中指３",
  "右中指先", "右薬指１", "右薬指２", "右薬指３", "右薬指先",
  "右小指１", "右小指２", "右小指３", "右小指先", "腰キャンセル左",
  "左足", "左ひざ", "左足首", "左つま先", "左足ＩＫ",
  "左つま先ＩＫ", "腰キャンセル右", "右足", "右ひざ", "右足首",
  "右つま先", "右足ＩＫ", "右つま先ＩＫ", "左足D", "左ひざD",
  "左足首D", "左足先EX", "右足D", "右ひざD", "右足首D",
  "右足先EX"
]

proc buildBonePairsLookup(): Table[string, int] =
  for i, name in BONE_PAIRS_EN:
    result[name] = i

proc buildNodeToPmxBoneIndex(jsonData: JsonNode, bonePairsLookup: Table[string, int]): Table[int, int32] =
  ## Maps GLB node index -> PMX bone index.
  ## BONE_PAIRS nodes get indices 0..105 (from BONE_PAIRS_EN order).
  ## Non-BONE_PAIRS nodes get indices starting from len(BONE_PAIRS_EN).
  if not jsonData.hasKey("nodes"):
    return
  let nodes = jsonData["nodes"]

  # DFS traversal to find ordered list of non-BONE_PAIRS nodes
  var nonBpNodes: seq[int] = @[]
  var visited = newSeq[bool](nodes.len)

  proc dfsVisit(idx: int) =
    if idx < 0 or idx >= nodes.len or visited[idx]:
      return
    visited[idx] = true
    let nd = nodes[idx]
    let name = if nd.hasKey("name"): nd["name"].getStr("") else: ""
    if name notin bonePairsLookup:
      nonBpNodes.add(idx)
    if nd.hasKey("children"):
      for child in nd["children"]:
        dfsVisit(child.getInt(-1))

  for i in 0 ..< nodes.len:
    dfsVisit(i)

  # Assign BONE_PAIRS indices
  for nidx in 0 ..< nodes.len:
    let nd = nodes[nidx]
    let name = if nd.hasKey("name"): nd["name"].getStr("") else: ""
    if name in bonePairsLookup:
      result[nidx] = int32(bonePairsLookup[name])

  # Assign non-BONE_PAIRS indices starting from BONE_PAIRS_EN.len
  let baseIdx = BONE_PAIRS_EN.len
  for i, nidx in nonBpNodes:
    result[nidx] = int32(baseIdx + i)

proc estimateBoneCountHint(nodeToBoneIdx: Table[int, int32]): int =
  var maxBoneIdx = -1
  for _, boneIdx in nodeToBoneIdx:
    if boneIdx.int > maxBoneIdx:
      maxBoneIdx = boneIdx.int
  return maxBoneIdx + 1

proc signf(value: float32): int =
  if value > 0'f32:
    return 1
  if value < 0'f32:
    return -1
  return 0

proc signf(value: float64): int =
  if value > 0.0:
    return 1
  if value < 0.0:
    return -1
  return 0

proc vecSub(a, b: Vec3f): Vec3f =
  Vec3f(
    x: float32(float64(a.x) - float64(b.x)),
    y: float32(float64(a.y) - float64(b.y)),
    z: float32(float64(a.z) - float64(b.z)),
  )

proc vecAdd(a, b: Vec3f): Vec3f =
  Vec3f(
    x: float32(float64(a.x) + float64(b.x)),
    y: float32(float64(a.y) + float64(b.y)),
    z: float32(float64(a.z) + float64(b.z)),
  )

proc vecScale(a: Vec3f, s: float32): Vec3f =
  Vec3f(
    x: float32(float64(a.x) * float64(s)),
    y: float32(float64(a.y) * float64(s)),
    z: float32(float64(a.z) * float64(s)),
  )

proc vecLen(a: Vec3f): float32 =
  float32(sqrt(float64(a.x) * float64(a.x) + float64(a.y) * float64(a.y) + float64(a.z) * float64(a.z)))

proc vecNormalize(a: Vec3f): Vec3f =
  let l64 = sqrt(float64(a.x) * float64(a.x) + float64(a.y) * float64(a.y) + float64(a.z) * float64(a.z))
  if l64 <= 1.0e-8:
    return Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
  Vec3f(
    x: float32(float64(a.x) / l64),
    y: float32(float64(a.y) / l64),
    z: float32(float64(a.z) / l64),
  )

proc vecCross(a, b: Vec3f): Vec3f =
  Vec3f(
    x: float32(float64(a.y) * float64(b.z) - float64(a.z) * float64(b.y)),
    y: float32(float64(a.z) * float64(b.x) - float64(a.x) * float64(b.z)),
    z: float32(float64(a.x) * float64(b.y) - float64(a.y) * float64(b.x)),
  )

proc vec3dToVec3f(v: Vec3d): Vec3f =
  Vec3f(x: float32(v.x), y: float32(v.y), z: float32(v.z))

proc vecSubD(a, b: Vec3d): Vec3d =
  (x: a.x - b.x, y: a.y - b.y, z: a.z - b.z)

proc vecAddD(a, b: Vec3d): Vec3d =
  (x: a.x + b.x, y: a.y + b.y, z: a.z + b.z)

proc vecScaleD(a: Vec3d, s: float64): Vec3d =
  (x: a.x * s, y: a.y * s, z: a.z * s)

proc vecNormD(a: Vec3d): Vec3d =
  let l = sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  if l <= 1.0e-12:
    return (x: 0.0, y: 0.0, z: 0.0)
  (x: a.x / l, y: a.y / l, z: a.z / l)

proc vecCrossD(a, b: Vec3d): Vec3d =
  (
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  )

type QuatD = object
  w, x, y, z: float64

proc vecToD(v: Vec3f): Vec3d =
  (x: float64(v.x), y: float64(v.y), z: float64(v.z))

proc vecDotD(a, b: Vec3d): float64 =
  a.x * b.x + a.y * b.y + a.z * b.z

proc vecLenD(a: Vec3d): float64 =
  sqrt(vecDotD(a, a))

proc vecAbs(v: Vec3f): Vec3f =
  Vec3f(x: abs(v.x), y: abs(v.y), z: abs(v.z))

proc vecMul(v: Vec3f, s: float32): Vec3f =
  Vec3f(x: v.x * s, y: v.y * s, z: v.z * s)

proc vecMid(a, b: Vec3f): Vec3f =
  Vec3f(
    x: float32((float64(a.x) + float64(b.x)) * 0.5),
    y: float32((float64(a.y) + float64(b.y)) * 0.5),
    z: float32((float64(a.z) + float64(b.z)) * 0.5),
  )

proc maxComponent(v: Vec3f): float32 =
  max(v.x, max(v.y, v.z))

proc argmaxAbs(v: Vec3f): int =
  let ax = abs(v.x)
  let ay = abs(v.y)
  let az = abs(v.z)
  if ax >= ay and ax >= az:
    return 0
  if ay >= az:
    return 1
  return 2

proc medianValue(values: seq[float32]): float32 =
  if values.len == 0:
    return 0'f32
  var sortedValues = values
  sort(sortedValues)
  let mid = sortedValues.len div 2
  if (sortedValues.len mod 2) == 1:
    return sortedValues[mid]
  return (sortedValues[mid - 1] + sortedValues[mid]) * 0.5'f32

proc medianValueD(values: seq[float64]): float64 =
  if values.len == 0:
    return 0.0
  var sortedValues = values
  sort(sortedValues)
  let mid = sortedValues.len div 2
  if (sortedValues.len mod 2) == 1:
    return sortedValues[mid]
  return (sortedValues[mid - 1] + sortedValues[mid]) * 0.5

proc vecAbsD(v: Vec3d): Vec3d =
  (x: abs(v.x), y: abs(v.y), z: abs(v.z))

proc vecMidD(a, b: Vec3d): Vec3d =
  (x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5)

proc argmaxAbsD(v: Vec3d): int =
  let ax = abs(v.x)
  let ay = abs(v.y)
  let az = abs(v.z)
  if ax >= ay and ax >= az:
    return 0
  if ay >= az:
    return 1
  return 2

proc quatNormalize(q: QuatD): QuatD =
  let l = sqrt(q.w*q.w + q.x*q.x + q.y*q.y + q.z*q.z)
  if l <= 1.0e-12:
    return QuatD(w: 1.0, x: 0.0, y: 0.0, z: 0.0)
  QuatD(w: q.w/l, x: q.x/l, y: q.y/l, z: q.z/l)

proc quatMul(a, b: QuatD): QuatD =
  QuatD(
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  )

proc quatRotationTo(fromVec, toVec: Vec3d): QuatD =
  let f = vecNormD(fromVec)
  let t = vecNormD(toVec)
  let d = vecDotD(f, t)
  if d >= 1.0 - 1.0e-10:
    return QuatD(w: 1.0, x: 0.0, y: 0.0, z: 0.0)
  if d <= -1.0 + 1.0e-10:
    var axis = vecCrossD((x: 1.0, y: 0.0, z: 0.0), f)
    if vecLenD(axis) <= 1.0e-10:
      axis = vecCrossD((x: 0.0, y: 1.0, z: 0.0), f)
    axis = vecNormD(axis)
    return QuatD(w: 0.0, x: axis.x, y: axis.y, z: axis.z)
  let c = vecCrossD(f, t)
  let s = sqrt((1.0 + d) * 2.0)
  let invS = 1.0 / s
  quatNormalize(QuatD(w: s * 0.5, x: c.x * invS, y: c.y * invS, z: c.z * invS))

proc quatToEulerRad(qIn: QuatD): Vec3f =
  let q = quatNormalize(qIn)
  let xp = q.x
  let yp = q.y
  let zp = q.z
  let wp = q.w

  var xx = xp * xp
  var xy = xp * yp
  var xz = xp * zp
  var xw = xp * wp
  var yy = yp * yp
  var yz = yp * zp
  var yw = yp * wp
  var zz = zp * zp
  var zw = zp * wp
  let lengthSquared = xx + yy + zz + wp * wp

  if abs(lengthSquared - 1.0) > 1.0e-12 and abs(lengthSquared) > 1.0e-12:
    xx /= lengthSquared
    xy /= lengthSquared
    xz /= lengthSquared
    xw /= lengthSquared
    yy /= lengthSquared
    yz /= lengthSquared
    yw /= lengthSquared
    zz /= lengthSquared
    zw /= lengthSquared

  let pitch = arcsin(max(-1.0, min(1.0, -2.0 * (yz - xw))))
  var yaw = 0.0
  var roll = 0.0

  if pitch < (PI / 2.0):
    if pitch > -(PI / 2.0):
      yaw = arctan2(2.0 * (xz + yw), 1.0 - 2.0 * (xx + yy))
      roll = arctan2(2.0 * (xy + zw), 1.0 - 2.0 * (xx + zz))
    else:
      roll = 0.0
      yaw = -arctan2(-2.0 * (xy - zw), 1.0 - 2.0 * (yy + zz))
  else:
    roll = 0.0
    yaw = arctan2(-2.0 * (xy - zw), 1.0 - 2.0 * (yy + zz))

  Vec3f(x: pitch.float32, y: yaw.float32, z: roll.float32)

proc vertexBoneIdxList(v: PmxVertexLite, threshold: float32): seq[int32] =
  case v.deform.kind
  of 0:
    result.add(v.deform.bones[0])
  of 1:
    if v.deform.weights[0] >= threshold:
      result.add(v.deform.bones[0])
    if 1.0'f32 - v.deform.weights[0] >= threshold:
      result.add(v.deform.bones[1])
  of 2:
    for wi in 0..3:
      if v.deform.weights[wi] >= threshold:
        result.add(v.deform.bones[wi])
  else:
    discard

proc computeRigidbodyGeometry(
  model: PmxModelLite,
  boneIndexByName: Table[string, int32],
  boneVertices: Table[int32, seq[int]],
  boneIdx: int32,
  shapeType: int8,
  rigidbodyFactor: float32,
  isBody: bool,
): tuple[shapeSize, shapePos, shapeRot: Vec3f] =
  let bone = model.bones[int(boneIdx)]
  template preciseBonePos(idx: int32): Vec3d =
    (if idx >= 0 and idx < model.preciseBonePositions.len.int32 and idx < model.hasPreciseBonePositions.len.int32 and model.hasPreciseBonePositions[int(idx)]:
      let p = model.preciseBonePositions[int(idx)]
      (x: p.x, y: p.y, z: p.z)
    else:
      vecToD(model.bones[int(idx)].position))
  template preciseTailPos(idx: int32): Vec3d =
    (if idx >= 0 and idx < model.preciseTailPositions.len.int32 and idx < model.hasPreciseTailPositions.len.int32 and model.hasPreciseTailPositions[int(idx)]:
      let p = model.preciseTailPositions[int(idx)]
      (x: p.x, y: p.y, z: p.z)
    else:
      vecToD(model.bones[int(idx)].tailPosition))

  if boneIdx notin boneVertices or boneVertices[boneIdx].len == 0:
    return (
      Vec3f(x: 0.01'f32, y: 0.01'f32, z: 0.01'f32),
      bone.position,
      Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
    )

  template preciseVertexPos(idx: int): Vec3d =
    (if idx >= 0 and idx < model.preciseVertexPositions.len:
      let p = model.preciseVertexPositions[idx]
      (x: p.x, y: p.y, z: p.z)
    else:
      vecToD(model.vertices[idx].position))

  var xs, ys, zs: seq[float64] = @[]
  var strongXs, strongYs, strongZs: seq[float64] = @[]
  var meanX = 0.0
  var meanY = 0.0
  var meanZ = 0.0

  for vertexIdx in boneVertices[boneIdx]:
    let v = model.vertices[vertexIdx]
    let preciseV = preciseVertexPos(vertexIdx)
    xs.add(preciseV.x)
    ys.add(preciseV.y)
    zs.add(preciseV.z)
    meanX += preciseV.x
    meanY += preciseV.y
    meanZ += preciseV.z

    var isStrong = false
    for strongBoneIdx in vertexBoneIdxList(v, 0.4'f32):
      if strongBoneIdx == boneIdx:
        isStrong = true
        break
    if isStrong:
      strongXs.add(preciseV.x)
      strongYs.add(preciseV.y)
      strongZs.add(preciseV.z)

  let vertexCount = float64(xs.len)
  let meanNormal: Vec3d = (x: meanX / vertexCount, y: meanY / vertexCount, z: meanZ / vertexCount)

  let minVertex: Vec3d = (x: min(xs), y: min(ys), z: min(zs))
  let maxVertex: Vec3d = (x: max(xs), y: max(ys), z: max(zs))
  var centerVertex: Vec3d = (x: medianValueD(xs), y: medianValueD(ys), z: medianValueD(zs))

  let strongMinVertex = if strongXs.len > 0:
      (x: min(strongXs), y: min(strongYs), z: min(strongZs))
    else:
      (x: 0.0, y: 0.0, z: 0.0)
  let strongMaxVertex = if strongXs.len > 0:
      (x: max(strongXs), y: max(strongYs), z: max(strongZs))
    else:
      (x: 0.0, y: 0.0, z: 0.0)

  var tailBoneExists = false
  var tailBoneIsEnd = false
  let bonePosD = preciseBonePos(boneIdx)
  var tailPosition = bonePosD
  if bone.tailIndex > 0 and int(bone.tailIndex) < model.bones.len:
    let tailBone = model.bones[int(bone.tailIndex)]
    tailPosition = preciseBonePos(bone.tailIndex)
    tailBoneExists = true
    tailBoneIsEnd = tailBone.tailIndex == int32(-1)
  else:
    if boneIdx == int32(4) and model.preciseBonePositions.len > 4 and model.hasPreciseBonePositions.len > 4 and model.hasPreciseBonePositions[3] and model.hasPreciseBonePositions[4]:
      tailPosition = preciseBonePos(int32(3))
    else:
      tailPosition = vecAddD(bonePosD, preciseTailPos(boneIdx))

  let diffSize = if strongXs.len == 0 or isBody:
      vecAbsD(vecSubD(maxVertex, minVertex))
    else:
      vecAbsD(vecSubD(strongMaxVertex, strongMinVertex))

  var shapeSize = Vec3f(x: 0.01'f32, y: 0.01'f32, z: 0.01'f32)
  var shapeRotation = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

  if shapeType == int8(0):
    if bone.name == "頭" and "右目" in boneIndexByName and "左目" in boneIndexByName:
      let rightEye = vecToD(model.bones[int(boneIndexByName["右目"])].position)
      let leftEye = vecToD(model.bones[int(boneIndexByName["左目"])].position)
      let eyeLength = vecLenD(vecSubD(rightEye, leftEye)) * 2.0
      centerVertex.x = bonePosD.x
      centerVertex.y = minVertex.y + (maxVertex.y - minVertex.y) * 0.5
      centerVertex.z = bonePosD.z
      shapeSize = vec3dToVec3f((x: eyeLength * float64(rigidbodyFactor), y: eyeLength * float64(rigidbodyFactor), z: eyeLength * float64(rigidbodyFactor)))
    else:
      let maxSize = max(diffSize.x, max(diffSize.y, diffSize.z)) * 0.5 * float64(rigidbodyFactor)
      shapeSize = vec3dToVec3f((x: maxSize, y: maxSize, z: maxSize))
  else:
    let axisVec = vecSubD(tailPosition, bonePosD)
    let tailPos = vecNormD(axisVec)
    let diffVec = vecNormD(diffSize)
    let toVec = vecNormD(vecCrossD(meanNormal, tailPos))

    var rotValue = QuatD(w: 1.0, x: 0.0, y: 0.0, z: 0.0)
    if shapeType == int8(1):
      let yAxis: Vec3d = (x: 0.0, y: float64(signf(tailPos.y)), z: 0.0)
      let xAxis: Vec3d = (x: float64(signf(tailPos.x)), y: 0.0, z: 0.0)
      rotValue = quatMul(
        quatRotationTo(yAxis, tailPos),
        quatRotationTo(xAxis, toVec),
      )
    else:
      rotValue = quatRotationTo((x: 0.0, y: 1.0, z: 0.0), tailPos)
    shapeRotation = quatToEulerRad(rotValue)

    let tailVecIdx = argmaxAbsD(diffVec)
    if shapeType == int8(1):
      if tailBoneExists and tailBoneIsEnd:
        shapeSize = vec3dToVec3f((
          x: diffSize.x * 0.7 * float64(rigidbodyFactor),
          y: diffSize.y * 0.7 * float64(rigidbodyFactor),
          z: diffSize.z * 0.15 * float64(rigidbodyFactor),
        ))
      else:
        shapeSize = vec3dToVec3f((
          x: diffSize.x * 0.7 * float64(rigidbodyFactor),
          y: (bonePosD.y - tailPosition.y) * 0.7 * float64(rigidbodyFactor),
          z: diffSize.z * 0.15 * float64(rigidbodyFactor),
        ))
        centerVertex = vecMidD(bonePosD, tailPosition)
    else:
      if tailVecIdx == 0:
        shapeSize = vec3dToVec3f((
          x: diffSize.y * (if isBody: 0.5 else: 0.3) * float64(rigidbodyFactor),
          y: abs(axisVec.x * 1.1) * float64(rigidbodyFactor),
          z: diffSize.z * float64(rigidbodyFactor),
        ))
      else:
        shapeSize = vec3dToVec3f((
          x: diffSize.x * (if isBody: 0.5 else: 0.3) * float64(rigidbodyFactor),
          y: abs(axisVec.y * 1.1) * float64(rigidbodyFactor),
          z: diffSize.z * float64(rigidbodyFactor),
        ))
      centerVertex = vecMidD(bonePosD, tailPosition)

  (shapeSize, vec3dToVec3f(centerVertex), shapeRotation)

proc applyArmTwistLayout(
  bones: var seq[PmxBoneLite],
  dir: string,
  precisePos: seq[Vec3d],
  hasPrecisePos: seq[bool],
) =
  let (shoulderIdx, armIdx, elbowIdx, armTwistIdx, wristIdx, wristTwistIdx) =
    if dir == "左": (17, 19, 24, 20, 29, 25) else: (51, 53, 58, 54, 63, 59)
  if bones.len <= wristIdx:
    return

  let localYf = Vec3f(x: 0'f32, y: -1'f32, z: 0'f32)
  let localYd: Vec3d = (x: 0.0, y: -1.0, z: 0.0)

  template p(idx: int): untyped =
    (if idx >= 0 and idx < precisePos.len and idx < hasPrecisePos.len and hasPrecisePos[idx]:
      precisePos[idx]
    else:
      (
        x: float64(bones[idx].position.x),
        y: float64(bones[idx].position.y),
        z: float64(bones[idx].position.z),
      ))

  # shoulder/arm/elbow/wrist: add local-axis flag and vectors
  for (idx, fromIdx, toIdx) in [
    (shoulderIdx, shoulderIdx, armIdx),
    (armIdx, armIdx, elbowIdx),
    (elbowIdx, elbowIdx, wristIdx),
    (wristIdx, elbowIdx, wristIdx),
  ]:
    bones[idx].flag = int16(int(bones[idx].flag) or 0x0800)
    let xAxisD = vecNormD(vecSubD(p(toIdx), p(fromIdx)))
    bones[idx].localXAxis = vec3dToVec3f(xAxisD)
    bones[idx].localZAxis = vec3dToVec3f(vecCrossD(xAxisD, localYd))

  # arm twist main bone
  let armPosD = p(armIdx)
  let elbowPosD = p(elbowIdx)
  let wristPosD = p(wristIdx)
  let armTwistPosD = vecAddD(armPosD, vecScaleD(vecSubD(elbowPosD, armPosD), 0.5))
  bones[armTwistIdx].position = vec3dToVec3f(armTwistPosD)
  bones[armTwistIdx].parentIndex = int32(armIdx)
  bones[armTwistIdx].flag = int16(0x0002 or 0x0008 or 0x0010 or 0x0400 or 0x0800)
  bones[armTwistIdx].tailIndex = int32(-1)
  bones[armTwistIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
  bones[armTwistIdx].fixedAxis = vec3dToVec3f(vecNormD(vecSubD(elbowPosD, armPosD)))
  let armTwistLocalXD = vecNormD(vecSubD(wristPosD, elbowPosD))
  bones[armTwistIdx].localXAxis = vec3dToVec3f(armTwistLocalXD)
  bones[armTwistIdx].localZAxis = vec3dToVec3f(vecCrossD(armTwistLocalXD, localYd))

  # arm twist sub bones 1/2/3
  for (subOffset, factor) in [(1, 0.25'f32), (2, 0.5'f32), (3, 0.75'f32)]:
    let idx = armTwistIdx + subOffset
    if idx >= bones.len:
      continue
    bones[idx].position = vec3dToVec3f(vecAddD(armPosD, vecScaleD(vecSubD(elbowPosD, armPosD), float64(factor))))
    bones[idx].parentIndex = int32(armIdx)
    bones[idx].flag = int16(0x0002 or 0x0100)
    bones[idx].tailIndex = int32(-1)
    bones[idx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
    bones[idx].appendBoneIndex = int32(armTwistIdx)
    bones[idx].appendRatio = factor

  # wrist twist main bone
  bones[wristTwistIdx].position = vec3dToVec3f(vecAddD(elbowPosD, vecScaleD(vecSubD(wristPosD, elbowPosD), 0.5)))
  bones[wristTwistIdx].parentIndex = int32(elbowIdx)
  bones[wristTwistIdx].flag = int16(0x0002 or 0x0008 or 0x0010 or 0x0400 or 0x0800)
  bones[wristTwistIdx].tailIndex = int32(-1)
  bones[wristTwistIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
  let wristTwistAxisD = vecNormD(vecSubD(wristPosD, elbowPosD))
  bones[wristTwistIdx].fixedAxis = vec3dToVec3f(wristTwistAxisD)
  bones[wristTwistIdx].localXAxis = vec3dToVec3f(wristTwistAxisD)
  bones[wristTwistIdx].localZAxis = vec3dToVec3f(vecCrossD(wristTwistAxisD, localYd))

  # wrist twist sub bones 1/2/3
  for (subOffset, factor) in [(1, 0.25'f32), (2, 0.5'f32), (3, 0.75'f32)]:
    let idx = wristTwistIdx + subOffset
    if idx >= bones.len:
      continue
    bones[idx].position = vec3dToVec3f(vecAddD(elbowPosD, vecScaleD(vecSubD(wristPosD, elbowPosD), float64(factor))))
    bones[idx].parentIndex = int32(elbowIdx)
    bones[idx].flag = int16(0x0002 or 0x0100)
    bones[idx].tailIndex = int32(-1)
    bones[idx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
    bones[idx].appendBoneIndex = int32(wristTwistIdx)
    bones[idx].appendRatio = factor

proc normalizeZero(value: float32): float32 =
  if value == 0'f32:
    return 0'f32
  return value

proc containsBone(bones: seq[int32], target: int32): bool =
  for bone in bones:
    if bone == target:
      return true
  return false

proc applyTwistSegment(
  validBones: var seq[int32],
  validWeights: var seq[float64],
  vertexX: float64,
  boneWorldXs: seq[float64],
  fromBone: int32,
  toBone: int32,
): bool =
  if fromBone < 0 or toBone < 0:
    return false
  if fromBone.int >= boneWorldXs.len or toBone.int >= boneWorldXs.len:
    return false

  let twistDistance = boneWorldXs[toBone.int] - boneWorldXs[fromBone.int]
  let vectorDistance = vertexX - boneWorldXs[fromBone.int]
  if signf(twistDistance) == 0 or signf(twistDistance) != signf(vectorDistance):
    return false

  let twistFactor64 = vectorDistance / twistDistance
  let twistFactor = twistFactor64.float32
  var appendedBones: seq[int32] = @[]
  var appendedWeights: seq[float64] = @[]
  var changed = false

  for i in 0 ..< validBones.len:
    if validBones[i] != fromBone:
      continue

    if twistFactor > 1'f32:
      validBones[i] = toBone
      changed = true
    else:
      let sourceWeight = validWeights[i]
      # Apply factor64 directly to segment-ending transitions (Case A expansion)
      # to match NumPy's internal float64 precision behavior
      let useFactor64 = (fromBone == 61'i32 and toBone == 62'i32) or  # Right wrist
                        (fromBone == 58'i32 and toBone == 60'i32) or  # Right wrist (first segment)
                        (fromBone == 60'i32 and toBone == 61'i32) or  # Right wrist (middle segment)
                        (fromBone == 53'i32 and toBone == 55'i32) or  # Right arm (first segment)
                        (fromBone == 55'i32 and toBone == 56'i32) or  # Right arm (middle segment)
                        (fromBone == 27'i32 and toBone == 28'i32) or  # Left wrist
                        (fromBone == 24'i32 and toBone == 26'i32) or  # Left wrist (first segment)
                        (fromBone == 26'i32 and toBone == 27'i32) or  # Left wrist (middle segment)
                        (fromBone == 19'i32 and toBone == 21'i32) or  # Left arm (first segment)
            (fromBone == 21'i32 and toBone == 22'i32) or  # Left arm (middle segment)
                        (fromBone == 22'i32 and toBone == 23'i32) or  # Left arm
                        (fromBone == 56'i32 and toBone == 57'i32)     # Right arm
      let factorForWeights = if useFactor64: twistFactor64 else: twistFactor.float64
      let toW = sourceWeight * factorForWeights
      let fromW = sourceWeight * (1.0'f64 - factorForWeights)
      validWeights[i] = fromW
      appendedBones.add(toBone)
      appendedWeights.add(toW)
      changed = true

  for i in 0 ..< appendedBones.len:
    validBones.add(appendedBones[i])
    validWeights.add(appendedWeights[i])
  return changed

proc applyTwistDistribution(
  validBones: var seq[int32],
  validWeights: var seq[float64],
  vertexX: float64,
  boneWorldXs: seq[float64],
  baseBone: int32,
  endBone: int32,
  twistBone1: int32,
  twistBone2: int32,
  twistBone3: int32,
): bool =
  if baseBone.int >= boneWorldXs.len or endBone.int >= boneWorldXs.len:
    return false
  if twistBone1.int >= boneWorldXs.len or twistBone2.int >= boneWorldXs.len or twistBone3.int >= boneWorldXs.len:
    return false
  if not (
    containsBone(validBones, baseBone) or
    containsBone(validBones, twistBone1) or
    containsBone(validBones, twistBone2) or
    containsBone(validBones, twistBone3)
  ):
    return false

  let limbDistance = boneWorldXs[endBone.int] - boneWorldXs[baseBone.int]
  let vertexDistance = vertexX - boneWorldXs[baseBone.int]
  if signf(limbDistance) == 0 or signf(limbDistance) != signf(vertexDistance):
    return false

  var changed = false
  changed = applyTwistSegment(validBones, validWeights, vertexX, boneWorldXs, baseBone, twistBone1) or changed
  changed = applyTwistSegment(validBones, validWeights, vertexX, boneWorldXs, twistBone1, twistBone2) or changed
  changed = applyTwistSegment(validBones, validWeights, vertexX, boneWorldXs, twistBone2, twistBone3) or changed
  return changed

proc buildBoneWorldXs(jsonData: JsonNode, nodeToBoneIdx: Table[int, int32]): seq[float64] =
  if not jsonData.hasKey("nodes"):
    return @[]

  let nodes = jsonData["nodes"]
  var parentByNode = newSeq[int](nodes.len)
  for i in 0 ..< parentByNode.len:
    parentByNode[i] = -1

  for nodeIdx, node in nodes.elems:
    if node.hasKey("children") and node["children"].kind == JArray:
      for child in node["children"]:
        let childIdx = child.getInt(-1)
        if childIdx >= 0 and childIdx < parentByNode.len:
          parentByNode[childIdx] = nodeIdx

  var worldXs = newSeq[float64](nodes.len)
  var resolved = newSeq[bool](nodes.len)

  proc readLocalX(nodeIdx: int): float64 =
    let node = nodes[nodeIdx]
    if node.hasKey("translation") and node["translation"].kind == JArray and node["translation"].len > 0:
      return node["translation"][0].getFloat(0.0)
    return 0.0

  proc resolveWorldX(nodeIdx: int): float64 =
    if resolved[nodeIdx]:
      return worldXs[nodeIdx]
    let parentIdx = parentByNode[nodeIdx]
    if parentIdx >= 0:
      worldXs[nodeIdx] = resolveWorldX(parentIdx) + readLocalX(nodeIdx)
    else:
      worldXs[nodeIdx] = readLocalX(nodeIdx)
    resolved[nodeIdx] = true
    return worldXs[nodeIdx]

  var maxBoneIdx = -1
  for _, boneIdx in nodeToBoneIdx:
    if boneIdx.int > maxBoneIdx:
      maxBoneIdx = boneIdx.int
  if maxBoneIdx < 0:
    return @[]

  result = newSeq[float64](maxBoneIdx + 1)
  for nodeIdx, boneIdx in nodeToBoneIdx:
    if boneIdx.int >= 0 and boneIdx.int < result.len:
      result[boneIdx.int] = -resolveWorldX(nodeIdx) * float64(MIKU_METER)

  # Python creates twist helper bones even when VRM nodes do not contain them.
  # L arm: 19 -> 24 gives 21/22/23
  if 24 < result.len:
    let bx = result[19]
    let ex = result[24]
    if 21 < result.len: result[21] = bx + (ex - bx) * 0.25
    if 22 < result.len: result[22] = bx + (ex - bx) * 0.5
    if 23 < result.len: result[23] = bx + (ex - bx) * 0.75

  # L wrist: 24 -> 29 gives 26/27/28
  if 29 < result.len:
    let bx = result[24]
    let ex = result[29]
    if 26 < result.len: result[26] = bx + (ex - bx) * 0.25
    if 27 < result.len: result[27] = bx + (ex - bx) * 0.5
    if 28 < result.len: result[28] = bx + (ex - bx) * 0.75

  # R arm: 53 -> 58 gives 55/56/57
  if 58 < result.len:
    let bx = result[53]
    let ex = result[58]
    if 55 < result.len: result[55] = bx + (ex - bx) * 0.25
    if 56 < result.len: result[56] = bx + (ex - bx) * 0.5
    if 57 < result.len: result[57] = bx + (ex - bx) * 0.75

  # R wrist: 58 -> 63 gives 60/61/62
  if 63 < result.len:
    let bx = result[58]
    let ex = result[63]
    if 60 < result.len: result[60] = bx + (ex - bx) * 0.25
    if 61 < result.len: result[61] = bx + (ex - bx) * 0.5
    if 62 < result.len: result[62] = bx + (ex - bx) * 0.75

proc buildDeform(
  vertexIndex: int,
  joints: (int, int, int, int),
  weights: (float32, float32, float32, float32),
  vertexX: float64,
  skinJoints: seq[int],
  nodeToBoneIdx: Table[int, int32],
  boneWorldXs: seq[float64],
): PmxDeformLite =
  ## Build PMX deform data from JOINTS_0/WEIGHTS_0 for a single vertex.
  ## Filters joints with weight > 0 and maps joint -> skin_joint node -> PMX bone index.
  var validBones: seq[int32] = @[]
  var validWeights: seq[float64] = @[]

  let jArr = [joints[0], joints[1], joints[2], joints[3]]
  let wArr = [weights[0], weights[1], weights[2], weights[3]]

  if shouldDebugVertex(vertexIndex):
    echo "[nim][vertex=", vertexIndex, "][raw_input] vertexX=", vertexX, " ", hexF64(vertexX)
    for i in 0 .. 3:
      echo "  [", i, "] joint=", jArr[i], " weight32=", wArr[i], " ", hexF32(wArr[i]), " weight64=", float64(wArr[i]), " ", hexF64(float64(wArr[i]))

  for i in 0 .. 3:
    if wArr[i] <= 0'f32:
      continue
    let j = jArr[i]
    if j < 0 or j >= skinJoints.len:
      continue
    let nodeIdx = skinJoints[j]
    var pmxBone = nodeToBoneIdx.getOrDefault(nodeIdx, int32(0))

    if pmxBone == 3'i32:           # 腰 -> 下半身
      pmxBone = 4'i32
    elif pmxBone == 85'i32:        # 左足 -> 左足D
      pmxBone = 98'i32
    elif pmxBone == 86'i32:        # 左ひざ -> 左ひざD
      pmxBone = 99'i32
    elif pmxBone == 87'i32:        # 左足首 -> 左足首D
      pmxBone = 100'i32
    elif pmxBone == 92'i32:        # 右足 -> 右足D
      pmxBone = 102'i32
    elif pmxBone == 93'i32:        # 右ひざ -> 右ひざD
      pmxBone = 103'i32
    elif pmxBone == 94'i32:        # 右足首 -> 右足首D
      pmxBone = 104'i32
    validBones.add(pmxBone)
    validWeights.add(float64(wArr[i]))

  debugBoneWeights(vertexIndex, "mapped", validBones, validWeights)

  # Left/right arm and wrist: distribute across synthesized twist bones.
  discard applyTwistDistribution(validBones, validWeights, vertexX, boneWorldXs, 19'i32, 24'i32, 21'i32, 22'i32, 23'i32)
  discard applyTwistDistribution(validBones, validWeights, vertexX, boneWorldXs, 24'i32, 29'i32, 26'i32, 27'i32, 28'i32)
  discard applyTwistDistribution(validBones, validWeights, vertexX, boneWorldXs, 53'i32, 58'i32, 55'i32, 56'i32, 57'i32)
  discard applyTwistDistribution(validBones, validWeights, vertexX, boneWorldXs, 58'i32, 63'i32, 60'i32, 61'i32, 62'i32)

  debugBoneWeights(vertexIndex, "post_twist", validBones, validWeights)

  if validBones.len > 1:
    var merged = initOrderedTable[int32, float64]()
    for i in 0 ..< validBones.len:
      let bone = validBones[i]
      let weight = validWeights[i]
      if merged.hasKey(bone):
        merged[bone] = merged[bone] + weight
      else:
        merged[bone] = weight

    var mergedBones: seq[int32] = @[]
    var mergedWeights64: seq[float64] = @[]
    for bone, weight in merged:
      mergedBones.add(bone)
      mergedWeights64.add(weight)

    debugBoneWeights(vertexIndex, "merged_raw", mergedBones, mergedWeights64)

    if mergedWeights64.len > 0:
      var totalWeight = 0.0
      for weight in mergedWeights64:
        totalWeight += weight
      if totalWeight > 0.0:
        for i in 0 ..< mergedWeights64.len:
          mergedWeights64[i] = mergedWeights64[i] / totalWeight

    debugBoneWeights(vertexIndex, "merged_normalized", mergedBones, mergedWeights64)

    if mergedBones.len > 4 and mergedWeights64.len > 4:
      var minIdx = 0
      for i in 1 ..< mergedWeights64.len:
        if mergedWeights64[i] < mergedWeights64[minIdx]:
          minIdx = i
      mergedBones.delete(minIdx)
      mergedWeights64.delete(minIdx)

      if shouldDebugVertex(vertexIndex):
        echo "[nim][vertex=", vertexIndex, "][trim] removed_index=", minIdx

      var totalWeight = 0.0
      for weight in mergedWeights64:
        totalWeight += weight
      if totalWeight > 0.0:
        for i in 0 ..< mergedWeights64.len:
          mergedWeights64[i] = mergedWeights64[i] / totalWeight

      debugBoneWeights(vertexIndex, "post_trim_normalized", mergedBones, mergedWeights64)

    validBones = mergedBones
    validWeights = mergedWeights64

  debugBoneWeights(vertexIndex, "final_valid", validBones, validWeights)

  case validBones.len
  of 0:
    return makeBdef1(0)
  of 1:
    return makeBdef1(validBones[0])
  of 2:
    # Bdef2: Apply Case 6 post-correction
    # Fix weight0, compute weight1 as residual (1.0 - weight0)
    # This matches NumPy's order of operations for 1-weight complements
    let w0 = validWeights[0].float32
    let w1 = 1.0'f32 - w0  # Complementary residual
    if shouldDebugVertex(vertexIndex):
      echo "[nim][vertex=", vertexIndex, "][final_bdef2] bones=", validBones[0], ",", validBones[1], " w0=", w0, " ", hexF32(w0), " w1=", w1, " ", hexF32(w1)
    return makeBdef2(validBones[0], validBones[1], w0)
  else:
    # Bdef4: pad to 4 entries
    let b0 = validBones[0]
    let b1 = if validBones.len > 1: validBones[1] else: int32(0)
    let b2 = if validBones.len > 2: validBones[2] else: int32(0)
    let b3 = if validBones.len > 3: validBones[3] else: int32(0)
    let w0 = validWeights[0].float32
    let w1 = if validWeights.len > 1: validWeights[1].float32 else: 0'f32
    let w2 = if validWeights.len > 2: validWeights[2].float32 else: 0'f32
    let w3 = if validWeights.len > 3: validWeights[3].float32 else: 0'f32
    if shouldDebugVertex(vertexIndex):
      echo "[nim][vertex=", vertexIndex, "][final_bdef4] bones=", b0, ",", b1, ",", b2, ",", b3
      echo "[nim][vertex=", vertexIndex, "][final_bdef4] weights32=", w0, " ", hexF32(w0), ", ", w1, " ", hexF32(w1), ", ", w2, " ", hexF32(w2), ", ", w3, " ", hexF32(w3)
    return makeBdef4(b0, b1, b2, b3, w0, w1, w2, w3)

proc getSkinJointsForMesh(jsonData: JsonNode, meshIdx: int): seq[int] =
  ## Returns the skin joints array for the given mesh (node that references this mesh).
  if not jsonData.hasKey("nodes") or not jsonData.hasKey("skins"):
    return @[]
  for nd in jsonData["nodes"]:
    if nd.hasKey("mesh") and nd["mesh"].getInt(-1) == meshIdx and nd.hasKey("skin"):
      let skinIdx = nd["skin"].getInt(-1)
      if skinIdx >= 0 and skinIdx < jsonData["skins"].len:
        let skin = jsonData["skins"][skinIdx]
        if skin.hasKey("joints"):
          for j in skin["joints"]:
            result.add(j.getInt(-1))
          return
  return @[]

proc estimateMorphCount(jsonData: JsonNode): int =
  if jsonData.kind != JObject or not jsonData.hasKey("extensions"):
    return 0

  let ext = jsonData["extensions"]
  if ext.kind == JObject and ext.hasKey("VRMC_vrm"):
    let vrmc = ext["VRMC_vrm"]
    if vrmc.kind == JObject and vrmc.hasKey("expressions") and vrmc["expressions"].kind == JObject:
      return vrmc["expressions"].len

  if ext.kind == JObject and ext.hasKey("VRM"):
    let vrm = ext["VRM"]
    if vrm.kind == JObject and vrm.hasKey("blendShapeMaster"):
      let bsm = vrm["blendShapeMaster"]
      if bsm.kind == JObject and bsm.hasKey("blendShapeGroups"):
        return bsm["blendShapeGroups"].len

  return 0

proc estimateRigidbodyCount(jsonData: JsonNode): int =
  if jsonData.kind != JObject or not jsonData.hasKey("extensions"):
    return 0
  let ext = jsonData["extensions"]
  if ext.kind == JObject and ext.hasKey("VRM"):
    let vrm = ext["VRM"]
    if vrm.kind == JObject and vrm.hasKey("secondaryAnimation"):
      let sec = vrm["secondaryAnimation"]
      if sec.kind == JObject and sec.hasKey("boneGroups"):
        return sec["boneGroups"].len
  return 0

proc normalizeMorphWeight(weight: JsonNode): float32 =
  let rawWeight =
    case weight.kind
    of JInt:
      float64(weight.getInt(0))
    of JFloat:
      weight.getFloat(0.0)
    else:
      0.0
  if rawWeight > 1.0:
    return float32(rawWeight / 100.0)
  return float32(rawWeight)

proc mapExpressionMorph(name: string): (string, int8) =
  case name
  of "Neutral": ("ニュートラル", int8(4))
  of "A": ("あ", int8(3))
  of "I": ("い", int8(3))
  of "U": ("う", int8(3))
  of "E": ("え", int8(3))
  of "O": ("お", int8(3))
  of "Blink": ("まばたき", int8(2))
  of "Blink_L": ("ウィンク２左", int8(2))
  of "Blink_R": ("ウィンク２右", int8(2))
  of "Angry": ("怒", int8(4))
  of "Fun": ("楽", int8(4))
  of "Joy": ("喜", int8(4))
  of "Sorrow": ("哀", int8(4))
  of "Surprised": ("驚", int8(4))
  else: (name, int8(4))

proc standardDisplaySlotNameByBoneIndex(boneIdx: int): string =
  case boneIdx
  of 1, 2:
    "センター"
  of 3, 4, 5, 6, 7, 8:
    "体幹"
  of 9, 10, 11:
    "顔"
  of 12, 14:
    "胸"
  of 16, 17, 19, 20, 24, 25, 29:
    "左手"
  of 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 43, 44, 46, 47, 48:
    "左指"
  of 50, 51, 53, 54, 58, 59, 63:
    "右手"
  of 64, 65, 66, 68, 69, 70, 72, 73, 74, 76, 77, 78, 80, 81, 82:
    "右指"
  of 85, 86, 87, 89, 90, 98, 99, 100, 101:
    "左足"
  of 92, 93, 94, 96, 97, 102, 103, 104, 105:
    "右足"
  else:
    ""

proc addDisplaySlot(slots: var seq[PmxDisplaySlotLite], slotIndexByName: var Table[string, int], name, englishName: string, specialFlag, displayType: int8): int =
  if name in slotIndexByName:
    return slotIndexByName[name]
  let idx = slots.len
  slots.add(PmxDisplaySlotLite(
    name: name,
    englishName: englishName,
    specialFlag: specialFlag,
    displayType: displayType,
  ))
  slotIndexByName[name] = idx
  return idx

proc buildDisplaySlots(model: var PmxModelLite) =
  var slots: seq[PmxDisplaySlotLite] = @[]
  var slotIndexByName = initTable[string, int]()

  let rootIdx = addDisplaySlot(slots, slotIndexByName, "Root", "Root", int8(1), int8(1))
  slots[rootIdx].references.add(PmxDisplayRefLite(targetType: int8(1), index: int32(0)))

  let expIdx = addDisplaySlot(slots, slotIndexByName, "表情", "Exp", int8(1), int8(1))
  for i, morph in model.morphs:
    if morph.morphType == int8(0):
      slots[expIdx].references.add(PmxDisplayRefLite(targetType: int8(1), index: int32(i)))

  for boneIdx, bone in model.bones:
    if bone.name == "全ての親":
      continue

    let stdSlot = standardDisplaySlotNameByBoneIndex(boneIdx)
    if stdSlot.len > 0:
      let idx = addDisplaySlot(slots, slotIndexByName, stdSlot, stdSlot, int8(0), int8(0))
      slots[idx].references.add(PmxDisplayRefLite(targetType: int8(0), index: int32(boneIdx)))
      continue

    if "髪" in bone.name and (int(bone.flag) and 0x0010) != 0:
      let idx = addDisplaySlot(slots, slotIndexByName, "髪", "髪", int8(0), int8(0))
      slots[idx].references.add(PmxDisplayRefLite(targetType: int8(0), index: int32(boneIdx)))
      continue

    if (int(bone.flag) and 0x0010) != 0:
      let idx = addDisplaySlot(slots, slotIndexByName, "その他", "その他", int8(0), int8(0))
      slots[idx].references.add(PmxDisplayRefLite(targetType: int8(0), index: int32(boneIdx)))

  model.displaySlots = slots

proc makeNoCollisionMask(excludedGroups: openArray[int]): int16 =
  var mask = 0
  for grp in 0 .. 15:
    if grp notin excludedGroups:
      mask = mask or (1 shl grp)
  return cast[int16](mask)

proc buildStandardPhysics(model: var PmxModelLite) =
  type StdRigidDef = tuple[name: string, shapeType: int8, mode: int8, group: int8]
  type OptionalPhysicsConfig = object
    matchedPattern: bool
    shapeType: int8
    collisionGroup: int8
    noCollisionGroup: int16
    rigidbodyFactor: float32
    paramFrom: array[5, float64]
    paramTo: array[5, float64]
    jointRotationLimitMin: Vec3f
    jointRotationLimitMax: Vec3f
    jointSpringTranslation: Vec3f
    jointSpringRotation: Vec3f
  let defs: seq[StdRigidDef] = @[
    ("下半身", int8(2), int8(0), int8(0)),
    ("上半身", int8(2), int8(0), int8(0)),
    ("上半身2", int8(2), int8(0), int8(0)),
    ("首", int8(2), int8(0), int8(0)),
    ("頭", int8(0), int8(0), int8(0)),
    ("左胸", int8(0), int8(0), int8(0)),
    ("左胸先", int8(0), int8(2), int8(0)),
    ("右胸", int8(0), int8(0), int8(0)),
    ("右胸先", int8(0), int8(2), int8(0)),
    ("左肩", int8(2), int8(0), int8(1)),
    ("左腕", int8(2), int8(0), int8(1)),
    ("左ひじ", int8(2), int8(0), int8(1)),
    ("左手首", int8(2), int8(0), int8(1)),
    ("右肩", int8(2), int8(0), int8(1)),
    ("右腕", int8(2), int8(0), int8(1)),
    ("右ひじ", int8(2), int8(0), int8(1)),
    ("右手首", int8(2), int8(0), int8(1)),
    ("左足", int8(2), int8(0), int8(2)),
    ("左ひざ", int8(2), int8(0), int8(2)),
    ("左足首", int8(2), int8(0), int8(2)),
    ("右足", int8(2), int8(0), int8(2)),
    ("右ひざ", int8(2), int8(0), int8(2)),
    ("右足首", int8(2), int8(0), int8(2)),
  ]

  var boneIndexByName = initTable[string, int32]()
  var boneEnglishByName = initTable[string, string]()
  for i, bone in model.bones:
    boneIndexByName[bone.name] = int32(i)
  for i, jaName in BONE_PAIRS_JA:
    if i < BONE_PAIRS_EN.len:
      boneEnglishByName[jaName] = BONE_PAIRS_EN[i]

  var boneVertices = initTable[int32, seq[int]]()
  var bonesWithVertices = initHashSet[int32]()
  for vertexIdx, v in model.vertices:
    for boneIdx in vertexBoneIdxList(v, 0.4'f32):
      boneVertices.mgetOrPut(boneIdx, @[]).add(vertexIdx)
      bonesWithVertices.incl(boneIdx)
      let bIdx = int(boneIdx)
      if bIdx < 0 or bIdx >= model.bones.len:
        continue
      let b = model.bones[bIdx]
      if "捩" in b.name and b.parentIndex >= 0:
        boneVertices.mgetOrPut(b.parentIndex, @[]).add(vertexIdx)
        bonesWithVertices.incl(b.parentIndex)
      elif (b.flag and 0x0100) != 0 and b.appendBoneIndex >= 0:
        boneVertices.mgetOrPut(b.appendBoneIndex, @[]).add(vertexIdx)
        bonesWithVertices.incl(b.appendBoneIndex)

  model.rigidbodies = @[]
  model.joints = @[]

  let noCollisionMask = makeNoCollisionMask([0, 1, 2])
  var rigidIndexByBone = initTable[string, int32]()
  var optionalPhysicsByBone = initTable[string, OptionalPhysicsConfig]()
  var bonePairsJaSet = initHashSet[string]()
  for n in BONE_PAIRS_JA:
    bonePairsJaSet.incl(n)

  proc resolveOptionalPhysicsConfig(boneName: string): OptionalPhysicsConfig =
    result = OptionalPhysicsConfig(
      matchedPattern: false,
      shapeType: int8(2),
      collisionGroup: int8(9),
      noCollisionGroup: makeNoCollisionMask([9]),
      rigidbodyFactor: 1'f32,
      paramFrom: [2.0, 0.9, 0.9, 0.0, 0.5],
      paramTo: [0.5, 0.9999, 0.9999, 0.0, 0.5],
      jointRotationLimitMin: Vec3f(
        x: degToRad(-15'f32),
        y: degToRad(-2'f32),
        z: degToRad(-25'f32),
      ),
      jointRotationLimitMax: Vec3f(
        x: degToRad(135'f32),
        y: degToRad(2'f32),
        z: degToRad(25'f32),
      ),
      jointSpringTranslation: Vec3f(x: 10'f32, y: 10'f32, z: 10'f32),
      jointSpringRotation: Vec3f(x: 50'f32, y: 50'f32, z: 50'f32),
    )
    if "髪" in boneName:
      result.matchedPattern = true
      result.collisionGroup = int8(3)
      result.noCollisionGroup = makeNoCollisionMask([3])
      result.paramFrom = [1.0, 0.7, 0.7, 0.0, 0.0]
      result.paramTo = [0.1, 0.999, 0.999, 0.0, 0.0]
      result.jointRotationLimitMin = Vec3f(
        x: degToRad(-80'f32),
        y: degToRad(-5'f32),
        z: degToRad(-80'f32),
      )
      result.jointRotationLimitMax = Vec3f(
        x: degToRad(80'f32),
        y: degToRad(5'f32),
        z: degToRad(10'f32),
      )
      result.jointSpringTranslation = Vec3f(x: 1'f32, y: 1'f32, z: 1'f32)
      result.jointSpringRotation = Vec3f(x: 10'f32, y: 10'f32, z: 10'f32)
    elif "Sleeve" in boneName:
      result.matchedPattern = true
      result.collisionGroup = int8(4)
      result.noCollisionGroup = makeNoCollisionMask([1, 4])
    elif "Skirt" in boneName:
      result.matchedPattern = true
      result.shapeType = int8(1)
      result.collisionGroup = int8(4)
      result.noCollisionGroup = makeNoCollisionMask([4])

  for d in defs:
    if d.name notin boneIndexByName:
      continue
    let boneIdx32 = boneIndexByName[d.name]
    if boneIdx32 notin bonesWithVertices:
      continue
    let boneIdx = int(boneIdx32)
    let bone = model.bones[boneIdx]
    let (shapeSize, shapePos, shapeRot) = computeRigidbodyGeometry(
      model,
      boneIndexByName,
      boneVertices,
      boneIdx32,
      d.shapeType,
      1'f32,
      true,
    )

    let rb = PmxRigidbodyLite(
      name: d.name,
      englishName: boneEnglishByName.getOrDefault(d.name, d.name),
      boneIndex: int32(boneIdx),
      collisionGroup: d.group,
      noCollisionGroup: noCollisionMask,
      shapeType: d.shapeType,
      shapeSize: shapeSize,
      shapePosition: shapePos,
      shapeRotation: shapeRot,
      paramMass: 1'f32,
      paramMoveAttenuation: 0.5'f32,
      paramRotationAttenuation: 0.5'f32,
      paramRepulsion: 0'f32,
      paramFriction: 0.5'f32,
      mode: d.mode,
    )
    rigidIndexByBone[d.name] = int32(model.rigidbodies.len)
    model.rigidbodies.add(rb)

  # Optional (non-standard) rigidbodies: mirror Python's candidate conditions
  # and parameter interpolation rules from RIGIDBODY_PAIRS.
  for boneIdx, bone in model.bones:
    if bone.name in rigidIndexByBone:
      continue
    if "捩" in bone.name:
      continue
    if (bone.flag and 0x0100) != 0:
      continue
    if int32(boneIdx) notin bonesWithVertices:
      continue
    if bone.name in bonePairsJaSet:
      continue

    let cfg = resolveOptionalPhysicsConfig(bone.name)

    var parentCnt = 0
    let parentIdx = bone.parentIndex
    let hasParent = parentIdx >= 0 and int(parentIdx) < model.bones.len
    let parentBone = if hasParent: model.bones[int(parentIdx)] else: bone
    let endsWithDigit = bone.name.len > 0 and bone.name[^1].isDigit
    let endsWithEarlyDigit = endsWithDigit and (bone.name[^1] == '0' or bone.name[^1] == '1')
    if hasParent and parentBone.name in rigidIndexByBone and not (model.rigidbodies[int(rigidIndexByBone[parentBone.name])].mode == int8(0) and (not endsWithDigit or endsWithEarlyDigit)):
      var targetBoneIdx = boneIdx
      while model.bones[targetBoneIdx].parentIndex > -1:
        inc(parentCnt)
        let nextParentIdx = int(model.bones[targetBoneIdx].parentIndex)
        if nextParentIdx < 0 or nextParentIdx >= model.bones.len:
          break
        let nextParentName = model.bones[nextParentIdx].name
        if nextParentName notin rigidIndexByBone:
          break
        targetBoneIdx = nextParentIdx

    var childCnt = 0
    if bone.tailIndex >= 0:
      var targetBoneIdx = boneIdx
      while model.bones[targetBoneIdx].tailIndex > -1:
        inc(childCnt)
        let childIdx = int(model.bones[targetBoneIdx].tailIndex)
        if childIdx < 0 or childIdx >= model.bones.len:
          break
        targetBoneIdx = childIdx

    if parentCnt + childCnt <= 0:
      continue

    let attenuationT = cfg.paramFrom[1] + ((cfg.paramTo[1] - cfg.paramFrom[1]) * (float64(parentCnt) / float64(parentCnt + childCnt)))
    let attenuationR = cfg.paramFrom[2] + ((cfg.paramTo[2] - cfg.paramFrom[2]) * (float64(parentCnt) / float64(parentCnt + childCnt)))
    let paramMass = float32(cfg.paramTo[0] * float64(childCnt * childCnt))
    let paramMoveAttenuation = float32(attenuationT)
    let paramRotationAttenuation = float32(attenuationR)
    let paramRepulsion = float32(cfg.paramFrom[3])
    let paramFriction = float32(cfg.paramFrom[4])

    let (shapeSize, shapePos, shapeRot) = computeRigidbodyGeometry(
      model,
      boneIndexByName,
      boneVertices,
      int32(boneIdx),
      cfg.shapeType,
      cfg.rigidbodyFactor,
      false,
    )

    model.rigidbodies.add(PmxRigidbodyLite(
      name: bone.name,
      englishName: bone.englishName,
      boneIndex: int32(boneIdx),
      collisionGroup: cfg.collisionGroup,
      noCollisionGroup: cfg.noCollisionGroup,
      shapeType: cfg.shapeType,
      shapeSize: shapeSize,
      shapePosition: shapePos,
      shapeRotation: shapeRot,
      paramMass: paramMass,
      paramMoveAttenuation: paramMoveAttenuation,
      paramRotationAttenuation: paramRotationAttenuation,
      paramRepulsion: paramRepulsion,
      paramFriction: paramFriction,
      mode: int8(1),
    ))
    rigidIndexByBone[bone.name] = int32(model.rigidbodies.len - 1)
    optionalPhysicsByBone[bone.name] = cfg

  for boneIdx, bone in model.bones:
    if bone.name in bonePairsJaSet:
      continue
    if bone.name notin rigidIndexByBone:
      continue

    var parentRigid = int32(-1)
    var current = bone.parentIndex
    while current >= 0:
      let parentName = model.bones[int(current)].name
      if parentName in rigidIndexByBone:
        parentRigid = rigidIndexByBone[parentName]
        break
      current = model.bones[int(current)].parentIndex

    if parentRigid < 0:
      continue

    var translationLimitMin = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
    var translationLimitMax = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
    var rotationLimitMin = Vec3f(
      x: degToRad(-10'f32),
      y: degToRad(-1'f32),
      z: degToRad(-5'f32),
    )
    var rotationLimitMax = Vec3f(
      x: degToRad(10'f32),
      y: degToRad(1'f32),
      z: degToRad(20'f32),
    )
    var springConstantTranslation = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
    var springConstantRotation = Vec3f(x: 7'f32, y: 7'f32, z: 7'f32)
    if bone.name in optionalPhysicsByBone and optionalPhysicsByBone[bone.name].matchedPattern:
      let cfg = optionalPhysicsByBone[bone.name]
      rotationLimitMin = cfg.jointRotationLimitMin
      rotationLimitMax = cfg.jointRotationLimitMax
      springConstantTranslation = cfg.jointSpringTranslation
      springConstantRotation = cfg.jointSpringRotation

    let rigidIndex = rigidIndexByBone[bone.name]
    model.joints.add(PmxJointLite(
      name: bone.name,
      englishName: bone.englishName,
      jointType: int8(0),
      rigidbodyIndexA: parentRigid,
      rigidbodyIndexB: rigidIndex,
      position: bone.position,
      rotation: model.rigidbodies[int(rigidIndex)].shapeRotation,
      translationLimitMin: translationLimitMin,
      translationLimitMax: translationLimitMax,
      rotationLimitMin: rotationLimitMin,
      rotationLimitMax: rotationLimitMax,
      springConstantTranslation: springConstantTranslation,
      springConstantRotation: springConstantRotation,
    ))

  for d in defs:
    if d.mode notin [int8(1), int8(2)] or d.name notin rigidIndexByBone or d.name notin boneIndexByName:
      continue
    var current = int(boneIndexByName[d.name])
    var parentRigid = int32(-1)
    while current >= 0:
      let parentIdx = model.bones[current].parentIndex
      if parentIdx < 0:
        break
      let parentName = model.bones[int(parentIdx)].name
      if parentName in rigidIndexByBone:
        parentRigid = rigidIndexByBone[parentName]
        break
      current = int(parentIdx)

    if parentRigid < 0:
      continue

    let bidx = int(boneIndexByName[d.name])
    let spring = if d.name.endsWith("胸先"): 100000'f32 else: 7'f32
    model.joints.add(PmxJointLite(
      name: d.name,
      englishName: boneEnglishByName.getOrDefault(d.name, d.name),
      jointType: int8(0),
      rigidbodyIndexA: parentRigid,
      rigidbodyIndexB: rigidIndexByBone[d.name],
      position: model.bones[bidx].position,
      rotation: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      translationLimitMin: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      translationLimitMax: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      rotationLimitMin: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      rotationLimitMax: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      springConstantTranslation: Vec3f(x: spring, y: spring, z: spring),
      springConstantRotation: Vec3f(x: spring, y: spring, z: spring),
    ))

proc iterExpressionGroups(jsonData: JsonNode): seq[(string, seq[(int, float32)])] =
  if jsonData.kind != JObject or not jsonData.hasKey("extensions"):
    return @[]

  let ext = jsonData["extensions"]
  if ext.kind == JObject and ext.hasKey("VRM"):
    let vrm = ext["VRM"]
    if vrm.kind == JObject and vrm.hasKey("blendShapeMaster"):
      let bsm = vrm["blendShapeMaster"]
      if bsm.kind == JObject and bsm.hasKey("blendShapeGroups") and bsm["blendShapeGroups"].kind == JArray:
        for group in bsm["blendShapeGroups"]:
          if group.kind != JObject:
            continue
          let groupName = if group.hasKey("name"): group["name"].getStr("") else: ""
          var binds: seq[(int, float32)] = @[]
          if group.hasKey("binds") and group["binds"].kind == JArray:
            for morphBind in group["binds"]:
              if morphBind.kind != JObject:
                continue
              binds.add((
                morphBind.getOrDefault("index").getInt(-1),
                normalizeMorphWeight(morphBind.getOrDefault("weight")),
              ))
          result.add((groupName, binds))
        return

  if ext.kind == JObject and ext.hasKey("VRMC_vrm"):
    let vrmc = ext["VRMC_vrm"]
    if vrmc.kind == JObject and vrmc.hasKey("expressions"):
      let expressions = vrmc["expressions"]
      if expressions.kind == JObject:
        for kind in ["preset", "custom"]:
          if not expressions.hasKey(kind) or expressions[kind].kind != JObject:
            continue
          for exprName, exprValue in expressions[kind]:
            if exprValue.kind != JObject:
              continue
            var binds: seq[(int, float32)] = @[]
            if exprValue.hasKey("morphTargetBinds") and exprValue["morphTargetBinds"].kind == JArray:
              for morphBind in exprValue["morphTargetBinds"]:
                if morphBind.kind != JObject:
                  continue
                binds.add((
                  morphBind.getOrDefault("index").getInt(-1),
                  normalizeMorphWeight(morphBind.getOrDefault("weight")),
                ))
            result.add((exprName, binds))

proc parseLicenseComment(otherPermissionUrl: string): string =
  if otherPermissionUrl.len == 0 or "?" notin otherPermissionUrl:
    return ""

  let query = otherPermissionUrl.split("?", maxsplit = 1)[1]
  var valuesByKey = initTable[string, seq[string]]()

  for pair in query.split("&"):
    if pair.len == 0:
      continue
    let parts = pair.split("=", maxsplit = 1)
    let key = decodeUrl(parts[0])
    let value = if parts.len > 1: decodeUrl(parts[1]) else: ""
    if not valuesByKey.hasKey(key):
      valuesByKey[key] = @[]
    valuesByKey[key].add(value)

  for key in valuesByKey.keys.toSeq.sorted(system.cmp[string]):
    result.add("　　" & key & ": " & valuesByKey[key].join(",") & "\r\n")

proc readModelMetadata(jsonData: JsonNode, fallbackName: string): tuple[name, title, author, licenseName, licenseComment: string] =
  result = (fallbackName, "", "", "", "")

  if jsonData.kind != JObject or not jsonData.hasKey("extensions") or jsonData["extensions"].kind != JObject:
    return

  let ext = jsonData["extensions"]
  if ext.hasKey("VRM"):
    let vrm = ext["VRM"]
    if vrm.kind == JObject and vrm.hasKey("meta") and vrm["meta"].kind == JObject:
      let meta = vrm["meta"]
      let title = if meta.hasKey("title"): meta["title"].getStr("") else: ""
      result.title = title
      result.name = if title.len > 0: title else: fallbackName
      result.author = if meta.hasKey("author"): meta["author"].getStr("") else: ""
      result.licenseName = if meta.hasKey("licenseName"): meta["licenseName"].getStr("") else: ""
      if result.licenseName == "Other" and meta.hasKey("otherPermissionUrl"):
        result.licenseComment = parseLicenseComment(meta["otherPermissionUrl"].getStr(""))
      return

  if ext.hasKey("VRMC_vrm"):
    let vrm1 = ext["VRMC_vrm"]
    if vrm1.kind == JObject and vrm1.hasKey("meta") and vrm1["meta"].kind == JObject:
      let meta = vrm1["meta"]
      let title = if meta.hasKey("name"): meta["name"].getStr("") else: ""
      result.title = title
      result.name = if title.len > 0: title else: fallbackName
      if meta.hasKey("authors") and meta["authors"].kind == JArray:
        result.author = meta["authors"].elems.mapIt(it.getStr("")).join(", ")
      result.licenseName = if meta.hasKey("licenseUrl"): meta["licenseUrl"].getStr("") else: ""

proc readVec3(jsonData: JsonNode, binData: openArray[uint8], accessorIdx: int): seq[Vector3D] =
  if accessorIdx < 0:
    return @[]
  return readAccessor(jsonData, binData, accessorIdx)

proc mimeToExt(mimeType: string): string =
  case mimeType
  of "image/png":
    "png"
  of "image/jpeg":
    "jpg"
  of "image/bmp":
    "bmp"
  of "image/webp":
    "webp"
  else:
    ""

proc buildPmxTextureList(jsonData: JsonNode): seq[string] =
  # Keep index 0 empty to match the Python path.
  result = @[""]
  if not jsonData.hasKey("images") or jsonData["images"].kind != JArray:
    return

  for imageIdx, image in jsonData["images"].elems:
    if image.kind != JObject:
      continue

    let mimeType = if image.hasKey("mimeType"): image["mimeType"].getStr("") else: ""
    let ext = mimeToExt(mimeType)
    if ext.len == 0:
      continue

    var imageName = if image.hasKey("name"): image["name"].getStr("") else: ""
    if imageName.len == 0:
      imageName = "image_" & $imageIdx

    result.add("tex\\" & imageName & "." & ext)

proc resolveMainTextureIndex(jsonData: JsonNode, materialNode: JsonNode, pmxTextureCount: int): int32 =
  if materialNode.kind != JObject or pmxTextureCount <= 0:
    return int32(-1)

  var baseColorTexture = newJNull()
  if materialNode.hasKey("pbrMetallicRoughness") and materialNode["pbrMetallicRoughness"].kind == JObject:
    let pbr = materialNode["pbrMetallicRoughness"]
    if pbr.hasKey("baseColorTexture") and pbr["baseColorTexture"].kind == JObject:
      baseColorTexture = pbr["baseColorTexture"]

  if baseColorTexture.kind == JNull and materialNode.hasKey("extensions") and materialNode["extensions"].kind == JObject:
    let ext = materialNode["extensions"]
    if ext.hasKey("VRMC_materials_mtoon") and ext["VRMC_materials_mtoon"].kind == JObject:
      let mtoon = ext["VRMC_materials_mtoon"]
      if mtoon.hasKey("litMultiplyTexture") and mtoon["litMultiplyTexture"].kind == JObject:
        baseColorTexture = mtoon["litMultiplyTexture"]

  if baseColorTexture.kind != JObject or not baseColorTexture.hasKey("index"):
    return int32(-1)

  let gltfTextureIndex = baseColorTexture["index"].getInt(-1)
  if gltfTextureIndex < 0 or not jsonData.hasKey("textures") or jsonData["textures"].kind != JArray or gltfTextureIndex >= jsonData["textures"].len:
    return int32(-1)

  let textureInfo = jsonData["textures"][gltfTextureIndex]
  if textureInfo.kind != JObject:
    return int32(-1)

  var sourceIndex = if textureInfo.hasKey("source"): textureInfo["source"].getInt(-1) else: -1
  if sourceIndex < 0 and textureInfo.hasKey("extensions") and textureInfo["extensions"].kind == JObject:
    let texExt = textureInfo["extensions"]
    if texExt.hasKey("KHR_texture_basisu") and texExt["KHR_texture_basisu"].kind == JObject:
      sourceIndex = texExt["KHR_texture_basisu"]["source"].getInt(-1)

  let candidate = sourceIndex + 1
  if 0 <= candidate and candidate < pmxTextureCount:
    return int32(candidate)
  return int32(-1)

proc hasShadeColor(jsonData: JsonNode, materialNode: JsonNode): bool =
  if materialNode.kind != JObject or not materialNode.hasKey("name"):
    return false

  if not jsonData.hasKey("extensions") or jsonData["extensions"].kind != JObject:
    return false

  let ext = jsonData["extensions"]
  if not ext.hasKey("VRM") or ext["VRM"].kind != JObject:
    return false

  let vrm = ext["VRM"]
  if not vrm.hasKey("materialProperties") or vrm["materialProperties"].kind != JArray:
    return false

  let materialName = materialNode["name"].getStr("")
  if materialName.len == 0:
    return false

  for prop in vrm["materialProperties"].elems:
    if prop.kind != JObject:
      continue
    if prop.hasKey("name") and prop["name"].getStr("") == materialName:
      if not prop.hasKey("vectorProperties") or prop["vectorProperties"].kind != JObject:
        return false
      let vecProps = prop["vectorProperties"]
      return vecProps.hasKey("_ShadeColor")

  return false

proc findVrmMaterialProp(jsonData: JsonNode, materialNode: JsonNode): JsonNode =
  ## Returns the VRM materialProperties entry matching materialNode["name"], or nil.
  if materialNode.kind != JObject or not materialNode.hasKey("name"):
    return nil
  if not jsonData.hasKey("extensions") or jsonData["extensions"].kind != JObject:
    return nil
  let ext = jsonData["extensions"]
  if not ext.hasKey("VRM") or ext["VRM"].kind != JObject:
    return nil
  let vrm = ext["VRM"]
  if not vrm.hasKey("materialProperties") or vrm["materialProperties"].kind != JArray:
    return nil
  let materialName = materialNode["name"].getStr("")
  if materialName.len == 0:
    return nil
  for prop in vrm["materialProperties"].elems:
    if prop.kind == JObject and prop.hasKey("name") and prop["name"].getStr("") == materialName:
      return prop
  return nil

proc getShadeColorAmbient(jsonData: JsonNode, materialNode: JsonNode): Vec3f =
  ## Returns ambient RGB from _ShadeColor, defaulting to (0.5,0.5,0.5).
  let prop = findVrmMaterialProp(jsonData, materialNode)
  if prop != nil and prop.hasKey("vectorProperties") and prop["vectorProperties"].kind == JObject:
    let vp = prop["vectorProperties"]
    if vp.hasKey("_ShadeColor") and vp["_ShadeColor"].kind == JArray and vp["_ShadeColor"].len >= 3:
      let arr = vp["_ShadeColor"]
      return Vec3f(x: float32(arr[0].getFloat(0.5)), y: float32(arr[1].getFloat(0.5)), z: float32(arr[2].getFloat(0.5)))
  return Vec3f(x: 0.5'f32, y: 0.5'f32, z: 0.5'f32)

proc getOutlineColor(jsonData: JsonNode, materialNode: JsonNode): Vec4f =
  ## Returns edge RGBA from _OutlineColor, defaulting to (0,0,0,1).
  let prop = findVrmMaterialProp(jsonData, materialNode)
  if prop != nil and prop.hasKey("vectorProperties") and prop["vectorProperties"].kind == JObject:
    let vp = prop["vectorProperties"]
    if vp.hasKey("_OutlineColor") and vp["_OutlineColor"].kind == JArray and vp["_OutlineColor"].len >= 4:
      let arr = vp["_OutlineColor"]
      return Vec4f(x: float32(arr[0].getFloat(0)), y: float32(arr[1].getFloat(0)),
                   z: float32(arr[2].getFloat(0)), w: float32(arr[3].getFloat(1)))
  return Vec4f(x: 0'f32, y: 0'f32, z: 0'f32, w: 1'f32)

proc getOutlineWidth(jsonData: JsonNode, materialNode: JsonNode): float32 =
  ## Returns edge size from _OutlineWidth, defaulting to 0.
  let prop = findVrmMaterialProp(jsonData, materialNode)
  if prop != nil and prop.hasKey("floatProperties") and prop["floatProperties"].kind == JObject:
    let fp = prop["floatProperties"]
    if fp.hasKey("_OutlineWidth"):
      return float32(fp["_OutlineWidth"].getFloat(0))
  return 0'f32

proc getSphereAddIndex(jsonData: JsonNode, materialNode: JsonNode, pmxTextureCount: int): (int32, int8) =
  ## Returns (sphere_texture_index, sphere_mode) from _SphereAdd.
  ## Python: candidate = textureProperties._SphereAdd + 1; if valid => idx=candidate, mode=2
  let prop = findVrmMaterialProp(jsonData, materialNode)
  if prop != nil and prop.hasKey("textureProperties") and prop["textureProperties"].kind == JObject:
    let tp = prop["textureProperties"]
    if tp.hasKey("_SphereAdd"):
      let candidate = tp["_SphereAdd"].getInt(-2) + 1
      if candidate >= 0 and candidate < pmxTextureCount:
        return (int32(candidate), int8(2))
  return (int32(-1), int8(0))

proc isVroidProfile(jsonData: JsonNode, modelName: string): bool =
  let lowerName = modelName.toLowerAscii()
  var generator = ""
  if jsonData.hasKey("asset") and jsonData["asset"].kind == JObject and jsonData["asset"].hasKey("generator"):
    generator = jsonData["asset"]["generator"].getStr("").toLowerAscii()
  let hasVroidHint = lowerName.contains("vroid") or generator.contains("vroid")
  let hasVrm0 = jsonData.hasKey("extensions") and jsonData["extensions"].kind == JObject and jsonData["extensions"].hasKey("VRM")
  let hasVrm1 = jsonData.hasKey("extensions") and jsonData["extensions"].kind == JObject and jsonData["extensions"].hasKey("VRMC_vrm")
  return hasVroidHint and (hasVrm0 or hasVrm1)

proc collectHumanBoneNodes(jsonData: JsonNode): Table[int, bool] =
  result = initTable[int, bool]()
  if jsonData.kind != JObject or not jsonData.hasKey("extensions") or jsonData["extensions"].kind != JObject:
    return

  let ext = jsonData["extensions"]
  if ext.hasKey("VRM") and ext["VRM"].kind == JObject:
    let vrm0 = ext["VRM"]
    if vrm0.hasKey("humanoid") and vrm0["humanoid"].kind == JObject:
      let humanoid = vrm0["humanoid"]
      if humanoid.hasKey("humanBones") and humanoid["humanBones"].kind == JArray:
        for bone in humanoid["humanBones"].elems:
          if bone.kind == JObject and bone.hasKey("node"):
            let nodeIdx = bone["node"].getInt(-1)
            if nodeIdx >= 0:
              result[nodeIdx] = true

  if ext.hasKey("VRMC_vrm") and ext["VRMC_vrm"].kind == JObject:
    let vrm1 = ext["VRMC_vrm"]
    if vrm1.hasKey("humanoid") and vrm1["humanoid"].kind == JObject:
      let humanoid = vrm1["humanoid"]
      if humanoid.hasKey("humanBones") and humanoid["humanBones"].kind == JObject:
        for _, bone in humanoid["humanBones"]:
          if bone.kind == JObject and bone.hasKey("node"):
            let nodeIdx = bone["node"].getInt(-1)
            if nodeIdx >= 0:
              result[nodeIdx] = true

proc pythonInitialBoneFlag(node: JsonNode, bonePairsLookup: Table[string, int], nodeName, jpBoneName: string, isHumanNode: bool): int16 =
  if nodeName in bonePairsLookup:
    if jpBoneName.endsWith("先"):
      return int16(0x0003)
    if jpBoneName == "全ての親" or jpBoneName == "センター" or jpBoneName == "グルーブ":
      return int16(0x001f)
    return int16(0x001b)

  if isHumanNode or (node.kind == JObject and node.hasKey("mesh")):
    return int16(0x0003)

  return int16(0x001b)

proc buildModelFromGlb(jsonData: JsonNode, binData: openArray[uint8], modelName: string): PmxModelLite =
  let meta = readModelMetadata(jsonData, modelName)
  result.name = meta.name
  result.englishName = ""
  result.comment = "モデル名: " & meta.title & "\r\n" &
    "作者: " & meta.author & "\r\n" &
    "ライセンス: " & meta.licenseName & "\r\n" &
    meta.licenseComment & "\r\n" &
    "変換: VRM to MMD Converter - Version nim-bitperfect-baseline  (@nicodan-mmd)"
  result.englishComment = ""
  result.vertices = @[]
  result.indices = @[]
  result.textures = buildPmxTextureList(jsonData)
  result.materials = @[]
  result.bones = @[]
  result.morphs = @[]
  result.displaySlots = @[]
  result.rigidbodies = @[]
  result.joints = @[]
  result.preciseBonePositions = @[]
  result.hasPreciseBonePositions = @[]
  result.preciseTailPositions = @[]
  result.hasPreciseTailPositions = @[]
  result.preciseVertexPositions = @[]

  if not jsonData.hasKey("meshes"):
    return

  # Build bone lookup tables
  let bonePairsLookup = buildBonePairsLookup()
  let nodeToBoneIdx = buildNodeToPmxBoneIndex(jsonData, bonePairsLookup)
  let nodeWorldMatrices = buildNodeWorldMatrices(jsonData)
  let nodeParents = buildNodeParents(jsonData)
  let humanBoneNodes = collectHumanBoneNodes(jsonData)
  let boneWorldXs = buildBoneWorldXs(jsonData, nodeToBoneIdx)
  result.boneCountHint = estimateBoneCountHint(nodeToBoneIdx)
  var precisePos = newSeq[Vec3d](max(0, result.boneCountHint))
  var hasPrecisePos = newSeq[bool](max(0, result.boneCountHint))
  var preciseTailPos = newSeq[Vec3d](max(0, result.boneCountHint))
  var hasPreciseTailPos = newSeq[bool](max(0, result.boneCountHint))
  for nodeIdx, boneIdx in nodeToBoneIdx:
    let b = int(boneIdx)
    if b < 0 or b >= precisePos.len:
      continue
    if nodeIdx >= 0 and nodeIdx < nodeWorldMatrices.len:
      let wm = nodeWorldMatrices[nodeIdx]
      precisePos[b] = (
        x: -wm[3 * 4 + 0] * float64(MIKU_METER),
        y: wm[3 * 4 + 1] * float64(MIKU_METER),
        z: wm[3 * 4 + 2] * float64(MIKU_METER),
      )
      hasPrecisePos[b] = true
  result.preciseBonePositions = precisePos
  result.hasPreciseBonePositions = hasPrecisePos
  result.preciseTailPositions = preciseTailPos
  result.hasPreciseTailPositions = hasPreciseTailPos
  result.morphCountHint = estimateMorphCount(jsonData)
  result.rigidbodyCountHint = estimateRigidbodyCount(jsonData)

  # POSITION accessor dedup: accessor_idx -> vertex start index
  var processedAccessors = initTable[int, int32]()

  # Dedup: also track which JOINTS_0/WEIGHTS_0/NORMAL/TEXCOORD were used per POSITION accessor
  # to avoid re-reading them. Stored as (joints, weights) lists alongside vertex start.
  # Per-material index accumulator (ordered by first appearance)
  var materialIndices = initOrderedTable[int, seq[int32]]()
  var vertexMorphs = initOrderedTable[int, PmxMorphLite]()

  for meshIdx, mesh in jsonData["meshes"].elems:
    if not mesh.hasKey("primitives"):
      continue

    # Get skin joint array for this mesh (same for all primitives of this mesh)
    let skinJoints = getSkinJointsForMesh(jsonData, meshIdx)
    let skinInverseBindMatrices = getSkinInverseBindMatricesForMesh(jsonData, binData, meshIdx)

    for prim in mesh["primitives"]:
      if not prim.hasKey("attributes"):
        continue
      let attrs = prim["attributes"]
      if not attrs.hasKey("POSITION"):
        continue

      let posAccessorIdx = attrs["POSITION"].getInt(-1)
      if posAccessorIdx < 0:
        continue

      let matIdx = if prim.hasKey("material"): prim["material"].getInt(0) else: 0

      # Ensure the material slot exists in insertion order
      if matIdx notin materialIndices:
        materialIndices[matIdx] = @[]

      # Deduplicate: only write vertices once per POSITION accessor
      var vertexStartIdx: int32
      if processedAccessors.hasKey(posAccessorIdx):
        vertexStartIdx = processedAccessors[posAccessorIdx]
      else:
        vertexStartIdx = int32(result.vertices.len)
        processedAccessors[posAccessorIdx] = vertexStartIdx

        let positions = readVec3(jsonData, binData, posAccessorIdx)

        var normals: seq[Vector3D] = @[]
        if attrs.hasKey("NORMAL"):
          normals = readVec3(jsonData, binData, attrs["NORMAL"].getInt(-1))

        var uvs: seq[Vector3D] = @[]
        if attrs.hasKey("TEXCOORD_0"):
          uvs = readVec3(jsonData, binData, attrs["TEXCOORD_0"].getInt(-1))

        var jointsData: seq[(int, int, int, int)] = @[]
        if attrs.hasKey("JOINTS_0"):
          jointsData = readAccessorJoints(jsonData, binData, attrs["JOINTS_0"].getInt(-1))

        var weightsData: seq[(float32, float32, float32, float32)] = @[]
        if attrs.hasKey("WEIGHTS_0"):
          weightsData = readAccessorVec4Float(jsonData, binData, attrs["WEIGHTS_0"].getInt(-1))

        if prim.hasKey("extras") and prim["extras"].kind == JObject and prim["extras"].hasKey("targetNames") and prim["extras"]["targetNames"].kind == JArray and prim.hasKey("targets") and prim["targets"].kind == JArray:
          let targetNames = prim["extras"]["targetNames"]
          let targets = prim["targets"]
          for morphIdx in 0 ..< min(targetNames.len, targets.len):
            let targetName = targetNames[morphIdx].getStr("")
            let target = targets[morphIdx]
            if target.kind != JObject or not target.hasKey("POSITION"):
              continue
            let extraPositions = readVec3(jsonData, binData, target["POSITION"].getInt(-1))
            var morph = PmxMorphLite(
              name: targetName,
              englishName: targetName,
              panel: int8(1),
              morphType: int8(1),
            )
            for vidx, eposition in extraPositions:
              morph.vertexOffsets.add(PmxVertexMorphOffsetLite(
                vertexIndex: vertexStartIdx + int32(vidx),
                positionOffset: Vec3f(
                  x: float32(-float64(eposition.x) * float64(MIKU_METER)),
                  y: float32(float64(eposition.y) * float64(MIKU_METER)),
                  z: float32(float64(eposition.z) * float64(MIKU_METER)),
                ),
              ))
            vertexMorphs[morphIdx] = morph

        for i, p in positions:
          let n = if i < normals.len: normals[i] else: (x: 0'f32, y: 1'f32, z: 0'f32)
          let uvRaw = if i < uvs.len: uvs[i] else: (x: 0'f32, y: 0'f32, z: 0'f32)
          # MMD coordinate transform: negate X, scale by MIKU_METER
          # Build deform data
          var posed = (x: float64(p.x), y: float64(p.y), z: float64(p.z))
          var deform: PmxDeformLite
          if i < jointsData.len and i < weightsData.len and skinJoints.len > 0:
            posed = applySkinningPose(p, jointsData[i], weightsData[i], skinJoints, skinInverseBindMatrices, nodeWorldMatrices)
            let deformVertexX = -posed.x * float64(MIKU_METER)
            deform = buildDeform(int(vertexStartIdx) + i, jointsData[i], weightsData[i], deformVertexX, skinJoints, nodeToBoneIdx, boneWorldXs)
          else:
            deform = makeBdef1(0)

          let vertexPos = Vec3f(
            x: float32(-posed.x * float64(MIKU_METER)),
            y: float32(posed.y * float64(MIKU_METER)),
            z: float32(posed.z * float64(MIKU_METER)),
          )

          result.vertices.add(PmxVertexLite(
            position: vertexPos,
            normal: Vec3f(x: -n.x, y: n.y, z: n.z),
            uv: Vec2f(x: uvRaw.x, y: uvRaw.y),
            deform: deform,
            edgeFactor: 1'f32,
          ))
          result.preciseVertexPositions.add((
            x: -posed.x * float64(MIKU_METER),
            y: posed.y * float64(MIKU_METER),
            z: posed.z * float64(MIKU_METER),
          ))

      # Collect indices for this material
      if prim.hasKey("indices"):
          let localIndices = readIndices(jsonData, binData, prim["indices"].getInt(-1))
          var i = 0
          while i + 2 < localIndices.len:
            # Match Python path: reverse triangle winding after coordinate transform.
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i + 2]))
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i + 1]))
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i]))
            i += 3
          while i < localIndices.len:
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i]))
            i += 1

  # Flatten indices per material in insertion order
  for matIdx, idxList in materialIndices:
    for idx in idxList:
      result.indices.add(idx)

  var vertexMorphIndexMap = initTable[int, int32]()
  for sourceMorphIdx, morph in vertexMorphs:
    vertexMorphIndexMap[sourceMorphIdx] = int32(result.morphs.len)
    result.morphs.add(morph)

  let expressionGroups = iterExpressionGroups(jsonData)
  var namedMorphIndexMap = initTable[string, int32]()
  for (expressionName, binds) in expressionGroups:
    if binds.len == 0:
      continue
    let (mappedName, panel) = mapExpressionMorph(expressionName)
    var morph = PmxMorphLite(
      name: mappedName,
      englishName: expressionName,
      panel: panel,
      morphType: int8(0),
    )
    for (bindIdx, bindWeight) in binds:
      if bindIdx notin vertexMorphIndexMap:
        continue
      morph.groupOffsets.add(PmxGroupMorphOffsetLite(
        morphIndex: vertexMorphIndexMap[bindIdx],
        value: bindWeight,
      ))
    if morph.groupOffsets.len > 0:
      namedMorphIndexMap[morph.name] = int32(result.morphs.len)
      result.morphs.add(morph)

  for (syntheticName, syntheticPanel, bindNames) in @[
    ("眉下", int8(1), @["眉下左", "眉下右"]),
    ("眉笑", int8(1), @["眉笑左", "眉笑右"]),
    ("にやり", int8(3), @["にやり左", "にやり右"]),
    ("目頭下", int8(3), @["目頭下左", "目頭下右"]),
    ("目尻狭", int8(3), @["目尻狭左", "目尻狭右"]),
    ("目頭狭", int8(3), @["目頭狭左", "目頭狭右"]),
    ("目上", int8(3), @["目上左", "目上右"]),
    ("笑い", int8(3), @["笑い左", "笑い右"]),
    ("驚き", int8(3), @["驚き左", "驚き右"]),
    ("口引", int8(3), @["口引左", "口引右"]),
    ("口下", int8(3), @["口下左", "口下右"]),
    ("にこ", int8(3), @["にこ左", "にこ右"]),
    ("にこり2", int8(3), @["にこり2左", "にこり2右"]),
    ("にやり2", int8(3), @["にやり2上", "にやり2下"]),
    ("むっ", int8(3), @["むっ上", "むっ下"]),
    ("にっこり", int8(3), @["にっこり右", "にっこり左"]),
    ("むー", int8(3), @["むー右", "むー左"]),
    ("いー", int8(3), @["いー右", "いー左"]),
    ("鼻しかめる", int8(3), @["鼻しかめる右", "鼻しかめる左"]),
  ]:
    var morph = PmxMorphLite(
      name: syntheticName,
      englishName: syntheticName,
      panel: syntheticPanel,
      morphType: int8(0),
    )
    for bindName in bindNames:
      if bindName notin namedMorphIndexMap:
        continue
      let bindMorph = result.morphs[namedMorphIndexMap[bindName]]
      for groupOffset in bindMorph.groupOffsets:
        morph.groupOffsets.add(groupOffset)
    namedMorphIndexMap[morph.name] = int32(result.morphs.len)
    result.morphs.add(morph)
  result.morphCountHint = result.morphs.len

  # Build one material per GLB material index (in order of first appearance)
  let hasMaterials = jsonData.hasKey("materials")
  for matIdx, idxList in materialIndices:
    let idxCount = int32(idxList.len)
    var mat = defaultMaterial(idxCount)
    var matName = "mat_" & $matIdx
    var hasCustomToon = false
    if hasMaterials and matIdx < jsonData["materials"].len:
      let vrmMat = jsonData["materials"][matIdx]
      matName = vrmMat["name"].getStr("mat_" & $matIdx)
      mat.name = matName
      mat.englishName = matName
      mat.textureIndex = resolveMainTextureIndex(jsonData, vrmMat, result.textures.len)
      # Check doubleSided and set 0x01 flag if needed (matches Python path)
      if vrmMat.kind == JObject and vrmMat.hasKey("doubleSided") and vrmMat["doubleSided"].getBool(false):
        mat.flag = int8(int(mat.flag) or 0x01)
      # ambient: _ShadeColor (Python path)
      mat.ambient = getShadeColorAmbient(jsonData, vrmMat)
      # edge: _OutlineColor, _OutlineWidth (Python path)
      mat.edgeColor = getOutlineColor(jsonData, vrmMat)
      mat.edgeSize = getOutlineWidth(jsonData, vrmMat)
      # sphere: _SphereAdd (Python path)
      let (sphIdx, sphMode) = getSphereAddIndex(jsonData, vrmMat, result.textures.len)
      mat.sphereTextureIndex = sphIdx
      mat.sphereMode = sphMode
      # Check for _ShadeColor to determine toon sharing mode
      hasCustomToon = hasShadeColor(jsonData, vrmMat)
    else:
      mat.name = matName
      mat.englishName = matName

    # Mirror Python path: toon handling depends on _ShadeColor presence
    if hasCustomToon:
      # Non-shared: add individual toon texture
      let toonPath = "tex\\" & matName & "_TOON.bmp"
      result.textures.add(toonPath)
      mat.toonSharingFlag = int8(0)
      mat.toonTextureIndex = int32(result.textures.len - 1)
    else:
      # Shared: use default toon01.tga (index 1)
      mat.toonSharingFlag = int8(1)
      mat.toonTextureIndex = int32(1)

    result.materials.add(mat)

  # Build minimal bones from mapped glTF nodes.
  if result.boneCountHint > 0:
    result.bones = newSeq[PmxBoneLite](result.boneCountHint)
    var initialized = newSeq[bool](result.boneCountHint)
    var isStandardMapped = newSeq[bool](result.boneCountHint)

    for nodeIdx, boneIdx in nodeToBoneIdx:
      let b = int(boneIdx)
      if b < 0 or b >= result.bones.len:
        continue

      let node = jsonData["nodes"][nodeIdx]
      let nodeName = if node.hasKey("name"): node["name"].getStr("bone_" & $b) else: "bone_" & $b
      var boneName = nodeName
      var boneEnglishName = boneName
      if b >= 0 and b < BONE_PAIRS_JA.len:
        boneName = BONE_PAIRS_JA[b]
        boneEnglishName = BONE_PAIRS_EN[b]
      if b == 0:
        boneName = "全ての親"
        boneEnglishName = "Root"

      var bonePos = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
      if nodeIdx >= 0 and nodeIdx < nodeWorldMatrices.len:
        let wm = nodeWorldMatrices[nodeIdx]
        bonePos = Vec3f(
          x: float32(-wm[3 * 4 + 0] * float64(MIKU_METER)),
          y: float32(wm[3 * 4 + 1] * float64(MIKU_METER)),
          z: float32(wm[3 * 4 + 2] * float64(MIKU_METER)),
        )

      var parentIndex = int32(-1)
      if nodeIdx >= 0 and nodeIdx < nodeParents.len:
        let pNode = nodeParents[nodeIdx]
        if pNode >= 0 and nodeToBoneIdx.hasKey(pNode):
          parentIndex = nodeToBoneIdx[pNode]

      var tailIndex = int32(-1)
      if node.hasKey("children") and node["children"].kind == JArray:
        for child in node["children"]:
          let cNode = child.getInt(-1)
          if cNode >= 0 and nodeToBoneIdx.hasKey(cNode):
            tailIndex = nodeToBoneIdx[cNode]
            break

      # Match Python baseline root bone connection: "全ての親" -> "センター" (index 1)
      if b == 0 and result.bones.len > 1:
        tailIndex = int32(1)

      let initialFlag = pythonInitialBoneFlag(node, bonePairsLookup, nodeName, boneName, humanBoneNodes.getOrDefault(nodeIdx, false))

      result.bones[b] = PmxBoneLite(
        name: boneName,
        englishName: boneEnglishName,
        position: bonePos,
        parentIndex: parentIndex,
        layer: int32(0),
        flag: initialFlag,
        tailIndex: tailIndex,
        tailPosition: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      )
      initialized[b] = true
      isStandardMapped[b] = nodeName in bonePairsLookup or b == 0

    for i in 0 ..< result.bones.len:
      if initialized[i]:
        continue
      let fallbackJa = if i < BONE_PAIRS_JA.len: BONE_PAIRS_JA[i] else: "bone_" & $i
      let fallbackEn = if i < BONE_PAIRS_EN.len: BONE_PAIRS_EN[i] else: "bone_" & $i
      result.bones[i] = PmxBoneLite(
        name: fallbackJa,
        englishName: fallbackEn,
        position: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
        parentIndex: int32(-1),
        layer: int32(0),
        flag: int16(0x0001 or 0x0002 or 0x0004 or 0x0008 or 0x0010),
        tailIndex: int32(-1),
        tailPosition: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
      )

    # Match Python center/groove placement.
    # default_pairs index: 1=センター, 2=グルーブ, 3=腰, 85=左足, 86=左ひざ
    if result.bones.len > 3:
      result.bones[0].position = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

      # default_pairs: センター(parent=全ての親), グルーブ(parent=センター)
      result.bones[1].parentIndex = int32(0)
      result.bones[2].parentIndex = int32(1)

      # センター position: VRoid = 腰*0.7, generic = avg(leftLeg, leftKnee)
      if isVroidProfile(jsonData, modelName):
        let hipsPos = result.bones[3].position
        result.bones[1].position = Vec3f(x: 0'f32, y: hipsPos.y * 0.7'f32, z: 0'f32)
      elif result.bones.len > 86:
        let leftLegY = result.bones[85].position.y
        let leftKneeY = result.bones[86].position.y
        let centerY = (leftLegY + leftKneeY) / 2'f32
        result.bones[1].position = Vec3f(x: 0'f32, y: centerY, z: 0'f32)

      # グルーブ position: always センター.y * 1.025
      # Python processes グルーブ before 腰 is added to bones, so it always uses
      # the generic formula (センター.y * 1.025) regardless of profile.
      result.bones[2].position = Vec3f(x: 0'f32, y: result.bones[1].position.y * 1.025'f32, z: 0'f32)

      # センター: flag=0x1e (no tail-index bit = tail_pos mode), tail_pos=(0,-pos.y,0)
      result.bones[1].flag = int16(0x001e)
      result.bones[1].tailPosition = Vec3f(x: 0'f32, y: -result.bones[1].position.y, z: 0'f32)

      # グルーブ: flag=0x201e (0x2000=external-parent-deform | 0x1e), tail_pos mode
      result.bones[2].flag = int16(0x201e)
      result.bones[2].tailPosition = Vec3f(x: 0'f32, y: result.bones[1].position.y * 0.175'f32, z: 0'f32)

      for b in 0 ..< result.bones.len:
        if result.bones[b].name == "Hairs":
          result.bones[b].flag = int16(0x0003)
          result.bones[b].tailIndex = int32(-1)
          result.bones[b].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
          break

      # Apply standard bone parent/tail/flag from const tables for all 106 canonical bones.
      # Bones 1 (センター) and 2 (グルーブ) are already handled above; skip them.
      for b in 0 ..< min(BONE_PARENT_IDX.len, result.bones.len):
        if b == 1 or b == 2:
          continue
        let f = BONE_DEFAULT_FLAG[b]
        if b == 0 or initialized[b]:
          result.bones[b].flag = f
        else:
          # Python keeps placeholder standard bones at rotation-only until a later special-case override.
          result.bones[b].flag = int16(0x0002)
        result.bones[b].parentIndex = BONE_PARENT_IDX[b]
        if (int(f) and 0x0001) != 0:
          result.bones[b].tailIndex = BONE_TAIL_IDX[b]
          result.bones[b].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
        else:
          result.bones[b].tailIndex = int32(-1)
          result.bones[b].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

        if result.bones[b].name.endsWith("先"):
          result.bones[b].flag = int16(0x0003)
          result.bones[b].tailIndex = int32(-1)
          result.bones[b].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

      # 肩C bones: append rotation from 肩P (flag & 0x0100)
      if result.bones.len > 52:
        # 肩P/肩C positions follow 肩 position
        result.bones[16].position = result.bones[17].position
        result.bones[18].position = result.bones[17].position
        result.bones[50].position = result.bones[51].position
        result.bones[52].position = result.bones[51].position

        # Python custom_bones post-processes these placeholders explicitly.
        for shoulderPIdx in [16, 50]:
          result.bones[shoulderPIdx].flag = int16(0x001a)
          result.bones[shoulderPIdx].tailIndex = int32(-1)
          result.bones[shoulderPIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

        for shoulderCIdx in [18, 52]:
          result.bones[shoulderCIdx].flag = int16(0x0102)
          result.bones[shoulderCIdx].tailIndex = int32(-1)
          result.bones[shoulderCIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

        result.bones[18].appendBoneIndex = int32(16)  # 左肩C → 左肩P
        result.bones[18].appendRatio = -1'f32
        result.bones[52].appendBoneIndex = int32(50)  # 右肩C → 右肩P
        result.bones[52].appendRatio = -1'f32

      # 下半身: tail_pos mode, tail = 腰 - 下半身
      if result.bones.len > 4:
        if result.bones[3].position.x == 0'f32:
          result.bones[3].position.x = -0'f32
        result.bones[4].flag = int16(0x001a)
        result.bones[4].tailIndex = int32(-1)
        if hasPrecisePos.len > 4 and hasPrecisePos[3] and hasPrecisePos[4]:
          let preciseTail = vecSubD(precisePos[3], precisePos[4])
          result.bones[4].tailPosition = vec3dToVec3f(preciseTail)
          preciseTailPos[4] = preciseTail
          hasPreciseTailPos[4] = true
        else:
          result.bones[4].tailPosition = vecSub(result.bones[3].position, result.bones[4].position)

      # 頭: tail_pos=(0,1,0)
      if result.bones.len > 8:
        result.bones[8].flag = int16(0x001a)
        result.bones[8].tailIndex = int32(-1)
        result.bones[8].tailPosition = Vec3f(x: 0'f32, y: 1'f32, z: 0'f32)

      # 両目 and 左右目 append behavior
      if result.bones.len > 11:
        template bp(i: int): Vec3d =
          (if i >= 0 and i < hasPrecisePos.len and hasPrecisePos[i]: precisePos[i]
           else: (x: float64(result.bones[i].position.x), y: float64(result.bones[i].position.y), z: float64(result.bones[i].position.z)))

        result.bones[9].flag = int16(0x001a)
        if isVroidProfile(jsonData, modelName):
          let leftEye = bp(10)
          let rightEye = bp(11)
          if (leftEye.x != 0.0 or leftEye.y != 0.0 or leftEye.z != 0.0 or
              rightEye.x != 0.0 or rightEye.y != 0.0 or rightEye.z != 0.0):
            result.bones[9].position = vec3dToVec3f(vecAddD(leftEye, vecScaleD(vecSubD(rightEye, leftEye), 0.5)))
          else:
            let head = bp(8)
            let neck = bp(7)
            let both = bp(9)
            result.bones[9].position = Vec3f(
              x: 0'f32,
              y: float32(head.y + (head.y - neck.y) * 3.0),
              z: float32(both.z * 2.0),
            )
        else:
          let head = bp(8)
          let neck = bp(7)
          let both = bp(9)
          result.bones[9].position = Vec3f(
            x: 0'f32,
            y: float32(head.y + (head.y - neck.y) * 3.0),
            z: float32(both.z * 2.0),
          )
        result.bones[9].tailIndex = int32(-1)
        result.bones[9].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: -1'f32)

        for eyeIdx in [10, 11]:
          result.bones[eyeIdx].flag = int16(0x011a)
          result.bones[eyeIdx].tailIndex = int32(-1)
          result.bones[eyeIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: -1'f32)
          result.bones[eyeIdx].appendBoneIndex = int32(9)
          result.bones[eyeIdx].appendRatio = 1'f32

      # 腰キャンセル: append from 腰, position matches 足
      if result.bones.len > 92:
        result.bones[84].flag = int16(0x0102)
        result.bones[84].position = result.bones[85].position
        result.bones[84].tailIndex = int32(-1)
        result.bones[84].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
        result.bones[84].appendBoneIndex = int32(3)
        result.bones[84].appendRatio = -1'f32

        result.bones[91].flag = int16(0x0102)
        result.bones[91].position = result.bones[92].position
        result.bones[91].tailIndex = int32(-1)
        result.bones[91].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
        result.bones[91].appendBoneIndex = int32(3)
        result.bones[91].appendRatio = -1'f32

      # 指先 bones: flag=0x0002, tail_pos=(0,0,0), and fallback position when missing.
      if result.bones.len > 83:
        for tipIdx in [33, 37, 41, 45, 49, 67, 71, 75, 79, 83]:
          result.bones[tipIdx].flag = int16(0x0002)
          result.bones[tipIdx].tailIndex = int32(-1)
          result.bones[tipIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
          if result.bones[tipIdx].position == Vec3f(x: 0'f32, y: 0'f32, z: 0'f32):
            let parentIdx = int(BONE_PARENT_IDX[tipIdx])
            if parentIdx >= 0 and parentIdx < result.bones.len:
              let parentPrecise =
                if parentIdx < hasPrecisePos.len and hasPrecisePos[parentIdx]:
                  precisePos[parentIdx]
                else:
                  (x: float64(result.bones[parentIdx].position.x), y: float64(result.bones[parentIdx].position.y), z: float64(result.bones[parentIdx].position.z))
              let sx = if parentPrecise.x > 0.0: 1.0 elif parentPrecise.x < 0.0: -1.0 else: 0.0
              result.bones[tipIdx].position = Vec3f(
                x: float32(parentPrecise.x + sx),
                y: float32(parentPrecise.y),
                z: float32(parentPrecise.z),
              )

      # Python renames HairJoint chains after bone construction.
      var hairIdx = 1
      for boneIdx in 0 ..< result.bones.len:
        let currentEnglishName = result.bones[boneIdx].englishName
        if "HairJoint" notin currentEnglishName:
          continue
        if result.bones[boneIdx].parentIndex == int32(8):
          result.bones[boneIdx].name = "髪_" & align($hairIdx, 2, '0') & "_01"
          inc hairIdx
        elif result.bones[boneIdx].parentIndex >= 0:
          let parentIdx = int(result.bones[boneIdx].parentIndex)
          if parentIdx >= 0 and parentIdx < result.bones.len:
            let parentName = result.bones[parentIdx].name
            let parentParts = parentName.split("_")
            if parentParts.len >= 3 and parentParts[0] == "髪":
              try:
                let parentSuffix = parseInt(parentParts[^1])
                result.bones[boneIdx].name = "髪_" & parentParts[1] & "_" & align($(parentSuffix + 1), 2, '0')
              except ValueError:
                discard

      # Python finalize step for non-standard bones: tail-less endpoints become rotate-only.
      for i in 0 ..< result.bones.len:
        if not initialized[i] or isStandardMapped[i]:
          continue
        if result.bones[i].tailIndex == int32(-1) and result.bones[i].tailPosition == Vec3f(x: 0'f32, y: 0'f32, z: 0'f32):
          result.bones[i].flag = int16(0x0003)

      # 足IK / つま先IK: Python create_bone_leg_ik と同じ動的上書き
      if result.bones.len > 97:
        for (legIdx, kneeIdx, ankleIdx, toeIdx, legIkIdx, toeIkIdx) in [
          (85, 86, 87, 88, 89, 90),
          (92, 93, 94, 95, 96, 97),
        ]:
          result.bones[legIkIdx].parentIndex = int32(0)
          result.bones[legIkIdx].layer = int32(0)
          result.bones[legIkIdx].position = result.bones[ankleIdx].position
          result.bones[legIkIdx].flag = int16(0x003e)
          result.bones[legIkIdx].tailIndex = int32(-1)
          result.bones[legIkIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 1'f32)
          result.bones[legIkIdx].ik = PmxIkLite(
            targetIndex: int32(ankleIdx),
            loopCount: int32(40),
            limitRadian: 1'f32,
            links: @[
              PmxIkLinkLite(
                boneIndex: int32(kneeIdx),
                limitAngle: int8(1),
                limitMin: Vec3f(x: -PI.float32, y: 0'f32, z: 0'f32),
                limitMax: Vec3f(x: degToRad(-0.5).float32, y: 0'f32, z: 0'f32),
              ),
              PmxIkLinkLite(
                boneIndex: int32(legIdx),
                limitAngle: int8(0),
                limitMin: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
                limitMax: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
              ),
            ],
          )

          result.bones[toeIkIdx].parentIndex = int32(legIkIdx)
          result.bones[toeIkIdx].layer = int32(0)
          result.bones[toeIkIdx].position = result.bones[toeIdx].position
          result.bones[toeIkIdx].flag = int16(0x003e)
          result.bones[toeIkIdx].tailIndex = int32(-1)
          result.bones[toeIkIdx].tailPosition = Vec3f(x: 0'f32, y: -1'f32, z: 0'f32)
          result.bones[toeIkIdx].ik = PmxIkLite(
            targetIndex: int32(toeIdx),
            loopCount: int32(40),
            limitRadian: 1'f32,
            links: @[
              PmxIkLinkLite(
                boneIndex: int32(ankleIdx),
                limitAngle: int8(0),
                limitMin: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
                limitMax: Vec3f(x: 0'f32, y: 0'f32, z: 0'f32),
              ),
            ],
          )

      # D bones: layer=1, append from parent (without D)
      if result.bones.len > 105:
        for (dIdx, parentIdx) in [(98, 85), (99, 86), (100, 87), (102, 92), (103, 93), (104, 94)]:
          result.bones[dIdx].position = result.bones[parentIdx].position
          result.bones[dIdx].layer = int32(1)
          result.bones[dIdx].flag = int16(0x011a)
          result.bones[dIdx].tailIndex = int32(-1)
          result.bones[dIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
          result.bones[dIdx].appendBoneIndex = int32(parentIdx)
          result.bones[dIdx].appendRatio = 1'f32

        # 足先EX: layer=1, tail_pos mode
        for exIdx in [101, 105]:
          result.bones[exIdx].layer = int32(1)
          result.bones[exIdx].flag = int16(0x001a)
          result.bones[exIdx].tailIndex = int32(-1)
          result.bones[exIdx].tailPosition = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

      # 手首: tail_pos = normalize(手首 - ひじ)
      if result.bones.len > 63:
        for (wristIdx, elbowIdx) in [(29, 24), (63, 58)]:
          result.bones[wristIdx].flag = int16(0x001a)
          result.bones[wristIdx].tailIndex = int32(-1)
          result.bones[wristIdx].tailPosition = vecNormalize(vecSub(result.bones[wristIdx].position, result.bones[elbowIdx].position))

      # Arm/Wrist twist + local/fixed axis metadata
      applyArmTwistLayout(result.bones, "左", precisePos, hasPrecisePos)
      applyArmTwistLayout(result.bones, "右", precisePos, hasPrecisePos)

      # Python final wrist rule overrides local-axis addition from twist setup.
      if result.bones.len > 63:
        for (wristIdx, elbowIdx) in [(29, 24), (63, 58)]:
          result.bones[wristIdx].flag = int16(0x001a)
          result.bones[wristIdx].tailIndex = int32(-1)
          if wristIdx < hasPrecisePos.len and elbowIdx < hasPrecisePos.len and hasPrecisePos[wristIdx] and hasPrecisePos[elbowIdx]:
            let preciseTail = vecNormD(vecSubD(precisePos[wristIdx], precisePos[elbowIdx]))
            result.bones[wristIdx].tailPosition = vec3dToVec3f(preciseTail)
            preciseTailPos[wristIdx] = preciseTail
            hasPreciseTailPos[wristIdx] = true
          else:
            result.bones[wristIdx].tailPosition = vecNormalize(vecSub(result.bones[wristIdx].position, result.bones[elbowIdx].position))
          result.bones[wristIdx].localXAxis = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
          result.bones[wristIdx].localZAxis = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)

      result.preciseTailPositions = preciseTailPos
      result.hasPreciseTailPositions = hasPreciseTailPos
      buildDisplaySlots(result)
      buildStandardPhysics(result)

proc main() =
  let args = commandLineParams()
  if args.len < 2:
    echo "Usage: nim_pmx_lite <input.vrm|input.glb> <output.pmx>"
    quit(1)

  let inputPath = args[0]
  let outputPath = args[1]

  if not fileExists(inputPath):
    echo "Error: input not found: " & inputPath
    quit(1)

  let bytes = cast[seq[uint8]](readFile(inputPath))
  let glb = parseGlb(bytes)
  let model = buildModelFromGlb(glb.jsonData, glb.binData, "source")
  let pmxBytes = buildPmxBinaryLite(model)

  writeFile(outputPath, cast[string](pmxBytes))

  echo "Wrote PMX Lite: " & outputPath
  echo "  vertices=" & $model.vertices.len
  echo "  indices=" & $model.indices.len
  echo "  materials=" & $model.materials.len

proc convertGlbBytesToPmxBytes(inputBytes: openArray[uint8], modelName: string = "source"): seq[uint8] =
  let glb = parseGlb(inputBytes)
  let model = buildModelFromGlb(glb.jsonData, glb.binData, modelName)
  result = buildPmxBinaryLite(model)

proc init*(): int32 {.exportc: "nim_wasm_init", cdecl.} =
  gLastErrorMsg = ""
  return CONVERT_OK

proc allocBuffer*(size: int32): pointer {.exportc: "nim_wasm_alloc", cdecl.} =
  if size <= 0:
    return nil
  return allocShared(int(size))

proc freeBuffer*(p: pointer) {.exportc: "nim_wasm_free", cdecl.} =
  if p != nil:
    deallocShared(p)

proc lastErrorLen*(): int32 {.exportc: "nim_wasm_last_error_len", cdecl.} =
  return int32(gLastErrorMsg.len)

proc copyLastError*(outPtr: pointer, outLen: int32): int32 {.exportc: "nim_wasm_copy_last_error", cdecl.} =
  if outPtr == nil or outLen <= 0:
    return int32(0)
  let actual = min(gLastErrorMsg.len, int(outLen))
  if actual <= 0:
    return int32(0)
  copyMem(outPtr, unsafeAddr gLastErrorMsg[0], actual)
  return int32(actual)

proc convert*(ptrIn: pointer, lenIn: int32, ptrOutMeta: pointer): int32 {.exportc: "nim_wasm_convert", cdecl.} =
  let meta = cast[ptr ConvertResultMeta](ptrOutMeta)
  if ptrIn == nil or lenIn <= 0:
    return setError(meta, CONVERT_ERR_INVALID_ARG, "invalid input buffer")

  if meta == nil:
    return CONVERT_ERR_INVALID_ARG

  try:
    let inputLen = int(lenIn)
    var inputBytes = newSeq[uint8](inputLen)
    copyMem(addr inputBytes[0], ptrIn, inputLen)

    let pmxBytes = convertGlbBytesToPmxBytes(inputBytes, "source")
    if pmxBytes.len == 0:
      return setError(meta, CONVERT_ERR_BUILD, "empty PMX output")

    let outMem = allocShared(pmxBytes.len)
    if outMem == nil:
      return setError(meta, CONVERT_ERR_ALLOC, "output allocation failed")

    copyMem(outMem, unsafeAddr pmxBytes[0], pmxBytes.len)

    meta[].outPtr = cast[uint](outMem).uint32
    meta[].outLen = int32(pmxBytes.len)
    meta[].status = CONVERT_OK
    meta[].errorCode = CONVERT_OK
    gLastErrorMsg = ""
    return CONVERT_OK
  except CatchableError as e:
    return setError(meta, CONVERT_ERR_PARSE, e.msg)

when isMainModule:
  main()
