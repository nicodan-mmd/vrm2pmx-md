import std/[json, os, strutils, uri, tables, sequtils, algorithm]
import glb_parser, accessor, pmx_writer_lite

const MIKU_METER = 12.5'f32

type Matrix4d = array[16, float64]

proc matIdentity(): Matrix4d =
  result = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
  ]

proc matMulColMajor(a, b: Matrix4d): Matrix4d =
  for c in 0 ..< 4:
    for r in 0 ..< 4:
      var s = 0.0
      for k in 0 ..< 4:
        s += a[k * 4 + r] * b[c * 4 + k]
      result[c * 4 + r] = s

proc matVecMulColMajor(m: Matrix4d, v: array[4, float64]): array[4, float64] =
  for r in 0 ..< 4:
    result[r] =
      m[0 * 4 + r] * v[0] +
      m[1 * 4 + r] * v[1] +
      m[2 * 4 + r] * v[2] +
      m[3 * 4 + r] * v[3]

proc quatToMat3(qx, qy, qz, qw: float64): array[9, float64] =
  result = [
    1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy - qz * qw), 2.0 * (qx * qz + qy * qw),
    2.0 * (qx * qy + qz * qw), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz - qx * qw),
    2.0 * (qx * qz - qy * qw), 2.0 * (qy * qz + qx * qw), 1.0 - 2.0 * (qx * qx + qy * qy),
  ]

proc nodeLocalMatrixColMajor(node: JsonNode): Matrix4d =
  if node.hasKey("matrix") and node["matrix"].kind == JArray and node["matrix"].len == 16:
    for i in 0 ..< 16:
      result[i] = node["matrix"][i].getFloat(0.0)
    return result

  let tx = if node.hasKey("translation") and node["translation"].len >= 3: node["translation"][0].getFloat(0.0) else: 0.0
  let ty = if node.hasKey("translation") and node["translation"].len >= 3: node["translation"][1].getFloat(0.0) else: 0.0
  let tz = if node.hasKey("translation") and node["translation"].len >= 3: node["translation"][2].getFloat(0.0) else: 0.0

  let qx = if node.hasKey("rotation") and node["rotation"].len >= 4: node["rotation"][0].getFloat(0.0) else: 0.0
  let qy = if node.hasKey("rotation") and node["rotation"].len >= 4: node["rotation"][1].getFloat(0.0) else: 0.0
  let qz = if node.hasKey("rotation") and node["rotation"].len >= 4: node["rotation"][2].getFloat(0.0) else: 0.0
  let qw = if node.hasKey("rotation") and node["rotation"].len >= 4: node["rotation"][3].getFloat(1.0) else: 1.0

  let sx = if node.hasKey("scale") and node["scale"].len >= 3: node["scale"][0].getFloat(1.0) else: 1.0
  let sy = if node.hasKey("scale") and node["scale"].len >= 3: node["scale"][1].getFloat(1.0) else: 1.0
  let sz = if node.hasKey("scale") and node["scale"].len >= 3: node["scale"][2].getFloat(1.0) else: 1.0

  let rot = quatToMat3(qx, qy, qz, qw)
  result = matIdentity()
  # upper-left 3x3 in column-major (R @ diag(S))
  result[0] = rot[0] * sx; result[1] = rot[3] * sx; result[2] = rot[6] * sx
  result[4] = rot[1] * sy; result[5] = rot[4] * sy; result[6] = rot[7] * sy
  result[8] = rot[2] * sz; result[9] = rot[5] * sz; result[10] = rot[8] * sz
  result[12] = tx; result[13] = ty; result[14] = tz

