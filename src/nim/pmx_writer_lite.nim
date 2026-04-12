import std/[unicode]

type
  Vec2f* = object
    x*: float32
    y*: float32

  Vec3f* = object
    x*: float32
    y*: float32
    z*: float32

  Vec4f* = object
    x*: float32
    y*: float32
    z*: float32
    w*: float32

  PmxDeformLite* = object
    ## kind: 0=Bdef1, 1=Bdef2, 2=Bdef4
    kind*: int
    bones*: array[4, int32]
    weights*: array[4, float32]

  PmxVertexLite* = object
    position*: Vec3f
    normal*: Vec3f
    uv*: Vec2f
    deform*: PmxDeformLite
    edgeFactor*: float32

  PmxMaterialLite* = object
    name*: string
    englishName*: string
    diffuse*: Vec4f
    specular*: Vec3f
    specularFactor*: float32
    ambient*: Vec3f
    flag*: int8
    edgeColor*: Vec4f
    edgeSize*: float32
    textureIndex*: int32
    sphereTextureIndex*: int32
    sphereMode*: int8
    toonSharingFlag*: int8
    toonTextureIndex*: int32
    comment*: string
    vertexCount*: int32

  PmxModelLite* = object
    name*: string
    englishName*: string
    comment*: string
    englishComment*: string
    vertices*: seq[PmxVertexLite]
    indices*: seq[int32]
    textures*: seq[string]
    materials*: seq[PmxMaterialLite]
    boneCountHint*: int
    morphCountHint*: int
    rigidbodyCountHint*: int

proc addByte(bytes: var seq[uint8], value: int) =
  bytes.add(uint8(value and 0xFF))

