# Accessor data reader for glTF
# Handles VEC2, VEC3, VEC4, SCALAR types with various component types

import std/[json, sequtils]
import glb_parser

const
  GL_BYTE = 5120
  GL_UNSIGNED_BYTE = 5121
  GL_SHORT = 5122
  GL_UNSIGNED_SHORT = 5123
  GL_UNSIGNED_INT = 5125
  GL_FLOAT = 5126

type
  Vector2D* = tuple[x, y: float32]
  Vector3D* = tuple[x, y, z: float32]
  Vector4D* = tuple[x, y, z, w: float32]
  Matrix4x4* = array[16, float32]

# Get component size in bytes
proc componentSize(componentType: int): int =
  case componentType
  of GL_BYTE, GL_UNSIGNED_BYTE: 1
  of GL_SHORT, GL_UNSIGNED_SHORT: 2
  of GL_UNSIGNED_INT, GL_FLOAT: 4
  else: 0

# Get element count based on type
proc elementCount(typ: string): int =
  case typ
  of "SCALAR": 1
  of "VEC2": 2
  of "VEC3": 3
  of "VEC4": 4
  of "MAT2": 4
  of "MAT3": 9
  of "MAT4": 16
  else: 0

# Convert bytes to float32 (little-endian)
proc bytesToFloat32(data: openArray[uint8], offset: int): float32 =
  readFloat32(data, offset)

# Convert bytes to int/uint
proc bytesToInt(data: openArray[uint8], offset: int, componentType: int): int =
  case componentType
  of GL_BYTE:
    cast[int8](data[offset]).int
  of GL_UNSIGNED_BYTE:
    data[offset].int
  of GL_SHORT:
    cast[int16](readUint16(data, offset)).int
  of GL_UNSIGNED_SHORT:
    readUint16(data, offset).int
  else:
    0

# Read accessor data from binary buffer
proc readAccessor*(jsonData: JsonNode, binData: openArray[uint8], accessorIdx: int): seq[Vector3D] =
  if accessorIdx < 0 or accessorIdx >= jsonData["accessors"].len:
    return @[]

  let accessor = jsonData["accessors"][accessorIdx]
  let accessorType = getJsonString(accessor, "type", "VEC3")
  let componentType = getJsonInt(accessor, "componentType", GL_FLOAT)
  let count = getJsonInt(accessor, "count", 0)
  let bufferViewIdx = getJsonInt(accessor, "bufferView", -1)

  if bufferViewIdx < 0 or bufferViewIdx >= jsonData["bufferViews"].len:
    return @[]

  let bufferView = jsonData["bufferViews"][bufferViewIdx]
  let byteOffset = getJsonInt(bufferView, "byteOffset", 0)
  let bufByteStride = getJsonInt(bufferView, "byteStride", 0)
  let accessorByteOffset = getJsonInt(accessor, "byteOffset", 0)

  let compSize = componentSize(componentType)
  let elemCount = elementCount(accessorType)

  if compSize == 0 or elemCount == 0:
    return @[]

  let stride = if bufByteStride > 0: bufByteStride else: compSize * elemCount
  let totalOffset = byteOffset + accessorByteOffset

  var result: seq[Vector3D] = @[]

  for i in 0..<count:
    let offset = totalOffset + i * stride

    if accessorType == "VEC3":
      let x = bytesToFloat32(binData, offset)
      let y = bytesToFloat32(binData, offset + compSize)
      let z = bytesToFloat32(binData, offset + compSize * 2)
      result.add((x, y, z))

    elif accessorType == "VEC2":
      let x = bytesToFloat32(binData, offset)
      let y = bytesToFloat32(binData, offset + compSize)
      result.add((x, y, 0'f32))

    elif accessorType == "VEC4":
      let x = bytesToFloat32(binData, offset)
      let y = bytesToFloat32(binData, offset + compSize)
      let z = bytesToFloat32(binData, offset + compSize * 2)
      let w = bytesToFloat32(binData, offset + compSize * 3)
      result.add((x, y, z))  # w is discarded for VEC3 tuple

    elif accessorType == "SCALAR":
      let x = bytesToFloat32(binData, offset)
      result.add((x, 0'f32, 0'f32))

  return result

# Read indices (integer accessor)
proc readIndices*(jsonData: JsonNode, binData: openArray[uint8], accessorIdx: int): seq[uint32] =
  if accessorIdx < 0 or accessorIdx >= jsonData["accessors"].len:
    return @[]

  let accessor = jsonData["accessors"][accessorIdx]
  let componentType = getJsonInt(accessor, "componentType", GL_UNSIGNED_INT)
  let count = getJsonInt(accessor, "count", 0)
  let bufferViewIdx = getJsonInt(accessor, "bufferView", -1)

  if bufferViewIdx < 0 or bufferViewIdx >= jsonData["bufferViews"].len:
    return @[]

  let bufferView = jsonData["bufferViews"][bufferViewIdx]
  let byteOffset = getJsonInt(bufferView, "byteOffset", 0)
  let bufByteStride = getJsonInt(bufferView, "byteStride", 0)
  let accessorByteOffset = getJsonInt(accessor, "byteOffset", 0)

  let compSize = componentSize(componentType)
  if compSize == 0:
    return @[]

  let stride = if bufByteStride > 0: bufByteStride else: compSize
  let totalOffset = byteOffset + accessorByteOffset

  var result: seq[uint32] = @[]

  for i in 0..<count:
    let offset = totalOffset + i * stride

    case componentType
    of GL_UNSIGNED_SHORT:
      result.add(readUint16(binData, offset).uint32)
    of GL_UNSIGNED_INT:
      result.add(readUint32(binData, offset))
    of GL_SHORT:
      let v = cast[int16](readUint16(binData, offset))
      result.add(max(0, v.int).uint32)
    else:
      result.add(0'u32)

  return result