proc buildNodeWorldMatrices(jsonData: JsonNode): seq[Matrix4d] =
  if not jsonData.hasKey("nodes"):
    return @[]

  let nodes = jsonData["nodes"]
  let n = nodes.len
  var local = newSeq[Matrix4d](n)
  var parents = newSeq[int](n)
  var world = newSeq[Matrix4d](n)
  var resolved = newSeq[bool](n)

  for i in 0 ..< n:
    local[i] = nodeLocalMatrixColMajor(nodes[i])
    parents[i] = -1

  for p in 0 ..< n:
    if nodes[p].hasKey("children"):
      for ch in nodes[p]["children"]:
        let c = ch.getInt(-1)
        if c >= 0 and c < n:
          parents[c] = p

  proc resolveWorld(i: int): Matrix4d =
    if resolved[i]:
      return world[i]
    if parents[i] >= 0:
      world[i] = matMulColMajor(resolveWorld(parents[i]), local[i])
    else:
      world[i] = local[i]
    resolved[i] = true
    return world[i]

  for i in 0 ..< n:
    discard resolveWorld(i)
  return world

proc getSkinIndexForMesh(jsonData: JsonNode, meshIdx: int): int =
  if not jsonData.hasKey("nodes"):
    return -1
  for nd in jsonData["nodes"]:
    if nd.hasKey("mesh") and nd["mesh"].getInt(-1) == meshIdx and nd.hasKey("skin"):
      return nd["skin"].getInt(-1)
  return -1

proc getSkinJoints(jsonData: JsonNode, skinIdx: int): seq[int] =
  if skinIdx < 0 or not jsonData.hasKey("skins") or skinIdx >= jsonData["skins"].len:
    return @[]
  let skin = jsonData["skins"][skinIdx]
  if not skin.hasKey("joints"):
    return @[]
  for j in skin["joints"]:
    result.add(j.getInt(-1))

proc getSkinInverseBindMatrices(jsonData: JsonNode, binData: openArray[uint8], skinIdx: int): seq[Matrix4d] =
  if skinIdx < 0 or not jsonData.hasKey("skins") or skinIdx >= jsonData["skins"].len:
    return @[]
  let skin = jsonData["skins"][skinIdx]
  if not skin.hasKey("inverseBindMatrices"):
    return @[]
  let accessorIdx = skin["inverseBindMatrices"].getInt(-1)
  let mats = readAccessorMat4Float(jsonData, binData, accessorIdx)
  result = newSeq[Matrix4d](mats.len)
  for i in 0 ..< mats.len:
    for j in 0 ..< 16:
      result[i][j] = float64(mats[i][j])

proc applySkinningPose(
  position: Vector3D,
  joints: (int, int, int, int),
  weights: (float32, float32, float32, float32),
  skinJoints: seq[int],
  inverseBindMatrices: seq[Matrix4d],
  nodeWorldMatrices: seq[Matrix4d],
): tuple[x, y, z: float64] =
  if skinJoints.len == 0 or nodeWorldMatrices.len == 0:
    return (float64(position.x), float64(position.y), float64(position.z))

  let jArr = [joints[0], joints[1], joints[2], joints[3]]
  let wArr = [weights[0], weights[1], weights[2], weights[3]]
  let source = [float64(position.x), float64(position.y), float64(position.z), 1.0]

  var skinned = [0.0, 0.0, 0.0, 0.0]
  var totalWeight = 0.0

  for i in 0 .. 3:
    let w = float64(wArr[i])
    if w <= 0.0:
      continue
    let j = jArr[i]
    if j < 0 or j >= skinJoints.len:
      continue
    let nodeIdx = skinJoints[j]
    if nodeIdx < 0 or nodeIdx >= nodeWorldMatrices.len:
      continue

    let bindMat = if j < inverseBindMatrices.len: inverseBindMatrices[j] else: matIdentity()
    let p = matVecMulColMajor(nodeWorldMatrices[nodeIdx], matVecMulColMajor(bindMat, source))
    for k in 0 ..< 4:
      skinned[k] += w * p[k]
    totalWeight += w

  if totalWeight <= 0.0:
    return (float64(position.x), float64(position.y), float64(position.z))
  return (
    skinned[0] / totalWeight,
    skinned[1] / totalWeight,
    skinned[2] / totalWeight,
  )

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

