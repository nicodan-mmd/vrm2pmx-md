# -*- coding: utf-8 -*-
"""
Direct VRM geometry counter - counts vertices, faces, bones, morphs without full conversion.
Optimized for precision and comparison with other implementations.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class VrmGeometryCount:
    """VRM geometry statistics."""
    vertices: int = 0
    faces: int = 0
    bones: int = 0
    morphs: int = 0
    materials: int = 0
    textures: int = 0
    rigidbodies: int = 0
    joints: int = 0
    error_msg: str = ""


class VrmCounterService:
    """Direct VRM accessor reader for precise geometry counting."""

    def __init__(self, vrm_path: str):
        self.vrm_path = Path(vrm_path)
        self.json_data: dict[str, Any] = {}
        self.bin_data: bytes = b""
        self.vertex_idx_counter = 0
        self.face_count = 0

    def _read_glb_header(self, data: bytes) -> tuple[int, int, int]:
        """Parse GLB header (magic, version, length)."""
        if len(data) < 12:
            raise ValueError("GLB data too short")
        magic, version, length = struct.unpack("<III", data[0:12])
        if magic != 0x46546C67:  # "glTF"
            raise ValueError("Invalid GLB magic")
        if version != 2:
            raise ValueError("Only GLB v2 supported")
        return version, length, 12

    def _read_chunk(self, data: bytes, offset: int) -> tuple[bytes, int, str]:
        """Read GLB chunk (length, type, then data)."""
        if offset + 8 > len(data):
            return b"", offset, ""

        length, chunk_type = struct.unpack("<II", data[offset:offset+8])
        chunk_type_str = bytes([
            chunk_type & 0xFF,
            (chunk_type >> 8) & 0xFF,
            (chunk_type >> 16) & 0xFF,
            (chunk_type >> 24) & 0xFF
        ]).rstrip(b'\x00').decode('ascii')

        chunk_data = data[offset+8:offset+8+length]
        return chunk_data, offset + 8 + length, chunk_type_str

    def _load_glb(self) -> None:
        """Load and parse GLB file, extract JSON and BIN chunks."""
        data = self.vrm_path.read_bytes()

        version, length, offset = self._read_glb_header(data)

        # Parse chunks
        json_chunk = b""
        bin_chunk = b""

        while offset < len(data):
            chunk_data, new_offset, chunk_type = self._read_chunk(data, offset)

            if chunk_type == "JSON":
                json_chunk = chunk_data
            elif chunk_type == "BIN":
                bin_chunk = chunk_data

            offset = new_offset
            if offset >= len(data):
                break

        if not json_chunk:
            raise ValueError("No JSON chunk found in GLB")

        self.json_data = json.loads(json_chunk.decode('utf-8'))
        self.bin_data = bin_chunk

    def _read_from_accessor(self, accessor_idx: int) -> list[tuple[float, float, float]]:
        """
        Read VEC3 data from accessor (for positions, normals, etc).
        Returns list of (x, y, z) tuples.
        """
        if accessor_idx < 0 or accessor_idx >= len(self.json_data.get("accessors", [])):
            return []

        accessor = self.json_data["accessors"][accessor_idx]
        buff_view_idx = accessor.get("bufferView", -1)

        if buff_view_idx < 0 or buff_view_idx >= len(self.json_data.get("bufferViews", [])):
            return []

        buffer_view = self.json_data["bufferViews"][buff_view_idx]
        byte_offset = buffer_view.get("byteOffset", 0)
        byte_stride = buffer_view.get("byteStride", 0)

        accessor_byte_offset = accessor.get("byteOffset", 0)
        component_type = accessor.get("componentType", 5126)  # GL_FLOAT
        count = accessor.get("count", 0)
        acc_type = accessor.get("type", "VEC3")

        # Determine component size
        if component_type == 5126:  # GL_FLOAT
            comp_size = 4
        elif component_type in (5122, 5123):  # SHORT, USHORT
            comp_size = 2
        elif component_type in (5120, 5121):  # BYTE, UBYTE
            comp_size = 1
        else:
            comp_size = 4

        # Calculate stride
        if acc_type == "VEC3":
            elem_count = 3
        elif acc_type == "VEC2":
            elem_count = 2
        elif acc_type == "VEC4":
            elem_count = 4
        else:
            elem_count = 1

        stride = byte_stride if byte_stride > 0 else comp_size * elem_count
        total_offset = byte_offset + accessor_byte_offset

        result = []
        for i in range(count):
            offset = total_offset + i * stride
            if offset + comp_size * 3 > len(self.bin_data):
                break

            # Read as float32 (always read as float regardless of component type)
            x = struct.unpack("<f", self.bin_data[offset:offset+4])[0]
            y = struct.unpack("<f", self.bin_data[offset+4:offset+8])[0]
            z = struct.unpack("<f", self.bin_data[offset+8:offset+12])[0]
            result.append((x, y, z))

        return result

    def _read_indices(self, accessor_idx: int) -> list[int]:
        """Read index data from accessor."""
        if accessor_idx < 0 or accessor_idx >= len(self.json_data.get("accessors", [])):
            return []

        accessor = self.json_data["accessors"][accessor_idx]
        buff_view_idx = accessor.get("bufferView", -1)

        if buff_view_idx < 0 or buff_view_idx >= len(self.json_data.get("bufferViews", [])):
            return []

        buffer_view = self.json_data["bufferViews"][buff_view_idx]
        byte_offset = buffer_view.get("byteOffset", 0)
        byte_stride = buffer_view.get("byteStride", 0)

        accessor_byte_offset = accessor.get("byteOffset", 0)
        component_type = accessor.get("componentType", 5125)  # GL_UNSIGNED_INT
        count = accessor.get("count", 0)

        # Determine component size and unpack format
        if component_type == 5125:  # GL_UNSIGNED_INT
            comp_size = 4
            fmt = "<I"
        elif component_type == 5123:  # GL_UNSIGNED_SHORT
            comp_size = 2
            fmt = "<H"
        elif component_type == 5122:  # GL_SHORT
            comp_size = 2
            fmt = "<h"
        else:
            return []

        stride = byte_stride if byte_stride > 0 else comp_size
        total_offset = byte_offset + accessor_byte_offset

        result = []
        for i in range(count):
            offset = total_offset + i * stride
            if offset + comp_size > len(self.bin_data):
                break

            val = struct.unpack(fmt, self.bin_data[offset:offset+comp_size])[0]
            result.append(int(val))

        return result

    def _count_meshes(self) -> tuple[int, int]:
        """Count total vertices and face count from mesh primitives."""
        vertex_count = 0
        face_count = 0

        meshes = self.json_data.get("meshes", [])
        for mesh in meshes:
            primitives = mesh.get("primitives", [])
            for primitive in primitives:
                # Count vertices from POSITION accessor
                if "attributes" in primitive and "POSITION" in primitive["attributes"]:
                    pos_accessor_idx = primitive["attributes"]["POSITION"]
                    positions = self._read_from_accessor(pos_accessor_idx)
                    vertex_count += len(positions)

                # Count faces from indices
                if "indices" in primitive:
                    indices_accessor_idx = primitive["indices"]
                    indices = self._read_indices(indices_accessor_idx)
                    face_count += len(indices) // 3

        return vertex_count, face_count

    def _count_bones(self) -> int:
        """Count bones from VRM skeleton."""
        # In glTF, bones are represented as nodes
        nodes = self.json_data.get("nodes", [])
        return len(nodes)

    def _count_morphs(self) -> int:
        """Count morphs from VRM Expressions."""
        morph_count = 0
        extensions = self.json_data.get("extensions", {})

        # VRM 1.0: VRMC_vrm.expressions
        if "VRMC_vrm" in extensions:
            vrmc = extensions["VRMC_vrm"]
            expressions = vrmc.get("expressions", {})
            if isinstance(expressions, dict):
                morph_count = len(expressions)

        # VRM 0.x: VRM.blendShapeMaster.blendShapeGroups
        elif "VRM" in extensions:
            vrm_ext = extensions["VRM"]
            blend_shape_master = vrm_ext.get("blendShapeMaster", {})
            blend_shape_groups = blend_shape_master.get("blendShapeGroups", [])
            morph_count = len(blend_shape_groups)

        return morph_count

    def _count_materials(self) -> int:
        """Count materials."""
        materials = self.json_data.get("materials", [])
        return len(materials)

    def _count_textures(self) -> int:
        """Count textures."""
        images = self.json_data.get("images", [])
        return len(images)

    def _count_rigidbodies(self) -> int:
        """Count rigidbodies (from physics extension)."""
        # This is a placeholder - would need full VRM physics analysis
        # For now, return 0 and mark as estimated
        return 0

    def _count_joints(self) -> int:
        """Count joints (from physics extension)."""
        # This is a placeholder - would need full VRM physics analysis
        # For now, return 0 and mark as estimated
        return 0

    def count(self) -> VrmGeometryCount:
        """Perform full geometry count."""
        try:
            self._load_glb()

            vertex_count, face_count = self._count_meshes()
            bone_count = self._count_bones()
            morph_count = self._count_morphs()
            material_count = self._count_materials()
            texture_count = self._count_textures()
            rigidbody_count = self._count_rigidbodies()
            joint_count = self._count_joints()

            return VrmGeometryCount(
                vertices=vertex_count,
                faces=face_count,
                bones=bone_count,
                morphs=morph_count,
                materials=material_count,
                textures=texture_count,
                rigidbodies=rigidbody_count,
                joints=joint_count,
            )

        except Exception as e:
            return VrmGeometryCount(error_msg=str(e))
