#!/usr/bin/env python3
import struct

def parse_pmx_find_bone5_flag(pmx_path):
    """
    Find bone_index 5 flag position in PMX file
    """
    with open(pmx_path, "rb") as f:
        data = f.read()

    # Validate header
    if data[:4] != b'PMX ':
        print("Invalid PMX header")
        return

    # Read globals
    offset = 8
    globals_len = data[offset]
    vertex_idx_size = data[offset + 3] if globals_len > 2 else 4
    bone_idx_size = data[offset + 6] if globals_len > 5 else 4
    offset += 1 + globals_len

    print(f"Globals len: {globals_len}, vertex_idx_size: {vertex_idx_size}, bone_idx_size: {bone_idx_size}")
    print(f"Offset after globals: {offset}")

    # Skip 4 text fields (header texts)
    for i in range(4):
        text_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4
        offset += max(0, text_len)
        print(f"  Text {i}: len={text_len}, offset now={offset}")

    # Skip vertices
    vertex_count = struct.unpack("<i", data[offset:offset+4])[0]
    offset += 4
    for i in range(vertex_count):
        # Each vertex: pos(12) + normal(12) + uv(8) + deform(variable) + edge(4)
        offset += 12 + 12 + 8
        deform_type = data[offset]
        offset += 1
        if deform_type == 0:
            offset += bone_idx_size
        elif deform_type == 1:
            offset += bone_idx_size * 2 + 4
        elif deform_type in [2, 4]:
            offset += bone_idx_size * 4 + 16
        elif deform_type == 3:
            offset += bone_idx_size * 2 + 4 + 36
        offset += 4

    print(f"Offset after vertices: {offset}")

    # Skip indices
    index_count = struct.unpack("<i", data[offset:offset+4])[0]
    offset += 4
    offset += index_count * vertex_idx_size
    print(f"Offset after indices: {offset}")

    # Skip textures
    texture_count = struct.unpack("<i", data[offset:offset+4])[0]
    offset += 4
    for i in range(texture_count):
        text_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, text_len)
    print(f"Offset after textures: {offset}")

    # Skip materials
    material_count = struct.unpack("<i", data[offset:offset+4])[0]
    offset += 4
    texture_idx_size = vertex_idx_size  # In PMX, material texture index uses same size as vertex index
    for i in range(material_count):
        # name JP/EN
        name_jp_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, name_jp_len)
        name_en_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, name_en_len)
        # rest of material
        offset += 16 + 12 + 4 + 12 + 1 + 20  # colors/flags/edge
        offset += texture_idx_size  # texture index
        offset += texture_idx_size  # sphere texture
        offset += 1  # sphere mode
        toon_sharing = data[offset]
        offset += 1
        if toon_sharing == 0:
            offset += texture_idx_size  # shared toon
        else:
            offset += 1  # toon index as byte
        comment_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, comment_len)
        offset += 4  # vertex count

    print(f"Offset after materials: {offset}")

    # Now at bones
    bone_count = struct.unpack("<i", data[offset:offset+4])[0]
    offset += 4

    print(f"Bone count: {bone_count}, offset: {offset}")

    # Find bone 5
    for bone_idx in range(bone_count):
        name_jp_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, name_jp_len)
        name_en_len = struct.unpack("<i", data[offset:offset+4])[0]
        offset += 4 + max(0, name_en_len)

        if bone_idx == 5:
            # Position + parent + layer
            offset += 12 + bone_idx_size + 4
            flag_pos = offset
            current_flag = struct.unpack("<h", data[offset:offset+2])[0]
            print(f"Bone 5: flag position={flag_pos}, current value={current_flag} (0x{current_flag:02x})")
            print(f"  Should be 27 (0x1b), bytes: {data[flag_pos:flag_pos+2].hex()}")
            return flag_pos
        else:
            offset += 12 + bone_idx_size + 4 + 2  # skip position, parent, layer, flag

parse_pmx_find_bone5_flag("tmp/test_boneflag.pmx")
