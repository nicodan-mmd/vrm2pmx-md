# GLB/VRM Parser for Nim
# Parses binary GLB/VRM format and extracts JSON + BIN chunks

import std/[json, tables, endians, strutils, sequtils]

type
  GlbHeader* = object
    magic*: uint32      # 0x46546C67 ("glTF")
    version*: uint32    # 2
    length*: uint32     # Total file size

  ChunkHeader* = object
    length*: uint32
    chunkType*: uint32  # 0x4E4F534A ("JSON") or 0x004E4942 ("BIN\0")

  GlbData* = object
    jsonData*: JsonNode
    binData*: seq[uint8]

# Read uint32 in little-endian
proc readUint32*(data: openArray[uint8], offset: int): uint32 =
  var bytes: array[4, uint8]
  for i in 0..<4:
    bytes[i] = data[offset + i]
  result = bytes[0].uint32 or (bytes[1].uint32 shl 8) or (bytes[2].uint32 shl 16) or (bytes[3].uint32 shl 24)

# Read uint16 in little-endian
proc readUint16*(data: openArray[uint8], offset: int): uint16 =
  var bytes: array[2, uint8]
  for i in 0..<2:
    bytes[i] = data[offset + i]
  result = cast[uint16](bytes[0].uint32 or (bytes[1].uint32 shl 8))

# Read float32 in little-endian
proc readFloat32*(data: openArray[uint8], offset: int): float32 =
  var bytes: array[4, uint8]
  for i in 0..<4:
    bytes[i] = data[offset + i]
  let u = bytes[0].uint32 or (bytes[1].uint32 shl 8) or (bytes[2].uint32 shl 16) or (bytes[3].uint32 shl 24)
  result = cast[float32](u)

# Parse GLB header
proc parseGlbHeader*(data: openArray[uint8]): GlbHeader =
  if data.len < 12:
    raise newException(ValueError, "GLB data too short for header")
  result.magic = readUint32(data, 0)
  result.version = readUint32(data, 4)
  result.length = readUint32(data, 8)

  # Verify GLB magic number (0x46546C67 = "glTF")
  if result.magic != 0x46546C67:
    raise newException(ValueError, "Invalid GLB magic number")

  if result.version != 2:
    raise newException(ValueError, "Only GLB version 2 is supported")

# Parse chunk header
proc parseChunkHeader*(data: openArray[uint8], offset: int): ChunkHeader =
  if offset + 8 > data.len:
    raise newException(ValueError, "Not enough data for chunk header")
  result.length = readUint32(data, offset)
  result.chunkType = readUint32(data, offset + 4)

# Parse GLB and extract JSON + BIN chunks
proc parseGlb*(data: openArray[uint8]): GlbData =
  let header = parseGlbHeader(data)

  # Parse chunks
  var offset = 12
  var jsonChunk: seq[uint8] = @[]
  var binChunk: seq[uint8] = @[]

  while offset < data.len:
    let chunkHeader = parseChunkHeader(data, offset)
    let chunkDataOffset = offset + 8
    let chunkDataEnd = chunkDataOffset + chunkHeader.length.int

    if chunkDataEnd > data.len:
      break

    # JSON chunk (0x4E4F534A = "JSON")
    if chunkHeader.chunkType == 0x4E4F534A:
      jsonChunk = data[chunkDataOffset..<chunkDataEnd].toSeq()

    # BIN chunk (0x004E4942 = "BIN\0")
    elif chunkHeader.chunkType == 0x004E4942:
      binChunk = data[chunkDataOffset..<chunkDataEnd].toSeq()

    offset = chunkDataEnd

  if jsonChunk.len == 0:
    raise newException(ValueError, "No JSON chunk found in GLB")

  # Parse JSON
  let jsonStr = cast[string](jsonChunk)
  result.jsonData = parseJson(jsonStr)
  result.binData = binChunk

# Get string from JSON
proc getJsonString*(node: JsonNode, key: string, default: string = ""): string =
  if node.kind == JObject and key in node:
    return if node[key].kind == JString: node[key].str else: default
  return default

# Get int from JSON
proc getJsonInt*(node: JsonNode, key: string, default: int = 0): int =
  if node.kind == JObject and key in node:
    return if node[key].kind == JInt: node[key].num.int else: default
  return default

# Get array element count
proc getJsonArrayLen*(node: JsonNode, key: string): int =
  if node.kind == JObject and key in node and node[key].kind == JArray:
    return node[key].len
  return 0