proc addInt16LE(bytes: var seq[uint8], value: int) =
  let v = uint16(cast[int16](value))
  bytes.add(uint8(v and 0xFF'u16))
  bytes.add(uint8((v shr 8) and 0xFF'u16))

proc addInt32LE(bytes: var seq[uint8], value: int32) =
  let v = uint32(cast[int32](value))
  bytes.add(uint8(v and 0xFF'u32))
  bytes.add(uint8((v shr 8) and 0xFF'u32))
  bytes.add(uint8((v shr 16) and 0xFF'u32))
  bytes.add(uint8((v shr 24) and 0xFF'u32))

proc addFloat32LE(bytes: var seq[uint8], value: float32) =
  let v = cast[uint32](value)
  bytes.add(uint8(v and 0xFF'u32))
  bytes.add(uint8((v shr 8) and 0xFF'u32))
  bytes.add(uint8((v shr 16) and 0xFF'u32))
  bytes.add(uint8((v shr 24) and 0xFF'u32))

proc addIntBySizeLE(bytes: var seq[uint8], value: int32, size: int) =
  case size
  of 1:
    addByte(bytes, int(cast[int8](value)))
  of 2:
    addInt16LE(bytes, int(cast[int16](value)))
  else:
    addInt32LE(bytes, value)

proc utf16LeBytes(text: string): seq[uint8] =
  result = @[]
  for rune in runes(text):
    let codepoint = rune.int
    if codepoint <= 0xFFFF:
      let unit = uint16(codepoint)
      result.add(uint8(unit and 0xFF'u16))
      result.add(uint8((unit shr 8) and 0xFF'u16))
    else:
      let v = codepoint - 0x10000
      let hi = uint16(0xD800 + ((v shr 10) and 0x3FF))
      let lo = uint16(0xDC00 + (v and 0x3FF))
      result.add(uint8(hi and 0xFF'u16))
      result.add(uint8((hi shr 8) and 0xFF'u16))
      result.add(uint8(lo and 0xFF'u16))
      result.add(uint8((lo shr 8) and 0xFF'u16))

proc writeText(bytes: var seq[uint8], text: string) =
  let encoded = utf16LeBytes(text)
  addInt32LE(bytes, int32(encoded.len))
  bytes.add(encoded)

proc defineIndexSize*(size: int): int =
  if size > 32768:
    return 4
  if size > 128:
    return 2
  return 1

proc makeBdef1*(bone: int32): PmxDeformLite =
  result.kind = 0
  result.bones[0] = bone

proc makeBdef2*(bone0, bone1: int32, weight0: float32): PmxDeformLite =
  result.kind = 1
  result.bones[0] = bone0
  result.bones[1] = bone1
  result.weights[0] = weight0

proc makeBdef4*(bone0, bone1, bone2, bone3: int32; w0, w1, w2, w3: float32): PmxDeformLite =
  result.kind = 2
  result.bones[0] = bone0
  result.bones[1] = bone1
  result.bones[2] = bone2
  result.bones[3] = bone3
  result.weights[0] = w0
  result.weights[1] = w1
  result.weights[2] = w2
  result.weights[3] = w3

proc defaultMaterial*(vertexCount: int32): PmxMaterialLite =
  result.name = "material"
  result.englishName = "material"
  result.diffuse = Vec4f(x: 1'f32, y: 1'f32, z: 1'f32, w: 1'f32)
  result.specular = Vec3f(x: 0'f32, y: 0'f32, z: 0'f32)
  result.specularFactor = 0'f32
  result.ambient = Vec3f(x: 1'f32, y: 1'f32, z: 1'f32)
  result.flag = int8(0)
  result.edgeColor = Vec4f(x: 0'f32, y: 0'f32, z: 0'f32, w: 1'f32)
  result.edgeSize = 1'f32
  result.textureIndex = int32(-1)
  result.sphereTextureIndex = int32(-1)
  result.sphereMode = int8(0)
  result.toonSharingFlag = int8(1)
  result.toonTextureIndex = int32(0)
  result.comment = ""
  result.vertexCount = vertexCount

proc buildPmxBinaryLite*(model: PmxModelLite): seq[uint8] =
  result = @[]

  let vertexIdxSize = defineIndexSize(model.vertices.len)
  let textureIdxSize = defineIndexSize(model.textures.len)
  let materialIdxSize = defineIndexSize(model.materials.len)
  let boneIdxSize = defineIndexSize(model.boneCountHint)
  let morphIdxSize = defineIndexSize(model.morphCountHint)
  let rigidbodyIdxSize = defineIndexSize(model.rigidbodyCountHint)

  result.add(cast[seq[uint8]]("PMX "))
  addFloat32LE(result, 2'f32)
  addByte(result, 8)
  addByte(result, 0)
  addByte(result, 0)
  addByte(result, vertexIdxSize)
  addByte(result, textureIdxSize)
  addByte(result, materialIdxSize)
  addByte(result, boneIdxSize)
  addByte(result, morphIdxSize)
  addByte(result, rigidbodyIdxSize)

  writeText(result, model.name)
  writeText(result, model.englishName)
  writeText(result, model.comment)
  writeText(result, model.englishComment)

  addInt32LE(result, int32(model.vertices.len))
  for v in model.vertices:
    addFloat32LE(result, v.position.x)
    addFloat32LE(result, v.position.y)
    addFloat32LE(result, v.position.z)

    addFloat32LE(result, v.normal.x)
    addFloat32LE(result, v.normal.y)
    addFloat32LE(result, v.normal.z)

    addFloat32LE(result, v.uv.x)
    addFloat32LE(result, v.uv.y)

    case v.deform.kind
    of 1:  # Bdef2
      addByte(result, 1)
      addIntBySizeLE(result, v.deform.bones[0], boneIdxSize)
      addIntBySizeLE(result, v.deform.bones[1], boneIdxSize)
      addFloat32LE(result, v.deform.weights[0])
    of 2:  # Bdef4
      addByte(result, 2)
      addIntBySizeLE(result, v.deform.bones[0], boneIdxSize)
      addIntBySizeLE(result, v.deform.bones[1], boneIdxSize)
      addIntBySizeLE(result, v.deform.bones[2], boneIdxSize)
      addIntBySizeLE(result, v.deform.bones[3], boneIdxSize)
      addFloat32LE(result, v.deform.weights[0])
      addFloat32LE(result, v.deform.weights[1])
      addFloat32LE(result, v.deform.weights[2])
      addFloat32LE(result, v.deform.weights[3])
    else:  # Bdef1 (kind=0 or fallback)
      addByte(result, 0)
      addIntBySizeLE(result, v.deform.bones[0], boneIdxSize)

    addFloat32LE(result, v.edgeFactor)

  addInt32LE(result, int32(model.indices.len))
  for idx in model.indices:
    addIntBySizeLE(result, idx, vertexIdxSize)

  addInt32LE(result, int32(model.textures.len))
  for tex in model.textures:
    writeText(result, tex)

  addInt32LE(result, int32(model.materials.len))
  for m in model.materials:
    writeText(result, m.name)
    writeText(result, m.englishName)

    addFloat32LE(result, m.diffuse.x)
    addFloat32LE(result, m.diffuse.y)
    addFloat32LE(result, m.diffuse.z)
    addFloat32LE(result, m.diffuse.w)

    addFloat32LE(result, m.specular.x)
    addFloat32LE(result, m.specular.y)
    addFloat32LE(result, m.specular.z)
    addFloat32LE(result, m.specularFactor)

    addFloat32LE(result, m.ambient.x)
    addFloat32LE(result, m.ambient.y)
    addFloat32LE(result, m.ambient.z)

    addByte(result, int(m.flag))
    addFloat32LE(result, m.edgeColor.x)
    addFloat32LE(result, m.edgeColor.y)
    addFloat32LE(result, m.edgeColor.z)
    addFloat32LE(result, m.edgeColor.w)
    addFloat32LE(result, m.edgeSize)

    addIntBySizeLE(result, m.textureIndex, textureIdxSize)
    addIntBySizeLE(result, m.sphereTextureIndex, textureIdxSize)
    addByte(result, int(m.sphereMode))
    addByte(result, int(m.toonSharingFlag))
    if m.toonSharingFlag == int8(0):
      addIntBySizeLE(result, m.toonTextureIndex, textureIdxSize)
    else:
      addByte(result, int(m.toonTextureIndex and 0xFF'i32))

    writeText(result, m.comment)
    addInt32LE(result, m.vertexCount)

  # bones/morphs/display/rigidbodies/joints
  addInt32LE(result, int32(model.boneCountHint))
  addInt32LE(result, int32(model.morphCountHint))
  addInt32LE(result, 0)  # display frames (not implemented)
  addInt32LE(result, int32(model.rigidbodyCountHint))
  addInt32LE(result, 0)  # joints (not implemented)
