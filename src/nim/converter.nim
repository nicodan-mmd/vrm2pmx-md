# VRM to PMX Converter (NIM PoC)
# Counts vertices, faces, bones, morphs from VRM/GLB

import std/[json, tables, sequtils, math]
import glb_parser, accessor

type
  ConversionResult* = object
    vertices*: int
    faces*: int
    bones*: int
    morphs*: int
    materials*: int
    textures*: int
    rigidbodies*: int
    joints*: int
    errorMsg*: string

const MIKU_METER = 0.08'f32  # 10cm → 8mm conversion

# Count bones by traversing VRM skeleton
proc countBones*(jsonData: JsonNode): int =
  # Count all nodes that could be bones
  result = 0
  if "nodes" in jsonData:
    result = jsonData["nodes"].len

# Count morphs from VRM Expressions
proc countMorphs*(jsonData: JsonNode): int =
  result = 0

  # VRM 1.0: VRMC_vrm.expressions
  if "extensions" in jsonData and "VRMC_vrm" in jsonData["extensions"]:
    let vrmc = jsonData["extensions"]["VRMC_vrm"]
    if "expressions" in vrmc:
      for key, expr in vrmc["expressions"].pairs:
        result.inc

  # VRM 0.x: extensions.VRM.shapeGroups
  elif "extensions" in jsonData and "VRM" in jsonData["extensions"]:
    let vrm = jsonData["extensions"]["VRM"]
    if "shapeGroups" in vrm:
      result = vrm["shapeGroups"].len

# Count textures
proc countTextures*(jsonData: JsonNode): int =
  if "images" in jsonData:
    return jsonData["images"].len
  return 0

# Count materials
proc countMaterials*(jsonData: JsonNode): int =
  if "materials" in jsonData:
    return jsonData["materials"].len
  return 0

# Count rigidbodies from physics config
proc countRigidbodies*(jsonData: JsonNode): int =
  # VRM physics uses springs in extensions
  # Count by analyzing VRM extension data
  # For PoC: estimate from VRoid profile detection
  if "extensions" in jsonData:
    if "VRMC_vrm" in jsonData["extensions"]:
      let vrmc = jsonData["extensions"]["VRMC_vrm"]
      if "lookAt" in vrmc:
        return 1  # Minimal estimate
    elif "VRM" in jsonData["extensions"]:
      let vrm = jsonData["extensions"]["VRM"]
      if "physicsEngine" in vrm:
        return 1  # Minimal estimate
  return 0

# Count joints (physics joints)
proc countJoints*(jsonData: JsonNode): int =
  # Similar to rigidbodies, joints come from physics metadata
  return 0

# Process mesh primitives and count vertices/indices
proc processMeshes*(jsonData: JsonNode, binData: openArray[uint8]): tuple[vertexCount: int, faceCount: int] =
  var vertexIdx = 0
  var totalFaceCount = 0

  if "meshes" not in jsonData:
    return (0, 0)

  for mesh in jsonData["meshes"]:
    if "primitives" not in mesh:
      continue

    for primitive in mesh["primitives"]:
      # Count vertices
      if "attributes" in primitive and "POSITION" in primitive["attributes"]:
        let posAccessorIdx = primitive["attributes"]["POSITION"].getInt()
        let positions = readAccessor(jsonData, binData, posAccessorIdx)
        vertexIdx += positions.len

      # Count faces (indices)
      if "indices" in primitive:
        let indicesAccessorIdx = primitive["indices"].getInt()
        let indices = readIndices(jsonData, binData, indicesAccessorIdx)
        totalFaceCount += indices.len div 3

  return (vertexIdx, totalFaceCount)

# Main conversion function
proc convertVrmBytes*(vrmBytes: openArray[uint8]): ConversionResult =
  result.errorMsg = ""

  # Parse GLB/VRM
  let glb = try:
    parseGlb(vrmBytes)
  except:
    result.errorMsg = getCurrentExceptionMsg()
    return

  # Extract JSON and BIN data
  let jsonData = glb.jsonData
  let binData = glb.binData

  # Count meshes (vertices and faces)
  let meshInfo = processMeshes(jsonData, binData)
  result.vertices = meshInfo.vertexCount
  result.faces = meshInfo.faceCount

  # Count bones
  result.bones = countBones(jsonData)

  # Count morphs
  result.morphs = countMorphs(jsonData)

  # Count materials
  result.materials = countMaterials(jsonData)

  # Count textures
  result.textures = countTextures(jsonData)

  # Placeholder counts (would need full physics data)
  result.rigidbodies = countRigidbodies(jsonData)
  result.joints = countJoints(jsonData)
