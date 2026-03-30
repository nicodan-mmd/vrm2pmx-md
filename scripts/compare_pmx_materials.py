import json
import os
import sys


FLAG_LABELS = {
    0x01: "double_sided",
    0x02: "ground_shadow",
    0x04: "self_shadow_map",
    0x08: "self_shadow",
    0x10: "edge",
}


def to_float_list(value):
    if value is None:
        return None
    if hasattr(value, "x") and hasattr(value, "y") and hasattr(value, "z"):
        result = [float(value.x()), float(value.y()), float(value.z())]
        if hasattr(value, "w"):
            result.append(float(value.w()))
        return result
    if isinstance(value, (list, tuple)):
        return [float(v) for v in value]
    return value


def decode_flags(flag_value):
    return {
        name: bool(flag_value & bit)
        for bit, name in FLAG_LABELS.items()
    }


def resolve_texture(textures, texture_index, toon_sharing_flag=None):
    if toon_sharing_flag == 1:
        return f"shared_toon:{texture_index}"
    if texture_index is None or texture_index < 0:
        return None
    if 0 <= texture_index < len(textures):
        return textures[texture_index]
    return f"out_of_range:{texture_index}"


def material_snapshot(model, material_name):
    material = model.materials[material_name]
    textures = list(model.textures)
    return {
        "index": material.index,
        "name": material.name,
        "english_name": material.english_name,
        "diffuse_color": to_float_list(material.diffuse_color),
        "alpha": float(material.alpha),
        "specular_color": to_float_list(material.specular_color),
        "specular_factor": float(material.specular_factor),
        "ambient_color": to_float_list(material.ambient_color),
        "flag": int(material.flag),
        "flags": decode_flags(material.flag),
        "edge_color": to_float_list(material.edge_color),
        "edge_size": float(material.edge_size),
        "texture_index": int(material.texture_index),
        "texture_path": resolve_texture(textures, material.texture_index),
        "sphere_texture_index": int(material.sphere_texture_index),
        "sphere_texture_path": resolve_texture(textures, material.sphere_texture_index),
        "sphere_mode": int(material.sphere_mode),
        "toon_sharing_flag": int(material.toon_sharing_flag),
        "toon_texture_index": int(material.toon_texture_index),
        "toon_texture_path": resolve_texture(
            textures,
            material.toon_texture_index,
            toon_sharing_flag=material.toon_sharing_flag,
        ),
        "vertex_count": int(material.vertex_count),
        "comment": material.comment,
    }


def compare_values(reference, candidate):
    differences = {}
    for key in sorted(set(reference.keys()) | set(candidate.keys())):
        if reference.get(key) != candidate.get(key):
            differences[key] = {
                "reference": reference.get(key),
                "candidate": candidate.get(key),
            }
    return differences


def summarize(model):
    materials = list(model.materials.values())
    double_sided = 0
    textured = 0
    sphere_textured = 0
    for material in materials:
        if material.flag & 0x01:
            double_sided += 1
        if material.texture_index >= 0:
            textured += 1
        if material.sphere_texture_index >= 0:
            sphere_textured += 1
    return {
        "material_count": len(materials),
        "texture_count": len(model.textures),
        "double_sided_material_count": double_sided,
        "textured_material_count": textured,
        "sphere_textured_material_count": sphere_textured,
    }


def main():
    if len(sys.argv) < 3:
        print(
            "usage: compare_pmx_materials.py <reference_pmx> <candidate_pmx> [output_json]"
        )
        return 2

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    sys.path.insert(0, os.path.join(repo_root, "src"))

    from mmd.PmxReader import PmxReader  # pylint: disable=import-error

    reference_path = os.path.abspath(sys.argv[1])
    candidate_path = os.path.abspath(sys.argv[2])
    output_json_path = os.path.abspath(sys.argv[3]) if len(sys.argv) >= 4 else None

    reference_model = PmxReader(reference_path, is_check=False).read_data()
    candidate_model = PmxReader(candidate_path, is_check=False).read_data()

    reference_names = list(reference_model.materials.keys())
    candidate_names = list(candidate_model.materials.keys())
    common_names = sorted(set(reference_names) & set(candidate_names))

    material_differences = {}
    for name in common_names:
        reference_snapshot = material_snapshot(reference_model, name)
        candidate_snapshot = material_snapshot(candidate_model, name)
        differences = compare_values(reference_snapshot, candidate_snapshot)
        if differences:
            material_differences[name] = differences

    result = {
        "meta": {
            "reference_pmx": reference_path,
            "candidate_pmx": candidate_path,
        },
        "summary": {
            "reference": summarize(reference_model),
            "candidate": summarize(candidate_model),
            "common_material_count": len(common_names),
            "reference_only_materials": sorted(set(reference_names) - set(candidate_names)),
            "candidate_only_materials": sorted(set(candidate_names) - set(reference_names)),
            "different_material_count": len(material_differences),
        },
        "material_order": {
            "reference": reference_names,
            "candidate": candidate_names,
        },
        "material_differences": material_differences,
    }

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if output_json_path:
        with open(output_json_path, "w", encoding="utf-8") as file_obj:
            file_obj.write(text)

    print("===COMPARE_JSON_START===")
    print(text)
    print("===COMPARE_JSON_END===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())