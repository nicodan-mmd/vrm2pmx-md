import std/[json, os, strutils, uri, tables, sequtils, algorithm]
import glb_parser, accessor, pmx_writer_lite

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
  result.textures = buildPmxTextureList(jsonData)
  result.materials = @[]

  if not jsonData.hasKey("meshes"):
    return

  # Build bone lookup tables
  let bonePairsLookup = buildBonePairsLookup()
  let nodeToBoneIdx = buildNodeToPmxBoneIndex(jsonData, bonePairsLookup)
  let nodeWorldMatrices = buildNodeWorldMatrices(jsonData)
  let boneWorldXs = buildBoneWorldXs(jsonData, nodeToBoneIdx)
  result.boneCountHint = estimateBoneCountHint(nodeToBoneIdx)
  result.morphCountHint = estimateMorphCount(jsonData)
  result.rigidbodyCountHint = estimateRigidbodyCount(jsonData)

  # POSITION accessor dedup: accessor_idx -> vertex start index
  var processedAccessors = initTable[int, int32]()

  # Dedup: also track which JOINTS_0/WEIGHTS_0/NORMAL/TEXCOORD were used per POSITION accessor
  # to avoid re-reading them. Stored as (joints, weights) lists alongside vertex start.
  # Per-material index accumulator (ordered by first appearance)
  var materialIndices = initOrderedTable[int, seq[int32]]()

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