proc buildDeform(
  joints: (int, int, int, int),
  weights: (float32, float32, float32, float32),
  skinJoints: seq[int],
  nodeToBoneIdx: Table[int, int32],
): PmxDeformLite =
  ## Build PMX deform data from JOINTS_0/WEIGHTS_0 for a single vertex.
  ## - filter weight>0
  ## - map to PMX bone index
  ## - merge duplicate bones and normalize weights
  ## - fit to PMX BDEF constraints (1/2/4)
  var jointWeights = initOrderedTable[int32, float64]()

  let jArr = [joints[0], joints[1], joints[2], joints[3]]
  let wArr = [weights[0], weights[1], weights[2], weights[3]]

  for i in 0 .. 3:
    if wArr[i] <= 0'f32:
      continue
    let j = jArr[i]
    if j < 0 or j >= skinJoints.len:
      continue
    let nodeIdx = skinJoints[j]
    let pmxBone = nodeToBoneIdx.getOrDefault(nodeIdx, int32(0))
    let w = float64(wArr[i])
    if jointWeights.hasKey(pmxBone):
      jointWeights[pmxBone] = jointWeights[pmxBone] + w
    else:
      jointWeights[pmxBone] = w

  if jointWeights.len == 0:
    return makeBdef1(0)

  var bones: seq[int32] = @[]
  var weightsNorm: seq[float64] = @[]
  var total = 0.0
  for _, w in jointWeights:
    total += w

  if total <= 0.0:
    return makeBdef1(0)

  for b, w in jointWeights:
    bones.add(b)
    weightsNorm.add(w / total)

  if bones.len == 3:
    bones.add(0)
    weightsNorm.add(0.0)
  elif bones.len > 4:
    var minIdx = 0
    var minW = weightsNorm[0]
    for i in 1 ..< weightsNorm.len:
      if weightsNorm[i] < minW:
        minW = weightsNorm[i]
        minIdx = i
    bones.delete(minIdx)
    weightsNorm.delete(minIdx)

    var total2 = 0.0
    for w in weightsNorm:
      total2 += w
    if total2 > 0.0:
      for i in 0 ..< weightsNorm.len:
        weightsNorm[i] = weightsNorm[i] / total2

  case bones.len
  of 0:
    return makeBdef1(0)
  of 1:
    return makeBdef1(bones[0])
  of 2:
    return makeBdef2(bones[0], bones[1], float32(weightsNorm[0]))
  else:
    # Bdef4: pad to 4 entries
    let b0 = bones[0]
    let b1 = if bones.len > 1: bones[1] else: int32(0)
    let b2 = if bones.len > 2: bones[2] else: int32(0)
    let b3 = if bones.len > 3: bones[3] else: int32(0)
    let w0 = float32(weightsNorm[0])
    let w1 = if weightsNorm.len > 1: float32(weightsNorm[1]) else: 0'f32
    let w2 = if weightsNorm.len > 2: float32(weightsNorm[2]) else: 0'f32
    let w3 = if weightsNorm.len > 3: float32(weightsNorm[3]) else: 0'f32
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

proc readModelMetadata(jsonData: JsonNode, fallbackName: string): tuple[name, author, licenseName, licenseComment: string] =
  result = (fallbackName, "", "", "")

  if jsonData.kind != JObject or not jsonData.hasKey("extensions") or jsonData["extensions"].kind != JObject:
    return

  let ext = jsonData["extensions"]
  if ext.hasKey("VRM"):
    let vrm = ext["VRM"]
    if vrm.kind == JObject and vrm.hasKey("meta") and vrm["meta"].kind == JObject:
      let meta = vrm["meta"]
      let title = if meta.hasKey("title"): meta["title"].getStr("") else: ""
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
      result.name = if title.len > 0: title else: fallbackName
      if meta.hasKey("authors") and meta["authors"].kind == JArray:
        result.author = meta["authors"].elems.mapIt(it.getStr("")).join(", ")
      result.licenseName = if meta.hasKey("licenseUrl"): meta["licenseUrl"].getStr("") else: ""

proc readVec3(jsonData: JsonNode, binData: openArray[uint8], accessorIdx: int): seq[Vector3D] =
  if accessorIdx < 0:
    return @[]
  return readAccessor(jsonData, binData, accessorIdx)

