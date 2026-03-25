# -*- coding: utf-8 -*-
#
import json
import math
import os
import re
import shutil
import struct
import urllib.parse
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops

from config.default_pairs import MORPH_PAIRS
from mmd.PmxData import (  # noqa
    Bdef1,
    Bdef2,
    Bdef4,
    Bone,
    DisplaySlot,
    GroupMorphData,
    Ik,
    IkLink,
    Joint,
    Material,
    Morph,
    PmxModel,
    RigidBody,
    Vertex,
    VertexMorphOffset,
)
from mmd.PmxReader import PmxReader  # noqa
from mmd.VrmData import VrmModel  # noqa
from module.MMath import (  # noqa
    MMatrix4x4,
    MQuaternion,
    MRect,
    MVector2D,
    MVector3D,
    MVector4D,
)
from service.profile_detection import detect_profile
from service.vrm_common import define_buf_type as _define_buf_type
from utils.MException import MKilledException, SizingException  # noqa
from utils.MLogger import MLogger  # noqa

logger = MLogger(__name__, level=1)

MIME_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/ktx": "ktx",
    "image/ktx2": "ktx2",
    "image/webp": "webp",
    "image/vnd-ms.dds": "dds",
    "audio/wav": "wav",
}

# MMDにおける1cm＝0.125(ミクセル)、1m＝12.5
MIKU_METER = 12.5


