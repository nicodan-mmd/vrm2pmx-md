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

  PmxVertexMorphOffsetLite* = object
    vertexIndex*: int32
    positionOffset*: Vec3f

  PmxGroupMorphOffsetLite* = object
    morphIndex*: int32
    value*: float32

  PmxMorphLite* = object
    name*: string
    englishName*: string
    panel*: int8
    morphType*: int8
    vertexOffsets*: seq[PmxVertexMorphOffsetLite]
    groupOffsets*: seq[PmxGroupMorphOffsetLite]

  PmxDisplayRefLite* = object
    targetType*: int8  # 0=bone, 1=morph
    index*: int32

  PmxDisplaySlotLite* = object
    name*: string
    englishName*: string
    specialFlag*: int8
    displayType*: int8
    references*: seq[PmxDisplayRefLite]

  PmxIkLinkLite* = object
    boneIndex*: int32
    limitAngle*: int8
    limitMin*: Vec3f
    limitMax*: Vec3f

  PmxIkLite* = object
    targetIndex*: int32
    loopCount*: int32
    limitRadian*: float32
    links*: seq[PmxIkLinkLite]

  PmxBoneLite* = object
    name*: string
    englishName*: string
    position*: Vec3f
    parentIndex*: int32
    layer*: int32
    flag*: int16
    tailIndex*: int32
    tailPosition*: Vec3f
    externalKey*: int32 = -1  # written when flag & 0x2000
    appendBoneIndex*: int32 = -1  # written when flag & 0x0300 (append rotation/translation)
    appendRatio*: float32 = 0'f32  # written when flag & 0x0300
    fixedAxis*: Vec3f  # written when flag & 0x0400
    localXAxis*: Vec3f  # written when flag & 0x0800
    localZAxis*: Vec3f  # written when flag & 0x0800
    ik*: PmxIkLite      # written when flag & 0x0020

  PmxRigidbodyLite* = object
    name*: string
    englishName*: string
    boneIndex*: int32
    collisionGroup*: int8
    noCollisionGroup*: int16
    shapeType*: int8
    shapeSize*: Vec3f
    shapePosition*: Vec3f
    shapeRotation*: Vec3f
    paramMass*: float32
    paramMoveAttenuation*: float32
    paramRotationAttenuation*: float32
    paramRepulsion*: float32
    paramFriction*: float32
    mode*: int8

  PmxJointLite* = object
    name*: string
    englishName*: string
    jointType*: int8
    rigidbodyIndexA*: int32
    rigidbodyIndexB*: int32
    position*: Vec3f
    rotation*: Vec3f
    translationLimitMin*: Vec3f
    translationLimitMax*: Vec3f
    rotationLimitMin*: Vec3f
    rotationLimitMax*: Vec3f
    springConstantTranslation*: Vec3f
    springConstantRotation*: Vec3f

  PmxModelLite* = object
    name*: string
    englishName*: string
    comment*: string
    englishComment*: string
    vertices*: seq[PmxVertexLite]
    indices*: seq[int32]
    textures*: seq[string]
    materials*: seq[PmxMaterialLite]
    bones*: seq[PmxBoneLite]
    morphs*: seq[PmxMorphLite]
    displaySlots*: seq[PmxDisplaySlotLite]
    rigidbodies*: seq[PmxRigidbodyLite]
    joints*: seq[PmxJointLite]
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
  result.ambient = Vec3f(x: 0.5'f32, y: 0.5'f32, z: 0.5'f32)
  result.flag = int8(0x02 or 0x04 or 0x08)
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
  let boneIdxSize = defineIndexSize(model.bones.len)
  let morphCount = if model.morphs.len > 0: model.morphs.len else: model.morphCountHint
  let morphIdxSize = defineIndexSize(morphCount)
  let rigidbodyCount = if model.rigidbodies.len > 0: model.rigidbodies.len else: model.rigidbodyCountHint
  let rigidbodyIdxSize = defineIndexSize(rigidbodyCount)

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

  # bones
  addInt32LE(result, int32(model.bones.len))
  for b in model.bones:
    writeText(result, b.name)
    writeText(result, b.englishName)

    addFloat32LE(result, b.position.x)
    addFloat32LE(result, b.position.y)
    addFloat32LE(result, b.position.z)

    addIntBySizeLE(result, b.parentIndex, boneIdxSize)
    addInt32LE(result, b.layer)
    addInt16LE(result, int(b.flag))

    if (int(b.flag) and 0x0001) != 0:
      addIntBySizeLE(result, b.tailIndex, boneIdxSize)
    else:
      addFloat32LE(result, b.tailPosition.x)
      addFloat32LE(result, b.tailPosition.y)
      addFloat32LE(result, b.tailPosition.z)

    # append rotation/translation (flag & 0x0100 or 0x0200)
    if (int(b.flag) and 0x0300) != 0:
      addIntBySizeLE(result, b.appendBoneIndex, boneIdxSize)
      addFloat32LE(result, b.appendRatio)

    # fixed axis (flag & 0x0400)
    if (int(b.flag) and 0x0400) != 0:
      addFloat32LE(result, b.fixedAxis.x)
      addFloat32LE(result, b.fixedAxis.y)
      addFloat32LE(result, b.fixedAxis.z)

    # local axis (flag & 0x0800)
    if (int(b.flag) and 0x0800) != 0:
      addFloat32LE(result, b.localXAxis.x)
      addFloat32LE(result, b.localXAxis.y)
      addFloat32LE(result, b.localXAxis.z)
      addFloat32LE(result, b.localZAxis.x)
      addFloat32LE(result, b.localZAxis.y)
      addFloat32LE(result, b.localZAxis.z)

    # external parent deform key (flag & 0x2000)
    if (int(b.flag) and 0x2000) != 0:
      addInt32LE(result, b.externalKey)

    # IK (flag & 0x0020)
    if (int(b.flag) and 0x0020) != 0:
      addIntBySizeLE(result, b.ik.targetIndex, boneIdxSize)
      addInt32LE(result, b.ik.loopCount)
      addFloat32LE(result, b.ik.limitRadian)
      addInt32LE(result, int32(b.ik.links.len))
      for link in b.ik.links:
        addIntBySizeLE(result, link.boneIndex, boneIdxSize)
        addByte(result, int(link.limitAngle))
        if link.limitAngle != 0'i8:
          addFloat32LE(result, link.limitMin.x)
          addFloat32LE(result, link.limitMin.y)
          addFloat32LE(result, link.limitMin.z)
          addFloat32LE(result, link.limitMax.x)
          addFloat32LE(result, link.limitMax.y)
          addFloat32LE(result, link.limitMax.z)

  # morphs
  addInt32LE(result, int32(model.morphs.len))
  for morph in model.morphs:
    writeText(result, morph.name)
    writeText(result, morph.englishName)
    addByte(result, int(morph.panel))
    addByte(result, int(morph.morphType))
    if morph.morphType == int8(1):
      addInt32LE(result, int32(morph.vertexOffsets.len))
      for offset in morph.vertexOffsets:
        addIntBySizeLE(result, offset.vertexIndex, vertexIdxSize)
        addFloat32LE(result, offset.positionOffset.x)
        addFloat32LE(result, offset.positionOffset.y)
        addFloat32LE(result, offset.positionOffset.z)
    else:
      addInt32LE(result, int32(morph.groupOffsets.len))
      for offset in morph.groupOffsets:
        addIntBySizeLE(result, offset.morphIndex, morphIdxSize)
        addFloat32LE(result, offset.value)

  # display slots
  addInt32LE(result, int32(model.displaySlots.len))
  for displaySlot in model.displaySlots:
    writeText(result, displaySlot.name)
    writeText(result, displaySlot.englishName)
    addByte(result, int(displaySlot.specialFlag))
    addInt32LE(result, int32(displaySlot.references.len))
    for displayRef in displaySlot.references:
      addByte(result, int(displayRef.targetType))
      if displayRef.targetType == int8(0):
        addIntBySizeLE(result, displayRef.index, boneIdxSize)
      else:
        addIntBySizeLE(result, displayRef.index, morphIdxSize)

  # rigidbodies
  addInt32LE(result, int32(model.rigidbodies.len))
  for rb in model.rigidbodies:
    writeText(result, rb.name)
    writeText(result, rb.englishName)
    addIntBySizeLE(result, rb.boneIndex, boneIdxSize)
    addByte(result, int(rb.collisionGroup))
    addInt16LE(result, int(rb.noCollisionGroup))
    addByte(result, int(rb.shapeType))
    addFloat32LE(result, rb.shapeSize.x)
    addFloat32LE(result, rb.shapeSize.y)
    addFloat32LE(result, rb.shapeSize.z)
    addFloat32LE(result, rb.shapePosition.x)
    addFloat32LE(result, rb.shapePosition.y)
    addFloat32LE(result, rb.shapePosition.z)
    addFloat32LE(result, rb.shapeRotation.x)
    addFloat32LE(result, rb.shapeRotation.y)
    addFloat32LE(result, rb.shapeRotation.z)
    addFloat32LE(result, rb.paramMass)
    addFloat32LE(result, rb.paramMoveAttenuation)
    addFloat32LE(result, rb.paramRotationAttenuation)
    addFloat32LE(result, rb.paramRepulsion)
    addFloat32LE(result, rb.paramFriction)
    addByte(result, int(rb.mode))

  # joints
  addInt32LE(result, int32(model.joints.len))
  for j in model.joints:
    writeText(result, j.name)
    writeText(result, j.englishName)
    addByte(result, int(j.jointType))
    addIntBySizeLE(result, j.rigidbodyIndexA, rigidbodyIdxSize)
    addIntBySizeLE(result, j.rigidbodyIndexB, rigidbodyIdxSize)
    addFloat32LE(result, j.position.x)
    addFloat32LE(result, j.position.y)
    addFloat32LE(result, j.position.z)
    addFloat32LE(result, j.rotation.x)
    addFloat32LE(result, j.rotation.y)
    addFloat32LE(result, j.rotation.z)
    addFloat32LE(result, j.translationLimitMin.x)
    addFloat32LE(result, j.translationLimitMin.y)
    addFloat32LE(result, j.translationLimitMin.z)
    addFloat32LE(result, j.translationLimitMax.x)
    addFloat32LE(result, j.translationLimitMax.y)
    addFloat32LE(result, j.translationLimitMax.z)
    addFloat32LE(result, j.rotationLimitMin.x)
    addFloat32LE(result, j.rotationLimitMin.y)
    addFloat32LE(result, j.rotationLimitMin.z)
    addFloat32LE(result, j.rotationLimitMax.x)
    addFloat32LE(result, j.rotationLimitMax.y)
    addFloat32LE(result, j.rotationLimitMax.z)
    addFloat32LE(result, j.springConstantTranslation.x)
    addFloat32LE(result, j.springConstantTranslation.y)
    addFloat32LE(result, j.springConstantTranslation.z)
    addFloat32LE(result, j.springConstantRotation.x)
    addFloat32LE(result, j.springConstantRotation.y)
    addFloat32LE(result, j.springConstantRotation.z)