proc mimeToExt(mime: string): string =
  let m = mime.toLowerAscii()
  if m == "image/png":
    return "png"
  if m == "image/jpeg":
    return "jpg"
  if m == "image/bmp":
    return "bmp"
  if m == "image/webp":
    return "webp"
  return "png"

proc buildModelFromGlb(jsonData: JsonNode, binData: openArray[uint8], modelName: string): PmxModelLite =
  let meta = readModelMetadata(jsonData, modelName)
  result.name = meta.name
  result.englishName = ""
  result.comment = "モデル名: " & meta.name & "\r\n" &
    "作者: " & meta.author & "\r\n" &
    "ライセンス: " & meta.licenseName & "\r\n" &
    meta.licenseComment & "\r\n" &
    "変換: VRM to MMD Converter - Version nim-bitperfect-baseline  (@nicodan-mmd)"
  result.englishComment = ""
  result.vertices = @[]
  result.indices = @[]
  result.textures = @[]
  result.materials = @[]
  result.boneCountHint = if jsonData.kind == JObject and jsonData.hasKey("nodes"): jsonData["nodes"].len else: 0
  result.morphCountHint = estimateMorphCount(jsonData)
  result.rigidbodyCountHint = estimateRigidbodyCount(jsonData)

  if not jsonData.hasKey("meshes"):
    return

  # Python path compatibility: texture slot 0 is reserved as empty.
  result.textures.add("")

  # Build PMX texture list from glTF images in source order.
  if jsonData.hasKey("images"):
    for i, img in jsonData["images"].elems:
      let baseName = if img.hasKey("name") and img["name"].kind == JString and img["name"].getStr("").len > 0:
                       img["name"].getStr("")
                     else:
                       "image_" & $i
      let ext = if img.hasKey("mimeType"): mimeToExt(img["mimeType"].getStr("")) else: "png"
      result.textures.add("tex\\" & baseName & "." & ext)

  # Build bone lookup tables
  let bonePairsLookup = buildBonePairsLookup()
  let nodeToBoneIdx = buildNodeToPmxBoneIndex(jsonData, bonePairsLookup)
  let nodeWorldMatrices = buildNodeWorldMatrices(jsonData)

  # POSITION accessor dedup: accessor_idx -> vertex start index
  var processedAccessors = initTable[int, int32]()

  # Dedup: also track which JOINTS_0/WEIGHTS_0/NORMAL/TEXCOORD were used per POSITION accessor
  # to avoid re-reading them. Stored as (joints, weights) lists alongside vertex start.
  # Per-material index accumulator (ordered by first appearance)
  var materialIndices = initOrderedTable[int, seq[int32]]()

  for meshIdx, mesh in jsonData["meshes"].elems:
    if not mesh.hasKey("primitives"):
      continue

    # Get skin data for this mesh (same for all primitives of this mesh)
    let skinIdx = getSkinIndexForMesh(jsonData, meshIdx)
    let skinJoints = getSkinJoints(jsonData, skinIdx)
    let inverseBindMatrices = getSkinInverseBindMatrices(jsonData, binData, skinIdx)

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

        for i, p in positions:
          let n = if i < normals.len: normals[i] else: (x: 0'f32, y: 1'f32, z: 0'f32)
          let uvRaw = if i < uvs.len: uvs[i] else: (x: 0'f32, y: 0'f32, z: 0'f32)

          # Apply skinning pose before MMD coordinate transform.
          # Build deform data
          var deform: PmxDeformLite
          let posedP = if i < jointsData.len and i < weightsData.len:
                        applySkinningPose(positions[i], jointsData[i], weightsData[i], skinJoints, inverseBindMatrices, nodeWorldMatrices)
                      else:
                        (float64(positions[i].x), float64(positions[i].y), float64(positions[i].z))
          if i < jointsData.len and i < weightsData.len and skinJoints.len > 0:
            deform = buildDeform(jointsData[i], weightsData[i], skinJoints, nodeToBoneIdx)
          else:
            deform = makeBdef1(0)

          result.vertices.add(PmxVertexLite(
            position: Vec3f(
              x: float32(-posedP.x * 12.5),
              y: float32(posedP.y * 12.5),
              z: float32(posedP.z * 12.5),
            ),
            normal: Vec3f(x: -n.x, y: n.y, z: n.z),
            uv: Vec2f(x: uvRaw.x, y: uvRaw.y),
            deform: deform,
            edgeFactor: 1'f32,
          ))

      # Collect indices for this material
      if prim.hasKey("indices"):
          let localIndices = readIndices(jsonData, binData, prim["indices"].getInt(-1))
          # Match Python path: reverse winding per triangle (2,1,0).
          var i = 0
          while i + 2 < localIndices.len:
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i + 2]))
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i + 1]))
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i]))
            i += 3
          # Fallback for non-triangle tail (should not usually occur).
          while i < localIndices.len:
            materialIndices[matIdx].add(vertexStartIdx + int32(localIndices[i]))
            inc(i)

  # Flatten indices per material in insertion order
  for matIdx, idxList in materialIndices:
    for idx in idxList:
      result.indices.add(idx)

  # Build one material per GLB material index (in order of first appearance)
  let hasMaterials = jsonData.hasKey("materials")
  let hasTextures = jsonData.hasKey("textures")
  let hasVrmMatProps =
    jsonData.hasKey("extensions") and
    jsonData["extensions"].kind == JObject and
    jsonData["extensions"].hasKey("VRM") and
    jsonData["extensions"]["VRM"].kind == JObject and
    jsonData["extensions"]["VRM"].hasKey("materialProperties") and
    jsonData["extensions"]["VRM"]["materialProperties"].kind == JArray

  for matIdx, idxList in materialIndices:
    let idxCount = int32(idxList.len)
    var mat = defaultMaterial(idxCount)
    if hasMaterials and matIdx < jsonData["materials"].len:
      let vrmMat = jsonData["materials"][matIdx]
      let matName = vrmMat["name"].getStr("mat_" & $matIdx)
      mat.name = matName
      mat.englishName = matName

      # Base color texture -> PMX texture index (with +1 reserved empty slot)
      if hasTextures and vrmMat.hasKey("pbrMetallicRoughness"):
        let pbr = vrmMat["pbrMetallicRoughness"]
        if pbr.hasKey("baseColorTexture"):
          let texRef = pbr["baseColorTexture"]
          if texRef.hasKey("index"):
            let texIdx = texRef["index"].getInt(-1)
            if texIdx >= 0 and texIdx < jsonData["textures"].len:
              let tx = jsonData["textures"][texIdx]
              if tx.hasKey("source"):
                let srcIdx = tx["source"].getInt(-1)
                let pmxTexIdx = srcIdx + 1
                if pmxTexIdx >= 0 and pmxTexIdx < result.textures.len:
                  mat.textureIndex = int32(pmxTexIdx)

      # VRM0 MToon shade color -> generate dedicated toon texture slot.
      if hasVrmMatProps and matIdx < jsonData["extensions"]["VRM"]["materialProperties"].len:
        let mp = jsonData["extensions"]["VRM"]["materialProperties"][matIdx]
        if mp.kind == JObject and mp.hasKey("vectorProperties"):
          let vp = mp["vectorProperties"]
          if vp.kind == JObject and vp.hasKey("_ShadeColor"):
            let toonName = "tex\\" & matName & "_TOON.bmp"
            result.textures.add(toonName)
            mat.toonSharingFlag = int8(0)
            mat.toonTextureIndex = int32(result.textures.len - 1)

    else:
      mat.name = "mat_" & $matIdx
      mat.englishName = "mat_" & $matIdx
    result.materials.add(mat)

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
  let model = buildModelFromGlb(glb.jsonData, glb.binData, splitFile(inputPath).name)
  let pmxBytes = buildPmxBinaryLite(model)

  writeFile(outputPath, cast[string](pmxBytes))

  echo "Wrote PMX Lite: " & outputPath
  echo "  vertices=" & $model.vertices.len
  echo "  indices=" & $model.indices.len
  echo "  materials=" & $model.materials.len

when isMainModule:
  main()