class VrmReader(PmxReader):
    def __init__(self, file_path: str, is_check=True):
        self.file_path = file_path
        self.bone_pairs = {}
        self.physics_pairs = {}
        self.is_check = is_check
        self.offset = 0
        self.buffer = b""

    def read_model_name(self):
        return ""

    @staticmethod
    def _is_vroid_profile(profile_name: str | None) -> bool:
        return profile_name == "vroid"

    @staticmethod
    def _normalize_morph_weight(weight: Any) -> float:
        try:
            weight_value = float(weight)
        except (TypeError, ValueError):
            return 0.0

        return (weight_value / 100.0) if weight_value > 1.0 else weight_value

    def _iter_expression_groups(self, vrm: VrmModel) -> list[dict[str, Any]]:
        extensions = vrm.json_data.get("extensions", {})
        vrm0_extension = extensions.get("VRM", {})
        vrm1_extension = extensions.get("VRMC_vrm", {})

        if (
            "blendShapeMaster" in vrm0_extension
            and "blendShapeGroups" in vrm0_extension["blendShapeMaster"]
        ):
            return list(vrm0_extension["blendShapeMaster"]["blendShapeGroups"])

        expressions = vrm1_extension.get("expressions", {})
        expression_groups: list[dict[str, Any]] = []
        for expression_type in ["preset", "custom"]:
            expression_map = expressions.get(expression_type, {})
            if not isinstance(expression_map, dict):
                continue

            for expression_name, expression in expression_map.items():
                if not isinstance(expression, dict):
                    continue

                morph_target_binds = expression.get("morphTargetBinds", [])
                binds = []
                for bind in morph_target_binds:
                    if not isinstance(bind, dict):
                        continue
                    binds.append(
                        {
                            "index": bind.get("index"),
                            "weight": bind.get("weight", 0),
                        }
                    )

                expression_groups.append({"name": expression_name, "binds": binds})

        return expression_groups

    def _has_optional_physics_source(self, vrm: VrmModel) -> bool:
        extensions = vrm.json_data.get("extensions", {})
        if "VRMC_springBone" in extensions:
            return True

        secondary_animation = extensions.get("VRM", {}).get("secondaryAnimation", {})
        return bool(secondary_animation.get("boneGroups"))

    def _resolve_center_position(self, pmx: PmxModel, profile_name: str) -> MVector3D:
        if self._is_vroid_profile(profile_name) and "腰" in pmx.bones:
            return pmx.bones["腰"].position * 0.7

        return MVector3D(
            0,
            (pmx.bones["左足"].position.y() + pmx.bones["左ひざ"].position.y()) / 2,
            0,
        )

    def _resolve_groove_position(self, pmx: PmxModel, profile_name: str) -> MVector3D:
        if self._is_vroid_profile(profile_name) and "腰" in pmx.bones:
            return pmx.bones["腰"].position * 0.8

        return MVector3D(0, pmx.bones["センター"].position.y() * 1.025, 0)

    def _resolve_both_eyes_position(
        self, pmx: PmxModel, bone_name: str, profile_name: str
    ) -> MVector3D:
        if self._is_vroid_profile(profile_name):
            if "左目" in pmx.bones and "右目" in pmx.bones:
                left_eye = pmx.bones["左目"].position
                right_eye = pmx.bones["右目"].position
                if left_eye != MVector3D() or right_eye != MVector3D():
                    return left_eye + ((right_eye - left_eye) / 2)

        return MVector3D(
            0,
            pmx.bones["頭"].position.y()
            + (pmx.bones["頭"].position.y() - pmx.bones["首"].position.y()) * 3,
            pmx.bones[bone_name].position.z() * 2,
        )

    def _resolve_material_key(
        self, material_name: str, alpha_mode: str, profile_name: str
    ) -> str:
        if self._is_vroid_profile(profile_name):
            if "EyeHighlight" in material_name:
                return "EyeHighlight"
            if "Eye" in material_name:
                return "Eye"

        return alpha_mode

    def read_data(self):  # type: ignore[override]
        # Pmxモデル生成
        vrm = VrmModel()
        vrm.path = self.file_path

        try:
            # UI側での読み込み処理はスキップ

            # ハッシュを設定
            vrm.digest = self.hexdigest()
            logger.test("vrm: %s, hash: %s", vrm.path, vrm.digest)

            return vrm
        except MKilledException as ke:
            # 終了命令
            raise ke
        except SizingException as se:
            logger.error(
                "VRM2PMX処理が処理できないデータで終了しました。\n\n%s",
                se.message,
                decoration=MLogger.DECORATION_BOX,
            )
            return se
        except Exception as e:
            import traceback

            logger.critical(
                "VRM2PMX処理が意図せぬエラーで終了しました。\n\n%s",
                traceback.format_exc(),
                decoration=MLogger.DECORATION_BOX,
            )
            raise e

    def convert_glTF(self, vrm: VrmModel, pmx: PmxModel, output_pmx_path: str):
        try:
            # テクスチャ用ディレクトリ
            tex_dir_path = os.path.join(
                str(Path(output_pmx_path).resolve().parents[0]), "tex"
            )
            os.makedirs(tex_dir_path, exist_ok=True)
            # 展開用ディレクトリ作成
            glft_dir_path = os.path.join(
                str(Path(output_pmx_path).resolve().parents[1]), "glTF"
            )
            os.makedirs(glft_dir_path, exist_ok=True)

            with open(self.file_path, "rb") as f:
                self.buffer = f.read()

                signature = self.unpack(12, "12s")
                logger.test("signature: %s (%s)", signature, self.offset)

                # JSON文字列読み込み
                json_buf_size = self.unpack(8, "L")
                json_text = self.read_text(json_buf_size)

                vrm.json_data = json.loads(json_text)

                detection = detect_profile(vrm.json_data, self.file_path)
                vrm.detected_profile = detection.profile
                vrm.profile_reason = detection.reason
                vrm.profile_metadata = detection.as_dict()

                logger.info(
                    "-- 自動判定 profile=%s reason=%s",
                    vrm.detected_profile,
                    vrm.profile_reason,
                )

                # JSON出力
                jf = open(
                    os.path.join(glft_dir_path, "gltf.json"), "w", encoding="utf-8"
                )
                json.dump(
                    vrm.json_data,
                    jf,
                    ensure_ascii=False,
                    indent=4,
                    sort_keys=True,
                    separators=(",", ": "),
                )
                logger.info("-- JSON出力終了")

                # binデータ
                bin_buf_size = self.unpack(8, "L")
                if bin_buf_size is None:
                    bin_buf_size = 0
                logger.test(f"bin_buf_size: {bin_buf_size}")

                with open(os.path.join(glft_dir_path, "data.bin"), "wb") as bf:
                    bf.write(self.buffer[self.offset : (self.offset + bin_buf_size)])

                # 空値をスフィア用に登録
                pmx.textures.append("")

                image_offset = 0
                if "images" in vrm.json_data:
                    # jsonデータの中に画像データの指定がある場合
                    for image in vrm.json_data["images"]:
                        if int(image["bufferView"]) < len(vrm.json_data["bufferViews"]):
                            image_buffer = vrm.json_data["bufferViews"][
                                int(image["bufferView"])
                            ]
                            # 画像の開始位置はオフセット分ずらす
                            image_start = self.offset + image_buffer["byteOffset"]
                            # 拡張子
                            ext = MIME_TYPE[image["mimeType"]]
                            # 画像名
                            image_name = f"{image['name']}.{ext}"
                            with open(
                                os.path.join(glft_dir_path, image_name), "wb"
                            ) as ibf:
                                ibf.write(
                                    self.buffer[
                                        image_start : (
                                            image_start + image_buffer["byteLength"]
                                        )
                                    ]
                                )
                            # オフセット加算
                            image_offset += image_buffer["byteLength"]
                            # PMXに追記
                            pmx.textures.append(os.path.join("tex", image_name))
                            # テクスチャコピー
                            shutil.copy(
                                os.path.join(glft_dir_path, image_name),
                                os.path.join(tex_dir_path, image_name),
                            )

                logger.info("-- テクスチャデータ解析終了")

                vertex_idx = 0
                pmx.indices = []
                accessors = {}
                materials_by_type = {}
                indices_by_material = {}
                node_pairs = {}
                bones = {}
                node_world_matrices = []

                if "nodes" in vrm.json_data:
                    node_world_matrices = self.get_node_world_matrices(vrm)
                    for nidx, _ in enumerate(vrm.json_data["nodes"]):
                        self.define_bone(
                            vrm,
                            bones,
                            nidx,
                            "",
                            node_pairs,
                            node_world_matrices,
                        )

                profile_name = getattr(vrm, "detected_profile", "generic")
                if self._is_vroid_profile(profile_name):
                    logger.info("-- VRoidProfile: bone/material tuning enabled")

                # ボーンの定義
                self.custom_bones(pmx, bones, profile_name)

                logger.info(f"-- ボーンデータ解析[{len(pmx.bones.keys())}]")
                logger.info("-- ノードワールド行列計算終了")

                # 表示枠 ------------------------
                pmx.display_slots["全ての親"] = DisplaySlot("Root", "Root", 1, 1)
                pmx.display_slots["全ての親"].references.append(0)

                # モーフの表示枠
                pmx.display_slots["表情"] = DisplaySlot("表情", "Exp", 1, 1)

                if "meshes" in vrm.json_data:
                    for midx, mesh in enumerate(vrm.json_data["meshes"]):
                        if "primitives" in mesh:
                            for pidx, primitive in enumerate(mesh["primitives"]):
                                if "attributes" in primitive:
                                    # 頂点データ
                                    if (
                                        primitive["attributes"]["POSITION"]
                                        not in accessors
                                    ):
                                        # 位置データ
                                        positions = self.read_from_accessor(
                                            vrm, primitive["attributes"]["POSITION"]
                                        )

                                        # 法線データ
                                        normals = self.read_from_accessor(
                                            vrm, primitive["attributes"]["NORMAL"]
                                        )

                                        # UVデータ
                                        if "TEXCOORD_0" in primitive["attributes"]:
                                            uvs = self.read_from_accessor(
                                                vrm, primitive["attributes"]["TEXCOORD_0"]
                                            )
                                        else:
                                            # テクスチャ座標がない場合、デフォルト値を使用
                                            uvs = [MVector2D() for _ in range(len(positions))]

                                        # ジョイントデータ(MMDのジョイントとは異なる)
                                        if "JOINTS_0" in primitive["attributes"]:
                                            joints = self.read_from_accessor(
                                                vrm, primitive["attributes"]["JOINTS_0"]
                                            )
                                        else:
                                            joints = [
                                                MVector4D()
                                                for _ in range(len(positions))
                                            ]

                                        # ウェイトデータ
                                        if "WEIGHTS_0" in primitive["attributes"]:
                                            weights = self.read_from_accessor(
                                                vrm,
                                                primitive["attributes"]["WEIGHTS_0"],
                                            )
                                        else:
                                            weights = [
                                                MVector4D()
                                                for _ in range(len(positions))
                                            ]

                                        # 対応するジョイントデータ
                                        skin_inverse_bind_matrices = []
                                        try:
                                            skin_joints = vrm.json_data["skins"][
                                                [
                                                    s
                                                    for s in vrm.json_data["nodes"]
                                                    if "mesh" in s and s["mesh"] == midx
                                                ][0]["skin"]
                                            ]["joints"]

                                            skin_idx = [
                                                s
                                                for s in vrm.json_data["nodes"]
                                                if "mesh" in s and s["mesh"] == midx
                                            ][0]["skin"]
                                            skin_data = vrm.json_data["skins"][skin_idx]
                                            if "inverseBindMatrices" in skin_data:
                                                skin_inverse_bind_matrices = (
                                                    self.read_mat4_from_accessor(
                                                        vrm,
                                                        skin_data["inverseBindMatrices"],
                                                    )
                                                )
                                        except Exception as e:
                                            # 取れない場合はとりあえず空
                                            logger.warning(
                                                "-- skin metadata fallback (mesh=%s): %s",
                                                midx,
                                                e,
                                            )
                                            skin_joints = []
                                            skin_inverse_bind_matrices = []

                                        if (
                                            "extras" in primitive
                                            and "targetNames" in primitive["extras"]
                                            and "targets" in primitive
                                        ):
                                            for eidx, (extra, target) in enumerate(
                                                zip(
                                                    primitive["extras"]["targetNames"],
                                                    primitive["targets"],
                                                    strict=False,
                                                )
                                            ):
                                                # 位置データ
                                                extra_positions = (
                                                    self.read_from_accessor(
                                                        vrm, target["POSITION"]
                                                    )
                                                )

                                                # 法線データ
                                                extra_normals = self.read_from_accessor(
                                                    vrm, target["NORMAL"]
                                                )

                                                morph = Morph(extra, extra, 1, 1)
                                                morph.index = eidx

                                                morph_vertex_idx = vertex_idx
                                                for _, (eposition, _) in enumerate(
                                                    zip(
                                                        extra_positions,
                                                        extra_normals,
                                                        strict=False,
                                                    )
                                                ):
                                                    pmx_eposition = (
                                                        eposition
                                                        * MIKU_METER
                                                        * MVector3D(-1, 1, 1)
                                                    )
                                                    # pmx_enormal = enormal * MVector3D(-1, 1, 1)

                                                    morph.offsets.append(
                                                        VertexMorphOffset(
                                                            morph_vertex_idx,
                                                            pmx_eposition,
                                                        )
                                                    )
                                                    morph_vertex_idx += 1

                                                pmx.morphs[morph.index] = morph
                                                # 頂点モーフそのものは表示枠に入れない（グループモーフのみ）
                                                # pmx.display_slots["表情"].references.append(morph.index)

                                        for vidx, (
                                            position,
                                            normal,
                                            uv,
                                            joint,
                                            weight,
                                        ) in enumerate(
                                            zip(
                                                positions,
                                                normals,
                                                uvs,
                                                joints,
                                                weights,
                                                strict=False,
                                            )
                                        ):
                                            posed_position = self.apply_skinning_pose(
                                                position,
                                                joint,
                                                weight,
                                                skin_joints,
                                                skin_inverse_bind_matrices,
                                                node_world_matrices,
                                            )
                                            pmx_position = (
                                                posed_position
                                                * MIKU_METER
                                                * MVector3D(-1, 1, 1)
                                            )

                                            # 有効なINDEX番号と実際のボーンINDEXを取得
                                            joint_idxs, weight_values = (
                                                self.get_deform_index(
                                                    vertex_idx,
                                                    pmx,
                                                    pmx_position,
                                                    joint,
                                                    skin_joints,
                                                    node_pairs,
                                                    weight,
                                                )
                                            )
                                            if len(joint_idxs) > 1:
                                                if len(joint_idxs) == 2:
                                                    # ウェイトが2つの場合、Bdef2
                                                    deform = Bdef2(
                                                        joint_idxs[0],
                                                        joint_idxs[1],
                                                        weight_values[0],
                                                    )
                                                else:
                                                    # それ以上の場合、Bdef4
                                                    deform = Bdef4(
                                                        joint_idxs[0],
                                                        joint_idxs[1],
                                                        joint_idxs[2],
                                                        joint_idxs[3],
                                                        weight_values[0],
                                                        weight_values[1],
                                                        weight_values[2],
                                                        weight_values[3],
                                                    )
                                            elif len(joint_idxs) == 1:
                                                # ウェイトが1つのみの場合、Bdef1
                                                deform = Bdef1(joint_idxs[0])
                                            else:
                                                # とりあえず除外
                                                deform = Bdef1(0)

                                            vertex = Vertex(
                                                vertex_idx,
                                                pmx_position,
                                                normal * MVector3D(-1, 1, 1),
                                                uv,
                                                None,
                                                deform,
                                                1,
                                            )
                                            if vidx == 0:
                                                # ブロック毎の開始頂点INDEXを保持
                                                accessors[
                                                    primitive["attributes"]["POSITION"]
                                                ] = vertex_idx

                                            if (
                                                primitive["material"]
                                                not in pmx.vertices
                                            ):
                                                pmx.vertices[primitive["material"]] = []
                                            pmx.vertices[primitive["material"]].append(
                                                vertex
                                            )

                                            vertex_idx += 1

                                        logger.info(
                                            f'-- 頂点データ解析[{primitive["material"]}-{primitive["attributes"]["NORMAL"]}-{primitive["attributes"].get("TEXCOORD_0", "N/A")}]'
                                        )

                                        logger.test(
                                            f'{midx}-{pidx}: start({pmx.vertices[primitive["material"]][0].index}): {[v.position.to_log() for v in pmx.vertices[primitive["material"]][:3]]}'
                                        )
                                        logger.test(
                                            f'{midx}-{pidx}: end({pmx.vertices[primitive["material"]][-1].index}): {[v.position.to_log() for v in pmx.vertices[primitive["material"]][-3:-1]]}'
                                        )

                hair_regexp = r"((F\d+_\d+_Hair_\d+)_HAIR)"

                if "meshes" in vrm.json_data:
                    for midx, mesh in enumerate(vrm.json_data["meshes"]):
                        if "primitives" in mesh:
                            for pidx, primitive in enumerate(
                                sorted(mesh["primitives"], key=lambda x: x["material"])
                            ):
                                if (
                                    "material" in primitive
                                    and "materials" in vrm.json_data
                                    and primitive["material"]
                                    < len(vrm.json_data["materials"])
                                ):
                                    # 材質データ
                                    vrm_material = vrm.json_data["materials"][
                                        primitive["material"]
                                    ]
                                    logger.test(
                                        f'material: {primitive["material"]} -> {vrm_material["name"]}'
                                    )

                                    indices = []
                                    if "indices" in primitive:
                                        # 面データ
                                        indices = self.read_from_accessor(
                                            vrm, primitive["indices"]
                                        )
                                        for iidx, index in enumerate(indices):
                                            vertex_idx = (
                                                index
                                                + accessors[
                                                    primitive["attributes"]["POSITION"]
                                                ]
                                            )
                                            # 材質別に面を保持
                                            if (
                                                vrm_material["name"]
                                                not in indices_by_material
                                            ):
                                                indices_by_material[
                                                    vrm_material["name"]
                                                ] = []
                                            indices_by_material[
                                                vrm_material["name"]
                                            ].append(vertex_idx)

                                            if iidx < 3 or iidx > len(indices) - 4:
                                                logger.test(
                                                    f"{iidx}: {index} -> {vertex_idx}"
                                                )

                                        if pidx % 5 == 0:
                                            logger.info(
                                                f'-- 面データ解析[{primitive["indices"]}]'
                                            )
                                        logger.test(
                                            f'{midx}-{pidx}: indices: {primitive["indices"]} {indices[:9]} max: {max(indices)}, '
                                            f'{len(indices)}/{len(indices_by_material[vrm_material["name"]])}'
                                        )

                                    if (
                                        vrm_material["alphaMode"]
                                        not in materials_by_type
                                        or vrm_material["name"]
                                        not in materials_by_type[
                                            vrm_material["alphaMode"]
                                        ]
                                    ):
                                        # 材質種別別に材質の存在がない場合

                                        # VRMの材質拡張情報（VRM0.x のみ存在、VRM1.x ではデフォルト値を使用）
                                        _vrm0_material_props = (
                                            vrm.json_data.get("extensions", {})
                                            .get("VRM", {})
                                            .get("materialProperties", [])
                                        )
                                        _material_ext_list = [
                                            m
                                            for m in _vrm0_material_props
                                            if m["name"] == vrm_material["name"]
                                        ]
                                        if _material_ext_list:
                                            material_ext = _material_ext_list[0]
                                        else:
                                            logger.warning(
                                                "-- materialProperties not found for '%s' (VRM1.0?): using defaults",
                                                vrm_material["name"],
                                            )
                                            material_ext = {}
                                        # 拡散色
                                        diffuse_color_data = vrm_material[
                                            "pbrMetallicRoughness"
                                        ]["baseColorFactor"]
                                        diffuse_color = MVector3D(
                                            diffuse_color_data[:3]
                                        )
                                        # 非透過度
                                        alpha = diffuse_color_data[3]
                                        # 反射色
                                        if "emissiveFactor" in vrm_material:
                                            specular_color_data = vrm_material[
                                                "emissiveFactor"
                                            ]
                                            specular_color = MVector3D(
                                                specular_color_data[:3]
                                            )
                                        else:
                                            specular_color = MVector3D()
                                        specular_factor = 0
                                        # 環境色
                                        if (
                                            "vectorProperties" in material_ext
                                            and "_ShadeColor"
                                            in material_ext["vectorProperties"]
                                        ):
                                            ambient_color = MVector3D(
                                                material_ext["vectorProperties"][
                                                    "_ShadeColor"
                                                ][:3]
                                            )
                                        else:
                                            ambient_color = diffuse_color / 2
                                        # 0x02:地面影, 0x04:セルフシャドウマップへの描画, 0x08:セルフシャドウの描画
                                        flag = 0x02 | 0x04 | 0x08
                                        if vrm_material["doubleSided"]:
                                            # 両面描画
                                            flag |= 0x01
                                        texture_props = material_ext.get(
                                            "textureProperties", {}
                                        )
                                        vector_props = material_ext.get(
                                            "vectorProperties", {}
                                        )
                                        float_props = material_ext.get(
                                            "floatProperties", {}
                                        )

                                        edge_color_data = vector_props.get(
                                            "_OutlineColor", [0, 0, 0, 1]
                                        )
                                        if (
                                            not isinstance(
                                                edge_color_data, (list, tuple)
                                            )
                                            or len(edge_color_data) < 4
                                        ):
                                            edge_color_data = [0, 0, 0, 1]
                                        edge_color = MVector4D(edge_color_data)
                                        edge_size = float_props.get(
                                            "_OutlineWidth", 0
                                        )

                                        texture_index = -1
                                        if "_MainTex" in texture_props:
                                            candidate_texture_index = (
                                                texture_props["_MainTex"] + 1
                                            )
                                            if 0 <= candidate_texture_index < len(
                                                pmx.textures
                                            ):
                                                texture_index = (
                                                    candidate_texture_index
                                                )
                                            else:
                                                logger.warning(
                                                    f'Main texture index out of range: material={vrm_material["name"]}, _MainTex={texture_props["_MainTex"]}'
                                                )
                                        else:
                                            logger.warning(
                                                f'Main texture missing: material={vrm_material["name"]}'
                                            )

                                        # 0番目は空テクスチャなので+1で設定
                                        m = re.search(hair_regexp, vrm_material["name"])
                                        if (
                                            self._is_vroid_profile(profile_name)
                                            and m is not None
                                            and texture_index > 0
                                        ):
                                            # 髪材質の場合、合成
                                            hair_img_name = os.path.basename(
                                                pmx.textures[texture_index]
                                            )
                                            hair_spe_name = f"{m.groups()[1]}_spe.png"
                                            hair_blend_name = (
                                                f"{m.groups()[0]}_blend.png"
                                            )

                                            if os.path.exists(
                                                os.path.join(
                                                    tex_dir_path, hair_img_name
                                                )
                                            ) and os.path.exists(
                                                os.path.join(
                                                    tex_dir_path, hair_spe_name
                                                )
                                            ):
                                                # スペキュラファイルがある場合
                                                hair_img = Image.open(
                                                    os.path.join(
                                                        tex_dir_path, hair_img_name
                                                    )
                                                )
                                                hair_ary = np.array(hair_img)

                                                spe_img = Image.open(
                                                    os.path.join(
                                                        tex_dir_path, hair_spe_name
                                                    )
                                                )
                                                spe_ary = np.array(spe_img)

                                                # 拡散色の画像
                                                diffuse_ary = np.array(
                                                    vector_props.get(
                                                        "_Color",
                                                        [1, 1, 1, 1],
                                                    )
                                                )
                                                diffuse_img = Image.fromarray(
                                                    np.tile(
                                                        diffuse_ary * 255,
                                                        (
                                                            hair_ary.shape[0],
                                                            hair_ary.shape[1],
                                                            1,
                                                        ),
                                                    ).astype(np.uint8)
                                                )
                                                hair_diffuse_img = ImageChops.multiply(
                                                    hair_img, diffuse_img
                                                )

                                                # 反射色の画像
                                                if "emissiveFactor" in vrm_material:
                                                    emissive_ary = np.array(
                                                        vrm_material["emissiveFactor"]
                                                    )
                                                    emissive_ary = np.append(
                                                        emissive_ary, 1
                                                    )
                                                else:
                                                    emissive_ary = np.array(
                                                        [0, 0, 0, 1]
                                                    )
                                                emissive_img = Image.fromarray(
                                                    np.tile(
                                                        emissive_ary * 255,
                                                        (
                                                            spe_ary.shape[0],
                                                            spe_ary.shape[1],
                                                            1,
                                                        ),
                                                    ).astype(np.uint8)
                                                )
                                                # 乗算
                                                hair_emissive_img = ImageChops.multiply(
                                                    spe_img, emissive_img
                                                )
                                                # スクリーン
                                                dest_img = ImageChops.screen(
                                                    hair_diffuse_img, hair_emissive_img
                                                )
                                                dest_img.save(
                                                    os.path.join(
                                                        tex_dir_path, hair_blend_name
                                                    )
                                                )

                                                pmx.textures.append(
                                                    os.path.join("tex", hair_blend_name)
                                                )
                                                texture_index = len(pmx.textures) - 1

                                                # 拡散色と環境色は固定
                                                diffuse_color = MVector3D(1, 1, 1)
                                                specular_color = MVector3D()
                                                ambient_color = diffuse_color / 2
                                        elif (
                                            self._is_vroid_profile(profile_name)
                                            and m is not None
                                        ):
                                            logger.warning(
                                                f'Hair blend skipped due to missing main texture: material={vrm_material["name"]}'
                                            )
                                        else:
                                            # そのまま出力
                                            pass

                                        sphere_texture_index = -1
                                        sphere_mode = 0
                                        if "_SphereAdd" in texture_props:
                                            candidate_sphere_index = (
                                                texture_props["_SphereAdd"] + 1
                                            )
                                            if 0 <= candidate_sphere_index < len(
                                                pmx.textures
                                            ):
                                                sphere_texture_index = (
                                                    candidate_sphere_index
                                                )
                                                # 加算スフィア
                                                sphere_mode = 2
                                            else:
                                                logger.warning(
                                                    f'Sphere texture index out of range: material={vrm_material["name"]}, _SphereAdd={texture_props["_SphereAdd"]}'
                                                )

                                        if (
                                            "vectorProperties" in material_ext
                                            and "_ShadeColor"
                                            in material_ext["vectorProperties"]
                                        ):
                                            toon_sharing_flag = 0
                                            toon_img_name = (
                                                f'{vrm_material["name"]}_TOON.bmp'
                                            )

                                            toon_light_ary = np.tile(
                                                np.array([255, 255, 255, 255]),
                                                (24, 32, 1),
                                            )
                                            toon_shadow_ary = np.tile(
                                                np.array(
                                                    material_ext["vectorProperties"][
                                                        "_ShadeColor"
                                                    ]
                                                )
                                                * 255,
                                                (8, 32, 1),
                                            )
                                            toon_ary = np.concatenate(
                                                (toon_light_ary, toon_shadow_ary),
                                                axis=0,
                                            )
                                            toon_img = Image.fromarray(
                                                toon_ary.astype(np.uint8)
                                            )

                                            toon_img.save(
                                                os.path.join(
                                                    tex_dir_path, toon_img_name
                                                )
                                            )
                                            pmx.textures.append(
                                                os.path.join("tex", toon_img_name)
                                            )
                                            # 最後に追加したテクスチャをINDEXとして設定
                                            toon_texture_index = len(pmx.textures) - 1
                                        else:
                                            toon_sharing_flag = 1
                                            toon_texture_index = 1

                                        material = Material(
                                            vrm_material["name"],
                                            vrm_material["name"],
                                            diffuse_color,
                                            alpha,
                                            specular_factor,
                                            specular_color,
                                            ambient_color,
                                            flag,
                                            edge_color,
                                            edge_size,
                                            texture_index,
                                            sphere_texture_index,
                                            sphere_mode,
                                            toon_sharing_flag,
                                            toon_texture_index,
                                            "",
                                            len(indices),
                                        )

                                        # 材質順番を決める
                                        material_key = self._resolve_material_key(
                                            material.name,
                                            vrm_material["alphaMode"],
                                            profile_name,
                                        )

                                        if material_key not in materials_by_type:
                                            materials_by_type[material_key] = {}
                                        materials_by_type[material_key][
                                            vrm_material["name"]
                                        ] = material

                                        logger.info(
                                            f'-- 材質データ解析[{vrm_material["name"]}]'
                                        )
                                    else:
                                        # 材質がある場合は、面数を加算する
                                        materials_by_type[vrm_material["alphaMode"]][
                                            vrm_material["name"]
                                        ].vertex_count += len(indices)

                # 材質を不透明(OPAQUE)→透明順(BLEND)に並べ替て設定
                for material_type in ["OPAQUE", "MASK", "BLEND", "Eye", "EyeHighlight"]:
                    if material_type in materials_by_type:
                        for material in materials_by_type[material_type].values():
                            pmx.materials[material.name] = material
                            for midx in range(
                                0, len(indices_by_material[material.name]), 3
                            ):
                                # 面の貼り方がPMXは逆
                                pmx.indices.append(
                                    indices_by_material[material.name][midx + 2]
                                )
                                pmx.indices.append(
                                    indices_by_material[material.name][midx + 1]
                                )
                                pmx.indices.append(
                                    indices_by_material[material.name][midx]
                                )

                # グループモーフ定義
                expression_groups = self._iter_expression_groups(vrm)
                if expression_groups:
                    for shape in expression_groups:
                        if len(shape.get("binds", [])) == 0:
                            continue

                        morph_name = shape["name"]
                        morph_panel = 4
                        if shape["name"] in MORPH_PAIRS:
                            morph_name = MORPH_PAIRS[shape["name"]]["name"]
                            morph_panel = MORPH_PAIRS[shape["name"]]["panel"]
                        morph = Morph(morph_name, shape["name"], morph_panel, 0)
                        morph.index = len(pmx.morphs)

                        if (
                            shape["name"] in MORPH_PAIRS
                            and "binds" in MORPH_PAIRS[shape["name"]]
                        ):
                            for bind in MORPH_PAIRS[shape["name"]]["binds"]:
                                if bind in pmx.morphs:
                                    morph.offsets.append(
                                        GroupMorphData(pmx.morphs[bind].index, 1)
                                    )
                        else:
                            for bind in shape.get("binds", []):
                                if bind.get("index") not in pmx.morphs:
                                    continue
                                morph.offsets.append(
                                    GroupMorphData(
                                        bind["index"],
                                        self._normalize_morph_weight(bind.get("weight")),
                                    )
                                )

                        if len(morph.offsets) == 0:
                            continue
                        pmx.morphs[morph_name] = morph
                        pmx.display_slots["表情"].references.append(morph.index)

                    for morph_pair in MORPH_PAIRS.values():
                        if "binds" in morph_pair:
                            morph = Morph(
                                morph_pair["name"],
                                morph_pair["name"],
                                morph_pair["panel"],
                                0,
                            )
                            morph.index = len(pmx.morphs)
                            for bind_name in morph_pair["binds"]:
                                if bind_name in pmx.morphs:
                                    bind_morph = pmx.morphs[bind_name]
                                    for group_morph in bind_morph.offsets:
                                        morph.offsets.append(
                                            GroupMorphData(
                                                group_morph.morph_index,
                                                group_morph.value,
                                            )
                                        )
                            pmx.morphs[morph_pair["name"]] = morph
                            pmx.display_slots["表情"].references.append(morph.index)

                logger.info("-- グループモーフデータ解析")

                enable_optional_physics = (
                    not self._is_vroid_profile(profile_name)
                    or self._has_optional_physics_source(vrm)
                )
                if not enable_optional_physics:
                    logger.warning(
                        "-- VRoidProfile: spring metadata not found, skipping optional physics generation"
                    )

                bone_vertices = {}
                # ボーンベースで頂点INDEXの分類
                for _, vertices in pmx.vertices.items():
                    for vertex in vertices:
                        for bone_idx in vertex.deform.get_idx_list(0.4):
                            if bone_idx not in bone_vertices:
                                bone_vertices[bone_idx] = []
                            bone = [
                                b for b in pmx.bones.values() if bone_idx == b.index
                            ][0]
                            bone_vertices[bone_idx].append(vertex)
                            if "捩" in bone.name:
                                # 捩りは親に入れる
                                if bone.parent_index not in bone_vertices:
                                    bone_vertices[bone.parent_index] = []
                                bone_vertices[bone.parent_index].append(vertex)
                            elif bone.getExternalRotationFlag():
                                # 回転付与の場合、付与親に入れる
                                if bone.effect_index not in bone_vertices:
                                    bone_vertices[bone.effect_index] = []
                                bone_vertices[bone.effect_index].append(vertex)

                # 髪の再命名
                hair_idx = 1
                for bone_name, bone in pmx.bones.items():
                    if "HairJoint" in bone_name:
                        if bone.parent_index == pmx.bones["頭"].index:
                            # 頭に直接ついてるボーンの場合、hair_idx加算
                            bone.name = f"髪_{hair_idx:02d}_01"
                            hair_idx += 1
                        elif bone.parent_index >= 0:
                            # 頭についてない場合は、親の名前を継承
                            parent_bone = [
                                b
                                for b in pmx.bones.values()
                                if b.index == bone.parent_index
                            ][0]
                            parent_suffix = int(parent_bone.name[-2:])
                            bone.name = (
                                f"{parent_bone.name[:4]}_{(parent_suffix + 1):02d}"
                            )

                # MMDモデル定義ベースの剛体
                for _, bone_config in self.bone_pairs.items():
                    bone_name = bone_config["name"]

                    if bone_config["rigidBody"] is not None:
                        rigidbody_no_collisions = 0
                        for nc in range(16):
                            if nc not in bone_config["rigidbodyNoCollisions"]:
                                rigidbody_no_collisions |= 1 << nc
                        self.create_rigidbody(
                            pmx,
                            bone_name,
                            bone_vertices,
                            bone_config["rigidBody"],
                            bone_config["rigidbodyMode"],
                            bone_config["rigidbodyFactor"],
                            bone_config["rigidbodyCollisions"],
                            rigidbody_no_collisions,
                            bone_config["rigidbodyParam"],
                            True,
                        )

                for bone_name, bone in pmx.bones.items():
                    if not enable_optional_physics:
                        continue

                    if (
                        bone.name not in pmx.rigidbodies
                        and "捩" not in bone.name
                        and not bone.getExternalRotationFlag()
                        and bone.index in bone_vertices
                    ):
                        bone_config = [
                            b
                            for b in self.bone_pairs.values()
                            if bone.name == b["name"]
                        ]
                        # MMDモデル定義外の剛体
                        if len(bone_config) == 0:
                            rigidbodies = [
                                rv
                                for rk, rv in self.physics_pairs.items()
                                if rk in bone.name
                            ]
                            target_rigidbody = (
                                rigidbodies[0]
                                if len(rigidbodies) > 0
                                else self.physics_pairs["Others"]
                            )
                            parent_bone = (
                                [
                                    b
                                    for b in pmx.bones.values()
                                    if b.index == bone.parent_index
                                ][0]
                                if bone.parent_index >= 0
                                else None
                            )
                            rigidbody_param_from = target_rigidbody[
                                "rigidbodyParamFrom"
                            ]
                            rigidbody_param_to = target_rigidbody["rigidbodyParamTo"]
                            parent_cnt = 0
                            if (
                                not parent_bone
                                or parent_bone.name in self.bone_pairs
                                or parent_bone.name not in pmx.rigidbodies
                                or (
                                    parent_bone.name in pmx.rigidbodies
                                    and pmx.rigidbodies[parent_bone.name].mode == 0
                                    and (
                                        not bone.name[-1].isdigit()
                                        or (
                                            bone.name[-1].isdigit()
                                            and int(bone.name[-1]) in [0, 1]
                                        )
                                    )
                                )
                            ):
                                # MMDモデル定義ボーンに繋がってる場合・親ボーンに剛体がない場合・親剛体がボーン追従剛体の場合、そのまま接続
                                rigidbody_mode = 1
                                # 親ボーンは自身
                            else:
                                # 子は物理合わせ
                                rigidbody_mode = 1
                                parent_bone = [
                                    b
                                    for b in pmx.bones.values()
                                    if b.index == bone.parent_index
                                ][0]
                                target_bone = bone.copy()

                                # 根元を探す
                                while target_bone.parent_index > -1:
                                    parent_cnt += 1
                                    parent_bone = [
                                        b
                                        for b in pmx.bones.values()
                                        if b.index == target_bone.parent_index
                                    ][0]
                                    if parent_bone.name not in pmx.rigidbodies:
                                        break
                                    # 親が見つからない場合、上に移動
                                    target_bone = parent_bone

                            # 末端を探す
                            child_cnt = 0
                            if bone.tail_index >= 0:
                                child_bones = [
                                    b
                                    for b in pmx.bones.values()
                                    if b.index == bone.tail_index
                                ][0]
                                target_bone = bone.copy()
                                while target_bone.tail_index > -1:
                                    child_cnt += 1
                                    child_bones = [
                                        b
                                        for b in pmx.bones.values()
                                        if b.index == target_bone.tail_index
                                    ]
                                    if len(child_bones) > 0:
                                        target_bone = child_bones[0]
                                    else:
                                        break

                            if parent_cnt + child_cnt <= 0:
                                continue

                            # 質量：末端からの二乗
                            # 減衰：根元から末端の線形補間
                            # 反発・摩擦：根元一定
                            rigidbody_param = [
                                rigidbody_param_to[0] * (child_cnt**2),
                                (
                                    rigidbody_param_from[1]
                                    + (
                                        (
                                            rigidbody_param_to[1]
                                            - rigidbody_param_from[1]
                                        )
                                        * (parent_cnt / (parent_cnt + child_cnt))
                                    )
                                ),
                                (
                                    rigidbody_param_from[1]
                                    + (
                                        (
                                            rigidbody_param_to[1]
                                            - rigidbody_param_from[1]
                                        )
                                        * (parent_cnt / (parent_cnt + child_cnt))
                                    )
                                ),
                                rigidbody_param_from[3],
                                rigidbody_param_from[4],
                            ]

                            rigidbody_type = target_rigidbody["rigidBody"]
                            rigid_factor = target_rigidbody["rigidbodyFactor"]
                            rigidbody_collision = target_rigidbody[
                                "rigidbodyCollisions"
                            ]
                            rigidbody_no_collisions = 0
                            rigidbody_no_collisions_list = target_rigidbody[
                                "rigidbodyNoCollisions"
                            ]
                            for nc in range(16):
                                if nc not in rigidbody_no_collisions_list:
                                    rigidbody_no_collisions |= 1 << nc
                            self.create_rigidbody(
                                pmx,
                                bone_name,
                                bone_vertices,
                                rigidbody_type,
                                rigidbody_mode,
                                rigid_factor,
                                rigidbody_collision,
                                rigidbody_no_collisions,
                                rigidbody_param,
                                False,
                            )

                            if rigidbody_mode in [1, 2]:
                                # ＋物理の場合、親とのジョイント生成
                                if len(rigidbodies) > 0:
                                    translation_limit_min = MVector3D(
                                        target_rigidbody["JointTLMin"]
                                    )
                                    translation_limit_max = MVector3D(
                                        target_rigidbody["JointTLMax"]
                                    )
                                    rotation_limit_min = MVector3D(
                                        math.radians(target_rigidbody["JointRLMin"][0]),
                                        math.radians(target_rigidbody["JointRLMin"][1]),
                                        math.radians(target_rigidbody["JointRLMin"][2]),
                                    )
                                    rotation_limit_max = MVector3D(
                                        math.radians(target_rigidbody["JointRLMax"][0]),
                                        math.radians(target_rigidbody["JointRLMax"][1]),
                                        math.radians(target_rigidbody["JointRLMax"][2]),
                                    )
                                    spring_constant_translation = MVector3D(
                                        target_rigidbody["JointSCT"]
                                    )
                                    spring_constant_rotation = MVector3D(
                                        target_rigidbody["JointSCR"][0],
                                        target_rigidbody["JointSCR"][1],
                                        target_rigidbody["JointSCR"][2],
                                    )
                                else:
                                    translation_limit_min = MVector3D()
                                    translation_limit_max = MVector3D()
                                    rotation_limit_min = MVector3D(
                                        math.radians(-10),
                                        math.radians(-1),
                                        math.radians(-5),
                                    )
                                    rotation_limit_max = MVector3D(
                                        math.radians(10),
                                        math.radians(1),
                                        math.radians(20),
                                    )
                                    spring_constant_translation = MVector3D()
                                    spring_constant_rotation = MVector3D(7, 7, 7)
                                self.create_joint(
                                    pmx,
                                    bone,
                                    translation_limit_min,
                                    translation_limit_max,
                                    rotation_limit_min,
                                    rotation_limit_max,
                                    spring_constant_translation,
                                    spring_constant_rotation,
                                )

                            logger.info(f"-- 剛体・ジョイントデータ解析[{bone.name}]")

                # スカートとかの横ジョイント
                # スカートの根元剛体リストを取得
                skirt_root_rigidbodies = {
                    rk: rv
                    for rk, rv in pmx.rigidbodies.items()
                    if "Skirt" in rv.name and rv.mode == 2
                }
                if len(skirt_root_rigidbodies) > 0:
                    skirt_root_bones = {
                        bv.index: bv
                        for bv in pmx.bones.values()
                        if bv.name in skirt_root_rigidbodies.keys()
                    }
                    self.create_all_horizonal_joint(
                        pmx, skirt_root_bones, skirt_root_rigidbodies
                    )

                # 胸先ジョイント
                bust_rigidbodies = {
                    rk: rv
                    for rk, rv in pmx.rigidbodies.items()
                    if "胸先" in rv.name and rv.mode == 2
                }
                if len(bust_rigidbodies) > 0:
                    bust_joint_setting = self.physics_pairs["胸先"]
                    for bone_name in bust_rigidbodies.keys():
                        if bone_name not in pmx.bones:
                            continue
                        bone = pmx.bones[bone_name]
                        translation_limit_min = MVector3D(
                            bust_joint_setting["JointTLMin"]
                        )
                        translation_limit_max = MVector3D(
                            bust_joint_setting["JointTLMax"]
                        )
                        rotation_limit_min = MVector3D(
                            math.radians(bust_joint_setting["JointRLMin"][0]),
                            math.radians(bust_joint_setting["JointRLMin"][1]),
                            math.radians(bust_joint_setting["JointRLMin"][2]),
                        )
                        rotation_limit_max = MVector3D(
                            math.radians(bust_joint_setting["JointRLMax"][0]),
                            math.radians(bust_joint_setting["JointRLMax"][1]),
                            math.radians(bust_joint_setting["JointRLMax"][2]),
                        )
                        spring_constant_translation = MVector3D(
                            bust_joint_setting["JointSCT"]
                        )
                        spring_constant_rotation = MVector3D(
                            bust_joint_setting["JointSCR"][0],
                            bust_joint_setting["JointSCR"][1],
                            bust_joint_setting["JointSCR"][2],
                        )
                        self.create_joint(
                            pmx,
                            bone,
                            translation_limit_min,
                            translation_limit_max,
                            rotation_limit_min,
                            rotation_limit_max,
                            spring_constant_translation,
                            spring_constant_rotation,
                        )

                logger.info("-- 剛体・ジョイントデータ解析終了")

                # ボーンの表示枠 ------------------------
                for jp_bone_name, bone in pmx.bones.items():
                    if "全ての親" == jp_bone_name:
                        continue

                    if (
                        bone.english_name in self.bone_pairs
                        or bone.name in self.bone_pairs
                    ):
                        # MMDボーン定義内の場合
                        bone_config = self.bone_pairs[bone.english_name]

                        if not bone_config["display"]:
                            continue
                        elif bone_config["display"] not in pmx.display_slots:
                            pmx.display_slots[bone_config["display"]] = DisplaySlot(
                                bone_config["display"], bone_config["display"], 0, 0
                            )

                        pmx.display_slots[bone_config["display"]].references.append(
                            pmx.bones[jp_bone_name].index
                        )
                    elif "髪" in bone.name:
                        if (
                            "髪" not in pmx.display_slots
                            and pmx.bones[jp_bone_name].getManipulatable()
                        ):
                            pmx.display_slots["髪"] = DisplaySlot("髪", "髪", 0, 0)
                        pmx.display_slots["髪"].references.append(
                            pmx.bones[jp_bone_name].index
                        )
                    elif bone.getManipulatable():
                        if (
                            "その他" not in pmx.display_slots
                            and pmx.bones[jp_bone_name].getManipulatable()
                        ):
                            pmx.display_slots["その他"] = DisplaySlot(
                                "その他", "その他", 0, 0
                            )
                        pmx.display_slots["その他"].references.append(
                            pmx.bones[jp_bone_name].index
                        )

                logger.info("-- 表示枠データ解析")

                # モデル名
                # モデル名（VRM0.x: extensions.VRM.meta, VRM1.x: extensions.VRMC_vrm.meta）
                _ext = vrm.json_data.get("extensions", {})
                _vrm0_meta = _ext.get("VRM", {}).get("meta", {})
                _vrm1_meta = _ext.get("VRMC_vrm", {}).get("meta", {})
                _meta_title = _vrm0_meta.get("title") or _vrm1_meta.get("name", "")
                _meta_author = _vrm0_meta.get("author") or ", ".join(
                    _vrm1_meta.get("authors", [])
                )
                _meta_license = _vrm0_meta.get("licenseName") or _vrm1_meta.get(
                    "licenseUrl", ""
                )

                pmx.name = _meta_title or os.path.basename(vrm.path).split(".")[0]

                licence_comment = ""
                if _vrm0_meta.get("licenseName") == "Other":
                    licence_dict = urllib.parse.parse_qs(
                        urllib.parse.urlparse(
                            _vrm0_meta.get("otherPermissionUrl", "")
                        ).query
                    )
                    for k, v in licence_dict.items():
                        licence_comment += f'　　{k}: {",".join(v)}\r\n'

                pmx.comment = (
                    f"モデル名: {_meta_title}\r\n"
                    + f"作者: {_meta_author}\r\n"
                    + f"ライセンス: {_meta_license}\r\n{licence_comment}\r\n"
                    + "変換: Vrm2PmxConverter (@miu200521358)"
                )

            return True
        except MKilledException as ke:
            # 終了命令
            raise ke
        except SizingException as se:
            logger.error(
                "VRM2PMX処理が処理できないデータで終了しました。\n\n%s",
                se.message,
                decoration=MLogger.DECORATION_BOX,
            )
            return se
        except Exception as e:
            import traceback

            logger.critical(
                "VRM2PMX処理が意図せぬエラーで終了しました。\n\n%s",
                traceback.format_exc(),
                decoration=MLogger.DECORATION_BOX,
            )
            raise e

    def create_all_horizonal_joint(
        self, pmx: PmxModel, skirt_bones: dict, skirt_rigidbodies: dict
    ):
        if list(skirt_rigidbodies.values())[0].mode == 1:
            # 物理の場合だけ、横ジョイント
            skirt_bone_poses = [
                b.position.data().tolist() for b in skirt_bones.values()
            ]
            # 最も右端(向かって左）、かつ手前（Zが小さい）のボーンを基点とする
            root_bone_idx = [
                i
                for i, v in enumerate(skirt_bone_poses)
                if sorted(skirt_bone_poses, key=lambda x: (x[0], x[2]))[0] == v
            ][0]
            # 横に繋いでいく
            self.create_horizonal_joint(
                pmx, skirt_bones, skirt_bone_poses, root_bone_idx, []
            )

        skirt_bones = {
            b.index: b for b in pmx.bones.values() if b.name in skirt_rigidbodies.keys()
        }
        child_skirt_bones = {
            b.name: b
            for b in pmx.bones.values()
            if b.parent_index in skirt_bones.keys()
        }

        if len(child_skirt_bones) > 0:
            # 子どもがいる場合、子どもを繋ぐ
            child_skirt_rigidbodies = {
                rk: rv
                for rk, rv in pmx.rigidbodies.items()
                if rk in child_skirt_bones.keys()
            }
            if len(child_skirt_rigidbodies) > 0:
                return self.create_all_horizonal_joint(
                    pmx, child_skirt_bones, child_skirt_rigidbodies
                )
            else:
                return
        else:
            return

    def create_horizonal_joint(
        self,
        pmx: PmxModel,
        skirt_bones: dict,
        skirt_bone_poses: list,
        root_bone_idx: int,
        registerd_idxs: list,
    ):
        # 基点ボーンから各ボーンの距離
        bone_distances = np.sum(
            np.abs(
                np.array(skirt_bone_poses) - np.array(skirt_bone_poses[root_bone_idx])
            )
            ** 2,
            axis=-1,
        ) ** (1.0 / 2)
        # 0番目は必ず自分自身
        root_skirt_bone = list(skirt_bones.values())[np.argsort(bone_distances)[0]]
        # 次に近いのが距離
        next_idx = -1
        for n in range(1, len(skirt_bone_poses) + 1):
            if (
                n >= len(skirt_bone_poses)
                or np.argsort(bone_distances)[n] not in registerd_idxs
            ):
                # 最後までいったか、まだ登録されてないINDEXの場合抜ける
                next_idx = n
                break
        if next_idx < 0 or next_idx >= len(skirt_bone_poses):
            # 全部終わったら終了
            return
        next_skirt_bone = list(skirt_bones.values())[
            np.argsort(bone_distances)[next_idx]
        ]
        if f"横_{next_skirt_bone.name}" in pmx.rigidbodies.keys():
            return
        # ROOTの剛体
        root_skirt_rigidbody = pmx.rigidbodies[root_skirt_bone.name]
        if next_skirt_bone.name not in pmx.rigidbodies:
            return
        # 次の剛体
        next_skirt_rigidbody = pmx.rigidbodies[next_skirt_bone.name]

        # 回転量は接続元剛体の向きに合わせる
        joint_rotation = root_skirt_rigidbody.shape_rotation.copy()

        translation_limit_min = MVector3D(self.physics_pairs["横"]["JointTLMin"])
        translation_limit_max = MVector3D(self.physics_pairs["横"]["JointTLMax"])
        rotation_limit_min = MVector3D(
            math.radians(self.physics_pairs["横"]["JointRLMin"][0]),
            math.radians(self.physics_pairs["横"]["JointRLMin"][1]),
            math.radians(self.physics_pairs["横"]["JointRLMin"][2]),
        )
        rotation_limit_max = MVector3D(
            math.radians(self.physics_pairs["横"]["JointRLMax"][0]),
            math.radians(self.physics_pairs["横"]["JointRLMax"][1]),
            math.radians(self.physics_pairs["横"]["JointRLMax"][2]),
        )
        spring_constant_translation = MVector3D(self.physics_pairs["横"]["JointSCT"])
        spring_constant_rotation = MVector3D(
            self.physics_pairs["横"]["JointSCR"][0],
            self.physics_pairs["横"]["JointSCR"][1],
            self.physics_pairs["横"]["JointSCR"][2],
        )

        joint = Joint(
            f"横_{next_skirt_bone.name}",
            f"横_{next_skirt_bone.name}",
            0,
            root_skirt_rigidbody.index,
            next_skirt_rigidbody.index,
            root_skirt_bone.position,
            joint_rotation,
            translation_limit_min,
            translation_limit_max,
            rotation_limit_min,
            rotation_limit_max,
            spring_constant_translation,
            spring_constant_rotation,
        )
        pmx.joints[joint.name] = joint
        registerd_idxs.append(np.argsort(bone_distances)[next_idx])

        return self.create_horizonal_joint(
            pmx,
            skirt_bones,
            skirt_bone_poses,
            np.argsort(bone_distances)[next_idx],
            registerd_idxs,
        )

    def create_joint(
        self,
        pmx: PmxModel,
        bone: Bone,
        translation_limit_min: MVector3D,
        translation_limit_max: MVector3D,
        rotation_limit_min: MVector3D,
        rotation_limit_max: MVector3D,
        spring_constant_translation: MVector3D,
        spring_constant_rotation: MVector3D,
    ):
        rigidbody = pmx.rigidbodies[bone.name]
        parent_rigidbody = None
        target_bone = bone.copy()
        while target_bone.parent_index > -1:
            matched = [b for b in pmx.bones.values() if b.index == target_bone.parent_index]
            if not matched:
                break
            parent_bone = matched[0]
            if parent_bone.name in pmx.rigidbodies:
                parent_rigidbody = pmx.rigidbodies[parent_bone.name]
                break
            # 親が見つからない場合、上に移動
            target_bone = parent_bone

        if not parent_rigidbody:
            return

        # 回転量は接続先剛体の向きに合わせる
        joint_rotation = rigidbody.shape_rotation.copy()

        joint = Joint(
            bone.name,
            bone.english_name,
            0,
            parent_rigidbody.index,
            rigidbody.index,
            bone.position,
            joint_rotation,
            translation_limit_min,
            translation_limit_max,
            rotation_limit_min,
            rotation_limit_max,
            spring_constant_translation,
            spring_constant_rotation,
        )
        pmx.joints[joint.name] = joint

    def create_rigidbody(
        self,
        pmx: PmxModel,
        bone_name: str,
        bone_vertices: dict,
        rigidbody_type: int,
        rigidbody_mode: int,
        rigidbody_factor: float,
        collision_group: int,
        no_collision_group: int,
        rigidbody_param: list,
        is_body: bool,
    ):
        # 剛体が必要な場合
        bone = pmx.bones[bone_name]
        if bone.index not in bone_vertices:
            return

        # ボーンに紐付く頂点リストを取得
        vertex_list = []
        normal_list = []
        # 強参照頂点
        strong_vertex_list = []
        for vertex in bone_vertices[bone.index]:
            vertex_list.append(vertex.position.data().tolist())
            normal_list.append(vertex.normal.data().tolist())
            if bone.index in vertex.deform.get_idx_list(0.4):
                strong_vertex_list.append(vertex.position.data().tolist())
        # 最小(強参照)
        strong_min_vertex = (
            np.min(np.array(strong_vertex_list), axis=0)
            if len(strong_vertex_list) > 0
            else [0, 0, 0]
        )
        # 最大(強参照)
        strong_max_vertex = (
            np.max(np.array(strong_vertex_list), axis=0)
            if len(strong_vertex_list) > 0
            else [0, 0, 0]
        )
        vertex_ary = np.array(vertex_list)
        # 法線の平均値
        mean_normal = np.mean(np.array(vertex_list), axis=0)
        # 最小
        min_vertex = np.min(vertex_ary, axis=0)
        # 最大
        max_vertex = np.max(vertex_ary, axis=0)
        # 中央
        center_vertex = np.median(vertex_ary, axis=0)

        # ボーンの向き先に沿う
        tail_bone = None
        if bone.tail_index > 0:
            tail_bone = [b for b in pmx.bones.values() if bone.tail_index == b.index][0]
            tail_position = tail_bone.position
        else:
            tail_position = bone.tail_position + bone.position

        # サイズ
        if len(strong_vertex_list) == 0 or is_body:
            diff_size = np.abs(np.asarray(max_vertex) - np.asarray(min_vertex))
        else:
            diff_size = np.abs(
                np.asarray(strong_max_vertex) - np.asarray(strong_min_vertex)
            )
        shape_size = MVector3D()
        shape_rotation = MVector3D()
        if rigidbody_type == 0:
            # 球体
            if "頭" == bone.name:
                # 頭はエルフ耳がある場合があるので、両目の間隔を使う
                eye_length = (
                    pmx.bones["右目"].position.distanceToPoint(
                        pmx.bones["左目"].position
                    )
                    * 2
                )
                center_vertex[0] = bone.position.x()
                center_vertex[1] = min_vertex[1] + (max_vertex[1] - min_vertex[1]) / 2
                center_vertex[2] = bone.position.z()
                shape_size = (
                    MVector3D(eye_length, eye_length, eye_length) * rigidbody_factor
                )
            else:
                # それ以外（胸とか）はそのまま
                max_size = np.max(diff_size / 2) * rigidbody_factor
                shape_size = MVector3D(max_size, max_size, max_size)
        else:
            # カプセルと箱
            axis_vec = tail_position - bone.position
            tail_pos = axis_vec.normalized()
            tail_vec = tail_pos.data()
            diff_vec = (
                MVector3D(float(diff_size[0]), float(diff_size[1]), float(diff_size[2]))
                .normalized()
                .data()
            )

            # 回転量
            to_vec = MVector3D.crossProduct(
                MVector3D(mean_normal), MVector3D(tail_vec)
            ).normalized()
            if rigidbody_type == 1:
                # 箱
                rot_value = MQuaternion.rotationTo(
                    MVector3D(0, 1 * np.sign(tail_vec[1]), 0), tail_pos
                )
                rot_value *= MQuaternion.rotationTo(
                    MVector3D(1 * np.sign(tail_vec[0]), 0, 0), to_vec.normalized()
                )
            else:
                # カプセル
                rot_value = MQuaternion.rotationTo(MVector3D(0, 1, 0), tail_pos)
            rot = rot_value if isinstance(rot_value, MQuaternion) else MQuaternion()
            shape_euler = rot.toEulerAngles()
            shape_rotation = MVector3D(
                math.radians(shape_euler.x()),
                math.radians(shape_euler.y()),
                math.radians(shape_euler.z()),
            )

            # 軸の長さ別剛体のサイズ
            tail_vec_idx = np.argmax(np.abs(diff_vec))
            # 軸の長さ
            if rigidbody_type == 1:
                # 箱
                if tail_bone and tail_bone.tail_index == -1:
                    # 末端の場合、頂点の距離感で決める
                    shape_size = (
                        MVector3D(
                            diff_size[0] * 0.7, diff_size[1] * 0.7, diff_size[2] * 0.15
                        )
                        * rigidbody_factor
                    )
                else:
                    # 途中の場合、ボーンの距離感で決める
                    shape_size = (
                        MVector3D(
                            diff_size[0] * 0.7,
                            (bone.position.y() - tail_position.y()) * 0.7,
                            diff_size[2] * 0.15,
                        )
                        * rigidbody_factor
                    )
                    center_vertex = bone.position + (tail_position - bone.position) / 2
            else:
                # カプセル
                if tail_vec_idx == 0:
                    # X軸方向に伸びてる場合 / 半径：Y, 高さ：X
                    shape_size = (
                        MVector3D(
                            diff_size[1] * (0.5 if is_body else 0.3),
                            abs(axis_vec.x() * 1.1),
                            diff_size[2],
                        )
                        * rigidbody_factor
                    )
                else:
                    # Y軸方向に伸びてる場合 / 半径：X, 高さ：Y
                    shape_size = (
                        MVector3D(
                            diff_size[0] * (0.5 if is_body else 0.3),
                            abs(axis_vec.y() * 1.1),
                            diff_size[2],
                        )
                        * rigidbody_factor
                    )

                center_vertex = bone.position + (tail_position - bone.position) / 2

        logger.debug(
            "bone: %s, min: %s, max: %s, center: %s, size: %s",
            bone.name,
            min_vertex,
            max_vertex,
            center_vertex,
            shape_size.to_log(),
        )
        center_vector = MVector3D(
            center_vertex.tolist()
            if isinstance(center_vertex, np.ndarray)
            else center_vertex
        )
        rigidbody = RigidBody(
            bone.name,
            bone.english_name,
            bone.index,
            collision_group,
            no_collision_group,
            rigidbody_type,
            shape_size,
            center_vector,
            shape_rotation,
            rigidbody_param[0],
            rigidbody_param[1],
            rigidbody_param[2],
            rigidbody_param[3],
            rigidbody_param[4],
            rigidbody_mode,
        )
        rigidbody.index = len(pmx.rigidbodies)
        pmx.rigidbodies[rigidbody.name] = rigidbody

    def create_bone_arm_twist(self, pmx: PmxModel, direction: str):
        shoulder_name = f"{direction}肩"
        arm_name = f"{direction}腕"
        elbow_name = f"{direction}ひじ"
        arm_twist_name = f"{direction}腕捩"
        wrist_name = f"{direction}手首"

        if arm_name in pmx.bones and elbow_name in pmx.bones:
            local_y_vector = MVector3D(0, -1, 0)

            # 肩
            shoulder_bone = pmx.bones[shoulder_name]
            shoulder_bone.flag |= 0x0800
            shoulder_bone.local_x_vector = (
                pmx.bones[arm_name].position - pmx.bones[shoulder_name].position
            ).normalized()
            shoulder_bone.local_z_vector = MVector3D.crossProduct(
                shoulder_bone.local_x_vector, local_y_vector
            )

            # 腕
            arm_bone = pmx.bones[arm_name]
            arm_bone.flag |= 0x0800
            arm_bone.local_x_vector = (
                pmx.bones[elbow_name].position - pmx.bones[arm_name].position
            ).normalized()
            arm_bone.local_z_vector = MVector3D.crossProduct(
                arm_bone.local_x_vector, local_y_vector
            )

            # ひじ
            elbow_bone = pmx.bones[elbow_name]
            elbow_bone.flag |= 0x0800
            elbow_bone.local_x_vector = (
                pmx.bones[wrist_name].position - pmx.bones[elbow_name].position
            ).normalized()
            elbow_bone.local_z_vector = MVector3D.crossProduct(
                elbow_bone.local_x_vector, local_y_vector
            )

            # 手首
            wrist_bone = pmx.bones[wrist_name]
            wrist_bone.flag |= 0x0800
            wrist_bone.local_x_vector = (
                pmx.bones[wrist_name].position - pmx.bones[elbow_name].position
            ).normalized()
            wrist_bone.local_z_vector = MVector3D.crossProduct(
                wrist_bone.local_x_vector, local_y_vector
            )

            # 腕捩
            arm_twist_bone = pmx.bones[arm_twist_name]
            arm_twist_bone.position = (
                pmx.bones[arm_name].position
                + (pmx.bones[elbow_name].position - pmx.bones[arm_name].position) * 0.5
            )
            arm_twist_bone.parent_index = pmx.bones[arm_name].index
            arm_twist_bone.flag = 0x0000 | 0x0002 | 0x0008 | 0x0010 | 0x0400 | 0x0800
            arm_twist_bone.fixed_axis = (
                pmx.bones[elbow_name].position - pmx.bones[arm_name].position
            ).normalized()
            arm_twist_bone.local_x_vector = (
                pmx.bones[wrist_name].position - pmx.bones[elbow_name].position
            ).normalized()
            arm_twist_bone.local_z_vector = MVector3D.crossProduct(
                arm_twist_bone.local_x_vector, local_y_vector
            )

            # 腕捩内部
            for twist_idx, factor in [(1, 0.25), (2, 0.5), (3, 0.75)]:
                arm_twist_sub_name = f"{direction}腕捩{twist_idx}"
                arm_twist_sub_bone = pmx.bones[arm_twist_sub_name]
                arm_twist_sub_bone.position = (
                    pmx.bones[arm_name].position
                    + (pmx.bones[elbow_name].position - pmx.bones[arm_name].position)
                    * factor
                )
                arm_twist_sub_bone.parent_index = pmx.bones[arm_name].index
                arm_twist_sub_bone.flag = 0x0000 | 0x0002 | 0x0100
                arm_twist_sub_bone.effect_index = pmx.bones[arm_twist_name].index
                arm_twist_sub_bone.effect_factor = factor

    def create_bone_wrist_twist(self, pmx: PmxModel, direction: str):
        elbow_name = f"{direction}ひじ"
        wrist_name = f"{direction}手首"
        wrist_twist_name = f"{direction}手捩"

        if elbow_name in pmx.bones and wrist_name in pmx.bones:
            local_y_vector = MVector3D(0, -1, 0)

            # 手捩
            wrist_twist_bone = pmx.bones[wrist_twist_name]
            wrist_twist_bone.position = (
                pmx.bones[elbow_name].position
                + (pmx.bones[wrist_name].position - pmx.bones[elbow_name].position)
                * 0.5
            )
            wrist_twist_bone.parent_index = pmx.bones[elbow_name].index
            wrist_twist_bone.flag = 0x0000 | 0x0002 | 0x0008 | 0x0010 | 0x0400 | 0x0800
            wrist_twist_bone.fixed_axis = (
                pmx.bones[wrist_name].position - pmx.bones[elbow_name].position
            ).normalized()
            wrist_twist_bone.local_x_vector = (
                pmx.bones[wrist_name].position - pmx.bones[elbow_name].position
            ).normalized()
            wrist_twist_bone.local_z_vector = MVector3D.crossProduct(
                wrist_twist_bone.local_x_vector, local_y_vector
            )

            # 手捩内部
            for twist_idx, factor in [(1, 0.25), (2, 0.5), (3, 0.75)]:
                wrist_twist_sub_name = f"{direction}手捩{twist_idx}"
                wrist_twist_sub_bone = pmx.bones[wrist_twist_sub_name]
                wrist_twist_sub_bone.position = (
                    pmx.bones[elbow_name].position
                    + (pmx.bones[wrist_name].position - pmx.bones[elbow_name].position)
                    * factor
                )
                wrist_twist_sub_bone.parent_index = pmx.bones[elbow_name].index
                wrist_twist_sub_bone.flag = 0x0000 | 0x0002 | 0x0100
                wrist_twist_sub_bone.effect_index = pmx.bones[wrist_twist_name].index
                wrist_twist_sub_bone.effect_factor = factor

    def create_bone_leg_ik(self, pmx: PmxModel, direction: str):
        leg_name = f"{direction}足"
        knee_name = f"{direction}ひざ"
        ankle_name = f"{direction}足首"
        toe_name = f"{direction}つま先"
        leg_ik_name = f"{direction}足ＩＫ"
        toe_ik_name = f"{direction}つま先ＩＫ"

        if leg_name in pmx.bones and knee_name in pmx.bones and ankle_name in pmx.bones:
            # 足ＩＫ
            flag = 0x0000 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020
            leg_ik_link = []
            leg_ik_link.append(
                IkLink(
                    pmx.bones[knee_name].index,
                    1,
                    MVector3D(math.radians(-180), 0, 0),
                    MVector3D(math.radians(-0.5), 0, 0),
                )
            )
            leg_ik_link.append(IkLink(pmx.bones[leg_name].index, 0))
            leg_ik = Ik(pmx.bones[ankle_name].index, 40, 1, leg_ik_link)
            leg_ik_bone = pmx.bones[leg_ik_name]
            leg_ik_bone.position = pmx.bones[ankle_name].position
            leg_ik_bone.parent_index = 0
            leg_ik_bone.layer = 0
            leg_ik_bone.flag = flag
            leg_ik_bone.tail_position = MVector3D(0, 0, 1)
            leg_ik_bone.ik = leg_ik
            pmx.bones[leg_ik_bone.name] = leg_ik_bone

            toe_ik_link = []
            toe_ik_link.append(IkLink(pmx.bones[ankle_name].index, 0))
            toe_ik = Ik(pmx.bones[toe_name].index, 40, 1, toe_ik_link)
            toe_ik_bone = pmx.bones[toe_ik_name]
            toe_ik_bone.position = pmx.bones[toe_name].position
            toe_ik_bone.parent_index = leg_ik_bone.index
            toe_ik_bone.layer = 0
            toe_ik_bone.flag = flag
            toe_ik_bone.tail_position = MVector3D(0, -1, 0)
            toe_ik_bone.ik = toe_ik
            pmx.bones[toe_ik_bone.name] = toe_ik_bone

    def get_deform_index(
        self,
        vertex_idx: int,
        pmx: PmxModel,
        vertex_pos: MVector3D,
        joint: Any,
        skin_joints: list,
        node_pairs: dict,
        node_weight: Any,
    ):
        # glTF の JOINTS_0 は 0 番ジョイントも有効値なので、重みがある要素を採用する
        joint_data = joint.data().astype(np.int64)
        weight_data = node_weight.data()
        valiable_joints = np.where(weight_data > 0)[0].tolist()
        # ウェイト
        org_weights = weight_data[valiable_joints]
        # ジョイント添え字からジョイントINDEXを取得
        org_joint_idxs = joint_data[valiable_joints]
        # 現行ボーンINDEXに置き換えたINDEX
        dest_joint_list = []
        for jidx in org_joint_idxs.tolist():
            if jidx < 0 or jidx >= len(skin_joints):
                continue
            skin_joint_idx = skin_joints[jidx]
            if skin_joint_idx not in node_pairs:
                continue
            bone_name = node_pairs[skin_joint_idx]
            if bone_name not in pmx.bones:
                continue
            dest_joint_list.append(pmx.bones[bone_name].index)

        if len(dest_joint_list) == 0:
            return [0], [1]

        dest_joints = np.array(dest_joint_list)

        # 尻は下半身に統合
        dest_joints = np.where(
            dest_joints == pmx.bones["腰"].index, pmx.bones["下半身"].index, dest_joints
        )

        for direction in ["右", "左"]:
            # 足・ひざ・足首はそれぞれDに載せ替え
            for dest_bone_name in [
                f"{direction}足",
                f"{direction}ひざ",
                f"{direction}足首",
            ]:
                src_bone_name = f"{dest_bone_name}D"
                dest_joints = np.where(
                    dest_joints == pmx.bones[dest_bone_name].index,
                    pmx.bones[src_bone_name].index,
                    dest_joints,
                )

            for base_from_name, base_to_name, base_twist_name in [
                ("腕", "ひじ", "腕捩"),
                ("ひじ", "手首", "手捩"),
            ]:
                dest_arm_bone_name = f"{direction}{base_from_name}"
                dest_elbow_bone_name = f"{direction}{base_to_name}"
                dest_arm_twist1_bone_name = f"{direction}{base_twist_name}1"
                dest_arm_twist2_bone_name = f"{direction}{base_twist_name}2"
                dest_arm_twist3_bone_name = f"{direction}{base_twist_name}3"

                arm_elbow_distance = -1
                vector_arm_distance = 1
                twist_list = []

                # 腕捩に分散する
                if (
                    pmx.bones[dest_arm_bone_name].index in dest_joints
                    or pmx.bones[dest_arm_twist1_bone_name].index in dest_joints
                    or pmx.bones[dest_arm_twist2_bone_name].index in dest_joints
                    or pmx.bones[dest_arm_twist3_bone_name].index in dest_joints
                ):
                    # 腕に割り当てられているウェイトの場合
                    arm_elbow_distance = (
                        pmx.bones[dest_elbow_bone_name].position.x()
                        - pmx.bones[dest_arm_bone_name].position.x()
                    )
                    vector_arm_distance = (
                        vertex_pos.x() - pmx.bones[dest_arm_bone_name].position.x()
                    )
                    twist_list = [
                        (dest_arm_twist1_bone_name, dest_arm_bone_name),
                        (dest_arm_twist2_bone_name, dest_arm_twist1_bone_name),
                        (dest_arm_twist3_bone_name, dest_arm_twist2_bone_name),
                    ]

                if np.sign(arm_elbow_distance) == np.sign(vector_arm_distance):
                    for dest_to_bone_name, dest_from_bone_name in twist_list:
                        # 腕からひじの間の頂点の場合
                        twist_distance = (
                            pmx.bones[dest_to_bone_name].position.x()
                            - pmx.bones[dest_from_bone_name].position.x()
                        )
                        vector_distance = (
                            vertex_pos.x() - pmx.bones[dest_from_bone_name].position.x()
                        )
                        if np.sign(twist_distance) == np.sign(vector_distance):
                            # 腕から腕捩1の間にある頂点の場合
                            arm_twist_factor = vector_distance / twist_distance
                            # 腕が割り当てられているウェイトINDEX
                            arm_twist_weight_joints = np.where(
                                dest_joints == pmx.bones[dest_from_bone_name].index
                            )[0]
                            if len(arm_twist_weight_joints) > 0:
                                if arm_twist_factor > 1:
                                    # 範囲より先の場合
                                    dest_joints[arm_twist_weight_joints] = pmx.bones[
                                        dest_to_bone_name
                                    ].index
                                else:
                                    # 腕のウェイト値
                                    dest_arm_weight = org_weights[
                                        arm_twist_weight_joints
                                    ]
                                    # 腕捩のウェイトはウェイト値の指定割合
                                    arm_twist_weights = (
                                        dest_arm_weight * arm_twist_factor
                                    )
                                    # 腕のウェイト値は残り
                                    arm_weights = dest_arm_weight * (
                                        1 - arm_twist_factor
                                    )

                                    # FROMのウェイトを載せ替える
                                    valiable_joints = valiable_joints + [
                                        pmx.bones[dest_from_bone_name].index
                                    ]
                                    dest_joints[arm_twist_weight_joints] = pmx.bones[
                                        dest_from_bone_name
                                    ].index
                                    org_weights[arm_twist_weight_joints] = arm_weights
                                    # 腕捩のウェイトを追加する
                                    valiable_joints = valiable_joints + [
                                        pmx.bones[dest_to_bone_name].index
                                    ]
                                    dest_joints = np.append(
                                        dest_joints, pmx.bones[dest_to_bone_name].index
                                    )
                                    org_weights = np.append(
                                        org_weights, arm_twist_weights
                                    )

                                    logger.test(
                                        "[%s] from: %s, to: %s, factor: %s, dest_joints: %s, org_weights: %s",
                                        vertex_idx,
                                        dest_from_bone_name,
                                        dest_to_bone_name,
                                        arm_twist_factor,
                                        dest_joints,
                                        org_weights,
                                    )

        # 載せ替えた事で、ジョイントが重複している場合があるので、調整する
        joint_weights = {}
        for j, w in zip(dest_joints, org_weights, strict=False):
            if j not in joint_weights:
                joint_weights[j] = 0
            joint_weights[j] += w

        # 対象となるウェイト値
        joint_values = list(joint_weights.keys())
        # 正規化(合計して1になるように)
        total_weights = np.array(list(joint_weights.values()))
        weight_values = (
            total_weights / total_weights.sum(axis=0, keepdims=True)
        ).tolist()

        if len(joint_values) == 3:
            # 3つの場合、0を入れ込む
            return joint_values + [0], weight_values + [0]
        elif len(joint_values) > 4:
            # 4より多い場合、一番小さいのを捨てる（大体誤差）
            remove_idx = np.argmin(np.array(weight_values)).T
            del valiable_joints[remove_idx]
            del joint_values[remove_idx]
            del weight_values[remove_idx]

            # 正規化(合計して1になるように)
            total_weights = np.array(weight_values)
            weight_values = (
                total_weights / total_weights.sum(axis=0, keepdims=True)
            ).tolist()

        return joint_values, weight_values

    def apply_skinning_pose(
        self,
        position: MVector3D,
        joint: Any,
        node_weight: Any,
        skin_joints: list,
        inverse_bind_matrices: list[np.ndarray],
        node_world_matrices: list[np.ndarray],
    ) -> MVector3D:
        if len(skin_joints) == 0 or len(node_world_matrices) == 0:
            return position

        joint_data = joint.data().astype(np.int64)
        weight_data = node_weight.data().astype(np.float64)
        source = np.array([position.x(), position.y(), position.z(), 1.0], dtype=np.float64)

        skinned = np.zeros(4, dtype=np.float64)
        total_weight = 0.0

        for jidx, weight in zip(joint_data.tolist(), weight_data.tolist(), strict=False):
            if weight <= 0:
                continue
            if jidx < 0 or jidx >= len(skin_joints):
                continue

            skin_joint_node_idx = skin_joints[jidx]
            if skin_joint_node_idx < 0 or skin_joint_node_idx >= len(node_world_matrices):
                continue

            bind_matrix = (
                inverse_bind_matrices[jidx]
                if jidx < len(inverse_bind_matrices)
                else np.identity(4, dtype=np.float64)
            )

            skinned += weight * (node_world_matrices[skin_joint_node_idx] @ (bind_matrix @ source))
            total_weight += weight

        if total_weight <= 0:
            return position

        skinned /= total_weight
        return MVector3D(float(skinned[0]), float(skinned[1]), float(skinned[2]))

    def get_node_world_matrices(self, vrm: VrmModel) -> list[np.ndarray]:
        nodes = vrm.json_data["nodes"] if "nodes" in vrm.json_data else []
        if len(nodes) == 0:
            return []

        local_matrices = [self.get_node_local_matrix(node) for node in nodes]
        parents = [-1 for _ in nodes]

        for parent_idx, node in enumerate(nodes):
            if "children" not in node:
                continue
            for child_idx in node["children"]:
                if 0 <= child_idx < len(nodes):
                    parents[child_idx] = parent_idx

        world_matrices: list[np.ndarray | None] = [None for _ in nodes]

        def resolve_world(node_idx: int) -> np.ndarray:
            cached = world_matrices[node_idx]
            if cached is not None:
                return cached

            parent_idx = parents[node_idx]
            if parent_idx >= 0:
                world = resolve_world(parent_idx) @ local_matrices[node_idx]
            else:
                world = local_matrices[node_idx]

            world_matrices[node_idx] = world
            return world

        for idx in range(len(nodes)):
            resolve_world(idx)

        return [m if m is not None else np.identity(4, dtype=np.float64) for m in world_matrices]

    def get_node_local_matrix(self, node: dict[str, Any]) -> np.ndarray:
        if "matrix" in node and isinstance(node["matrix"], list) and len(node["matrix"]) == 16:
            return np.array(node["matrix"], dtype=np.float64).reshape((4, 4), order="F")

        translation = np.array(node.get("translation", [0.0, 0.0, 0.0]), dtype=np.float64)
        rotation = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
        scale = np.array(node.get("scale", [1.0, 1.0, 1.0]), dtype=np.float64)

        qx = float(rotation[0])
        qy = float(rotation[1])
        qz = float(rotation[2])
        qw = float(rotation[3])

        rot = np.array(
            [
                [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
                [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
                [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
            ],
            dtype=np.float64,
        )
        rot_scale = rot @ np.diag(scale)

        local = np.identity(4, dtype=np.float64)
        local[:3, :3] = rot_scale
        local[:3, 3] = translation
        return local

    # ボーンの再定義
    def custom_bones(self, pmx: PmxModel, bones: dict, profile_name: str = "generic"):
        # MMDで定義されているボーン
        bone_idx = 0
        for node_name, bone_config in self.bone_pairs.items():
            bone_name = bone_config["name"]

            if bone_name in bones:
                pmx.bones[bone_name] = bones[bone_name]
            else:
                # ない場合とりあえず初期値
                pmx.bones[bone_name] = Bone(
                    bone_name, node_name, MVector3D(), -1, 0, 0x0000 | 0x0002
                )
            pmx.bones[bone_name].index = bone_idx
            bone_idx += 1

        for node_name, bone_config in self.bone_pairs.items():
            bone_name = bone_config["name"]

            pmx.bones[bone_name].name = bone_name
            pmx.bones[bone_name].english_name = node_name

            # 親ボーンの設定
            if bone_config["parent"]:
                pmx.bones[bone_name].parent_index = pmx.bones[
                    bone_config["parent"]
                ].index
            else:
                pmx.bones[bone_name].parent_index = -1

            # 表示先ボーンの設定
            if bone_config["tail"] != -1:
                pmx.bones[bone_name].tail_index = pmx.bones[bone_config["tail"]].index
            else:
                pmx.bones[bone_name].tail_index = -1

            if bone_name == "全ての親":
                pmx.bones[bone_name].position = MVector3D(0, 0, 0)
                pmx.bones[bone_name].flag = 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010
            elif bone_name == "センター":
                pmx.bones[bone_name].position = self._resolve_center_position(
                    pmx, profile_name
                )
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0004 | 0x0008 | 0x0010
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D(
                    0, -pmx.bones["センター"].position.y(), 0
                )
            elif bone_name == "グルーブ":
                pmx.bones[bone_name].position = self._resolve_groove_position(
                    pmx, profile_name
                )
                pmx.bones[bone_name].flag = (
                    0x0000 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x2000
                )
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D(
                    0, pmx.bones["センター"].position.y() * 0.175, 0
                )
            elif "肩P" in bone_name:
                pmx.bones[bone_name].position = pmx.bones[bone_name[:-1]].position
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D()
            elif "肩C" in bone_name:
                pmx.bones[bone_name].position = pmx.bones[bone_name[:-1]].position
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0100
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D()
                pmx.bones[bone_name].effect_index = pmx.bones[
                    bone_name.replace("C", "P")
                ].index
                pmx.bones[bone_name].effect_factor = -1
            elif "指先" in bone_name[-2:]:
                if pmx.bones[bone_name].position == MVector3D():
                    # 指先の値が入ってない場合、とりあえず-1
                    pmx.bones[bone_name].position = pmx.bones[
                        bone_config["parent"]
                    ].position + MVector3D(
                        1 * np.sign(pmx.bones[bone_config["parent"]].position.x()), 0, 0
                    )
            elif "胸先" in bone_name[-2:]:
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D()
            elif "腕捩" in bone_name[-2:]:
                self.create_bone_arm_twist(pmx, bone_name[0])
            elif "手捩" in bone_name[-2:]:
                self.create_bone_wrist_twist(pmx, bone_name[0])
            elif "足ＩＫ" in bone_name:
                self.create_bone_leg_ik(pmx, bone_name[0])
            elif "頭" in bone_name:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D(0, 1, 0)
            elif "目" in bone_name[-1] and "両目" != bone_name:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010 | 0x0100
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D(0, 0, -1)
                pmx.bones[bone_name].effect_index = pmx.bones["両目"].index
                pmx.bones[bone_name].effect_factor = 1
            elif "両目" == bone_name:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].position = self._resolve_both_eyes_position(
                    pmx,
                    bone_name,
                    profile_name,
                )
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D(0, 0, -1)
            elif "手首" in bone_name[-2:]:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = (
                    pmx.bones[f"{bone_name[0]}手首"].position
                    - pmx.bones[f"{bone_name[0]}ひじ"].position
                ).normalized()
            elif "腰キャンセル" in bone_name:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0100
                pmx.bones[bone_name].position = pmx.bones[
                    f"{bone_name[-1]}足"
                ].position.copy()
                pmx.bones[bone_name].effect_index = pmx.bones["腰"].index
                pmx.bones[bone_name].effect_factor = -1
            elif "D" == bone_name[-1]:
                parent_name = bone_name[:-1]
                pmx.bones[bone_name].position = pmx.bones[parent_name].position
                pmx.bones[bone_name].parent_index = pmx.bones[
                    bone_config["parent"]
                ].index
                pmx.bones[bone_name].layer = 1
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010 | 0x0100
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = MVector3D()
                pmx.bones[bone_name].effect_index = pmx.bones[parent_name].index
                pmx.bones[bone_name].effect_factor = 1
            elif "足先EX" == bone_name[1:]:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].layer = 1
            elif "下半身" == bone_name:
                pmx.bones[bone_name].flag = 0x0000 | 0x0002 | 0x0008 | 0x0010
                pmx.bones[bone_name].tail_index = -1
                pmx.bones[bone_name].tail_position = (
                    pmx.bones["腰"].position - pmx.bones[bone_name].position
                )

        # MMDで定義されていないボーン類
        for bone_name, bone in bones.items():
            if bone_name not in list(pmx.bones.keys()):
                # まだ定義されていない場合
                # INDEXは今の最長
                bone.index = len(pmx.bones)
                # 親ボーンはボーンINDEXに定義されてるボーン名からINDEXを再定義
                if bone.parent_index in pmx.bones:
                    if bone.parent_index == "腰":
                        bone.parent_index = pmx.bones["下半身"].index
                    else:
                        bone.parent_index = pmx.bones[bone.parent_index].index
                else:
                    bone.parent_index = -1
                # 子ボーンが定義可能な場合は＋1
                if bone.tail_index != -1:
                    bone.tail_index = bone.index + 1

                if bone.tail_index == -1 and bone.tail_position == MVector3D():
                    # 末端は操作不可
                    bone.flag = 0x0001 | 0x0002

                pmx.bones[bone_name] = bone

    def define_bone(
        self,
        vrm: VrmModel,
        bones: dict,
        node_idx: int,
        parent_name: str,
        node_pairs: dict,
        node_world_matrices: list[np.ndarray] | None = None,
    ):
        node = vrm.json_data["nodes"][node_idx]

        # humanBones: VRM0.x はリスト、VRM1.x は {bone_name: {node: idx}} の dict
        _ext_data = vrm.json_data.get("extensions", {})
        _vrm0_humanoid = _ext_data.get("VRM", {}).get("humanoid", {})
        _vrm1_humanoid = _ext_data.get("VRMC_vrm", {}).get("humanoid", {})

        if "humanBones" in _vrm0_humanoid and isinstance(
            _vrm0_humanoid["humanBones"], list
        ):
            # VRM0.x: [{"bone": "hips", "node": 0}, ...]
            human_nodes = [
                b
                for b in _vrm0_humanoid["humanBones"]
                if b.get("node") == node_idx
            ]
        elif "humanBones" in _vrm1_humanoid and isinstance(
            _vrm1_humanoid["humanBones"], dict
        ):
            # VRM1.x: {"hips": {"node": 0}, "spine": {"node": 1}, ...}
            human_nodes = [
                {"bone": bone_name, "node": bone_data.get("node")}
                for bone_name, bone_data in _vrm1_humanoid["humanBones"].items()
                if isinstance(bone_data, dict) and bone_data.get("node") == node_idx
            ]
        else:
            human_nodes = []
        # 人体ボーンの場合のみ人体データ取得
        human_node = None if len(human_nodes) == 0 else human_nodes[0]
        bone_name = node["name"]
        jp_bone_name = (
            self.bone_pairs[bone_name]["name"]
            if bone_name in self.bone_pairs
            else bone_name
        )

        if node_idx in node_pairs:
            return jp_bone_name

        # ボーン名とノードINDEX(ウェイトとか)の対応表登録
        node_pairs[node_idx] = jp_bone_name

        # 位置: 回転を反映したワールド座標を優先して使用する
        if (
            node_world_matrices is not None
            and 0 <= node_idx < len(node_world_matrices)
        ):
            world_matrix = node_world_matrices[node_idx]
            position = (
                MVector3D(
                    float(world_matrix[0, 3]),
                    float(world_matrix[1, 3]),
                    float(world_matrix[2, 3]),
                )
                * MIKU_METER
                * MVector3D(-1, 1, 1)
            )
        else:
            translation = node["translation"] if "translation" in node else [0, 0, 0]
            translation_values = (
                translation.tolist()
                if isinstance(translation, np.ndarray)
                else translation
            )
            position = (
                MVector3D(
                    float(translation_values[0]),
                    float(translation_values[1]),
                    float(translation_values[2]),
                )
                * MIKU_METER
                * MVector3D(-1, 1, 1)
            )

            if parent_name:
                position += bones[parent_name].position

        #  0x0001  : 接続先(PMD子ボーン指定)表示方法 -> 0:座標オフセットで指定 1:ボーンで指定
        #  0x0002  : 回転可能
        #  0x0004  : 移動可能
        #  0x0008  : 表示
        #  0x0010  : 操作可
        if bone_name in self.bone_pairs:
            if jp_bone_name[-1] == "先":
                flag = 0x0001 | 0x0002
            elif jp_bone_name in ["全ての親", "センター", "グルーブ"]:
                flag = 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010
            else:
                flag = 0x0001 | 0x0002 | 0x0008 | 0x0010
        elif human_node or "mesh" in node:
            flag = 0x0001 | 0x0002
        else:
            flag = 0x0001 | 0x0002 | 0x0008 | 0x0010

        bone = Bone(jp_bone_name, bone_name, position, parent_name, 0, flag)
        bones[bone.name] = bone

        if "children" in node:
            # 子ボーンがある場合
            for child_idx in node["children"]:
                # 子ボーンを取得
                child_bone_name = self.define_bone(
                    vrm,
                    bones,
                    child_idx,
                    jp_bone_name,
                    node_pairs,
                    node_world_matrices,
                )

                # 表示先を設定(最初のボーン系子ども)
                if (
                    bones[jp_bone_name].tail_index == -1
                    and bones[jp_bone_name].position != MVector3D()
                    and (
                        (
                            "Bip" in bones[child_bone_name].english_name
                            and "Bip" in bone.english_name
                        )
                        or "Bip" not in bone.english_name
                    )
                ):
                    # とりあえず名称設定
                    bones[jp_bone_name].tail_index = bones[child_bone_name].name

        return jp_bone_name

    # アクセサ経由で値を取得する
    # https://github.com/ft-lab/Documents_glTF/blob/master/structure.md
    def read_from_accessor(self, vrm: VrmModel, accessor_idx: int):
        bresult = []
        aidx = 0
        if accessor_idx < len(vrm.json_data["accessors"]):
            accessor = vrm.json_data["accessors"][accessor_idx]
            acc_type = accessor["type"]
            if accessor["bufferView"] < len(vrm.json_data["bufferViews"]):
                buffer = vrm.json_data["bufferViews"][accessor["bufferView"]]
                logger.test("accessor: %s, %s", accessor_idx, buffer)
                if "count" in accessor:
                    bresult = []
                    if acc_type == "VEC3":
                        buf_type, buf_num = self.define_buf_type(
                            accessor["componentType"]
                        )
                        if accessor_idx % 10 == 0:
                            logger.info(
                                "-- -- Accessor[%s/%s/%s]",
                                accessor_idx,
                                acc_type,
                                buf_type,
                            )

                        for n in range(accessor["count"]):
                            buf_start = (
                                self.offset + buffer["byteOffset"] + ((buf_num * 3) * n)
                            )

                            # Vec3 / float
                            xresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start
                            )
                            yresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + buf_num
                            )
                            zresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + (buf_num * 2)
                            )

                            if buf_type == "f":
                                bresult.append(
                                    MVector3D(
                                        float(xresult[0]),
                                        float(yresult[0]),
                                        float(zresult[0]),
                                    )
                                )
                            else:
                                bresult.append(
                                    MVector3D(
                                        int(xresult[0]),
                                        int(yresult[0]),
                                        int(zresult[0]),
                                    )
                                )

                            aidx += 1

                            if aidx % 5000 == 0:
                                logger.info(
                                    "-- -- Accessor[%s/%s/%s][%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                    aidx,
                                )
                            else:
                                logger.test(
                                    "-- -- Accessor[%s/%s/%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                )

                    elif acc_type == "VEC2":
                        buf_type, buf_num = self.define_buf_type(
                            accessor["componentType"]
                        )
                        if accessor_idx % 10 == 0:
                            logger.info(
                                "-- -- Accessor[%s/%s/%s]",
                                accessor_idx,
                                acc_type,
                                buf_type,
                            )

                        for n in range(accessor["count"]):
                            buf_start = (
                                self.offset + buffer["byteOffset"] + ((buf_num * 2) * n)
                            )

                            # Vec3 / float
                            xresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start
                            )
                            yresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + buf_num
                            )

                            bresult.append(
                                MVector2D(float(xresult[0]), float(yresult[0]))
                            )

                            aidx += 1

                            if aidx % 5000 == 0:
                                logger.info(
                                    "-- -- Accessor[%s/%s/%s][%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                    aidx,
                                )
                            else:
                                logger.test(
                                    "-- -- Accessor[%s/%s/%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                )

                    elif acc_type == "VEC4":
                        buf_type, buf_num = self.define_buf_type(
                            accessor["componentType"]
                        )
                        if accessor_idx % 10 == 0:
                            logger.info(
                                "-- -- Accessor[%s/%s/%s]",
                                accessor_idx,
                                acc_type,
                                buf_type,
                            )

                        for n in range(accessor["count"]):
                            buf_start = (
                                self.offset + buffer["byteOffset"] + ((buf_num * 4) * n)
                            )

                            # Vec3 / float
                            xresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start
                            )
                            yresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + buf_num
                            )
                            zresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + (buf_num * 2)
                            )
                            wresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start + (buf_num * 3)
                            )

                            if buf_type == "f":
                                bresult.append(
                                    MVector4D(
                                        float(xresult[0]),
                                        float(yresult[0]),
                                        float(zresult[0]),
                                        float(wresult[0]),
                                    )
                                )
                            else:
                                bresult.append(
                                    MVector4D(
                                        int(xresult[0]),
                                        int(yresult[0]),
                                        int(zresult[0]),
                                        int(wresult[0]),
                                    )
                                )

                            aidx += 1

                            if aidx % 5000 == 0:
                                logger.info(
                                    "-- -- Accessor[%s/%s/%s][%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                    aidx,
                                )
                            else:
                                logger.test(
                                    "-- -- Accessor[%s/%s/%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                )

                    elif acc_type == "SCALAR":
                        buf_type, buf_num = self.define_buf_type(
                            accessor["componentType"]
                        )
                        if accessor_idx % 10 == 0:
                            logger.info(
                                "-- -- Accessor[%s/%s/%s]",
                                accessor_idx,
                                acc_type,
                                buf_type,
                            )

                        for n in range(accessor["count"]):
                            buf_start = (
                                self.offset + buffer["byteOffset"] + (buf_num * n)
                            )
                            xresult = struct.unpack_from(
                                buf_type, self.buffer, buf_start
                            )

                            if buf_type == "f":
                                bresult.append(float(xresult[0]))
                            else:
                                bresult.append(int(xresult[0]))

                            aidx += 1

                            if aidx % 5000 == 0:
                                logger.info(
                                    "-- -- Accessor[%s/%s/%s][%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                    aidx,
                                )
                            else:
                                logger.test(
                                    "-- -- Accessor[%s/%s/%s]",
                                    accessor_idx,
                                    acc_type,
                                    buf_type,
                                )

        return bresult

    def read_mat4_from_accessor(
        self, vrm: VrmModel, accessor_idx: int
    ) -> list[np.ndarray]:
        if accessor_idx >= len(vrm.json_data.get("accessors", [])):
            return []

        accessor = vrm.json_data["accessors"][accessor_idx]
        if accessor.get("type") != "MAT4":
            return []

        buffer_view_idx = accessor.get("bufferView", -1)
        if (
            not isinstance(buffer_view_idx, int)
            or buffer_view_idx < 0
            or buffer_view_idx >= len(vrm.json_data.get("bufferViews", []))
        ):
            return []

        buffer_view = vrm.json_data["bufferViews"][buffer_view_idx]
        count = int(accessor.get("count", 0))
        if count <= 0:
            return []

        accessor_offset = int(accessor.get("byteOffset", 0))
        view_offset = int(buffer_view.get("byteOffset", 0))
        stride = int(buffer_view.get("byteStride", 64))
        base_offset = self.offset + view_offset + accessor_offset

        matrices: list[np.ndarray] = []
        for idx in range(count):
            start = base_offset + (idx * stride)
            end = start + 64
            if end > len(self.buffer):
                break

            values = struct.unpack_from("16f", self.buffer, start)
            # glTF の MAT4 配列は列優先なので、列優先で4x4に復元する
            matrix = np.array(values, dtype=np.float64).reshape((4, 4), order="F")
            matrices.append(matrix)

        return matrices

    def define_buf_type(self, componentType: int):
        """vrm_common.define_buf_type へのデリゲート（後方互換維持）。"""
        return _define_buf_type(componentType)

    def read_text(self, format_size):
        bresult = self.unpack(format_size, "{0}s".format(format_size))
        if not isinstance(bresult, (bytes, bytearray)):
            return ""
        return bresult.decode("UTF8")
