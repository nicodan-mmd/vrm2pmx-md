# Minimal Nim VRM Counter
# Direct GLB parser and geometry counter

import std/[json, strutils, sequtils, endians, os]

const
  GL_FLOAT = 5126
  GL_UNSIGNED_INT = 5125
  GL_UNSIGNED_SHORT = 5123

type
  GlbHeader = object
    magic: uint32
    version: uint32
    length: uint32

  ChunkHeader = object
    length: uint32
    chunkType: uint32

proc readUint32LE(data: seq[uint8], offset: int): uint32 =
  let bytes = [data[offset], data[offset+1], data[offset+2], data[offset+3]]
  result = uint32(bytes[0]) or (uint32(bytes[1]) shl 8) or (uint32(bytes[2]) shl 16) or (uint32(bytes[3]) shl 24)

proc readUint16LE(data: seq[uint8], offset: int): uint16 =
  let b0 = uint16(data[offset])
  let b1 = uint16(data[offset+1])
  result = b0 or (b1 shl 8)

proc readFloat32LE(data: seq[uint8], offset: int): float32 =
  let u = readUint32LE(data, offset)
  result = cast[float32](u)

proc parseGlbHeader(data: seq[uint8]): GlbHeader =
  if data.len < 12:
    raise newException(ValueError, "GLB data too short")

  result.magic = readUint32LE(data, 0)
  result.version = readUint32LE(data, 4)
  result.length = readUint32LE(data, 8)

  if result.magic != 0x46546C67:  # "glTF"
    raise newException(ValueError, "Invalid GLB magic")
  if result.version != 2:
    raise newException(ValueError, "GLB v2 only")

proc parseChunkHeader(data: seq[uint8], offset: int): tuple[header: ChunkHeader, nextOffset: int] =
  let chunkHeader = ChunkHeader(
    length: readUint32LE(data, offset),
    chunkType: readUint32LE(data, offset+4)
  )
  result = (chunkHeader, offset + 8 + chunkHeader.length.int)

proc parseGlb(filePath: string): tuple[json: JsonNode, bin: seq[uint8]] =
  let data = readFile(filePath)
  let bytes = cast[seq[uint8]](data)

  let header = parseGlbHeader(bytes)

  var offset = 12
  var jsonChunk: seq[uint8] = @[]
  var binChunk: seq[uint8] = @[]

  while offset < bytes.len:
    let (chunkHeader, nextOffset) = parseChunkHeader(bytes, offset)
    let chunkDataStart = offset + 8
    let chunkDataEnd = nextOffset

    if chunkHeader.chunkType == 0x4E4F534A:  # "JSON"
      jsonChunk = bytes[chunkDataStart..<chunkDataEnd]
    elif chunkHeader.chunkType == 0x004E4942:  # "BIN\0"
      binChunk = bytes[chunkDataStart..<chunkDataEnd]

    offset = nextOffset

  if jsonChunk.len == 0:
    raise newException(ValueError, "No JSON chunk")

  let jsonStr = cast[string](jsonChunk)
  result = (parseJson(jsonStr), binChunk)

proc readAccessor(json: JsonNode, binData: seq[uint8], accessorIdx: int): int =
  if accessorIdx < 0 or accessorIdx >= json["accessors"].len:
    return 0

  let accessor = json["accessors"][accessorIdx]
  let bufViewIdx = accessor["bufferView"].getInt()

  if bufViewIdx < 0 or bufViewIdx >= json["bufferViews"].len:
    return 0

  let count = accessor["count"].getInt(0)
  return count

proc countGeometry(json: JsonNode, binData: seq[uint8]): tuple[vertices: int, faces: int] =
  var vertices = 0
  var faces = 0

  if "meshes" notin json:
    return (0, 0)

  for mesh in json["meshes"]:
    if "primitives" notin mesh:
      continue

    for prim in mesh["primitives"]:
      # Count vertices
      if "attributes" in prim and "POSITION" in prim["attributes"]:
        let posIdx = prim["attributes"]["POSITION"].getInt()
        let vertCount = readAccessor(json, binData, posIdx)
        vertices += vertCount

      # Count faces
      if "indices" in prim:
        let indicesIdx = prim["indices"].getInt()
        let indexCount = readAccessor(json, binData, indicesIdx)
        faces += indexCount div 3

  return (vertices, faces)

proc countBones(json: JsonNode): int =
  if "nodes" notin json:
    return 0
  return json["nodes"].len

proc countMorphs(json: JsonNode): int =
  var count = 0

  if "extensions" notin json:
    return 0

  let ext = json["extensions"]

  # VRM 1.0
  if "VRMC_vrm" in ext:
    let vrmc = ext["VRMC_vrm"]
    if "expressions" in vrmc and vrmc["expressions"].kind == JObject:
      count = vrmc["expressions"].len

  # VRM 0.x
  elif "VRM" in ext:
    let vrm = ext["VRM"]
    if "blendShapeMaster" in vrm:
      let bsm = vrm["blendShapeMaster"]
      if "blendShapeGroups" in bsm:
        count = bsm["blendShapeGroups"].len

  return count

proc main() =
  let args = commandLineParams()
  if args.len < 1:
    echo "Usage: nim_vrm_counter <vrm_file>"
    quit(1)

  let filePath = args[0]
  try:
    echo "Parsing: " & filePath
    let (json, binData) = parseGlb(filePath)

    let (vertices, faces) = countGeometry(json, binData)
    let bones = countBones(json)
    let morphs = countMorphs(json)

    echo "\nGeometry Counts (Nim):"
    echo "  Vertices: " & $vertices
    echo "  Faces: " & $faces
    echo "  Bones: " & $bones
    echo "  Morphs: " & $morphs

  except Exception as e:
    echo "Error: " & e.msg
    quit(1)

when isMainModule:
  main()
