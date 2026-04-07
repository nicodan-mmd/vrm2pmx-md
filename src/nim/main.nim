# Simple test program for Nim VRM converter

import std/[json, os, strutils]
import converter, glb_parser

when isMainModule:
  if paramCount() < 1:
    echo "Usage: nim_converter <vrm_file>"
    quit(1)

  let filePath = paramStr(1)

  if not fileExists(filePath):
    echo "Error: File not found: " & filePath
    quit(1)

  # Read VRM file
  let vrmBytes = readFile(filePath)

  # Convert
  let result = convertVrmBytes(cast[seq[uint8]](vrmBytes))

  if result.errorMsg != "":
    echo "Error: " & result.errorMsg
    quit(1)

  # Output results
  echo "Conversion Results:"
  echo "  Vertices: " & $result.vertices
  echo "  Faces: " & $result.faces
  echo "  Bones: " & $result.bones
  echo "  Morphs: " & $result.morphs
  echo "  Materials: " & $result.materials
  echo "  Textures: " & $result.textures
  echo "  Rigidbodies: " & $result.rigidbodies
  echo "  Joints: " & $result.joints
