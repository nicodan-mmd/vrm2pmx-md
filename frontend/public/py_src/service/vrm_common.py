# -*- coding: utf-8 -*-
"""
vrm_common.py — Common Conversion Layer

VRM→PMX変換における共通ユーティリティ。
GenericProfile / VRoidProfile の両方から呼び出せるよう、
インスタンス状態に依存しない純粋関数を集約する。

共通化対象一覧 (PR-B):
  [x] define_buf_type    — glTF componentType → struct format
  [ ] read_from_accessor — バイナリバッファからaccessorデータを読む
  [ ] read_mat4_from_accessor — MAT4 accessor読み取り
  [ ] extract_images     — バイナリバッファから画像データを展開・保存
"""


def define_buf_type(component_type: int) -> tuple[str, int]:
    """glTF componentType から struct フォーマット文字列とバイト数を返す。

    Args:
        component_type: glTF accessor の componentType 整数値。

    Returns:
        (format_char, byte_size) のタプル。
        未知の componentType の場合は ("f", 4) を返す。
    """
    _MAP: dict[int, tuple[str, int]] = {
        5120: ("b", 1),  # BYTE
        5121: ("B", 1),  # UNSIGNED_BYTE
        5122: ("h", 2),  # SHORT
        5123: ("H", 2),  # UNSIGNED_SHORT
        5124: ("i", 4),  # INT
        5125: ("I", 4),  # UNSIGNED_INT
        5126: ("f", 4),  # FLOAT
    }
    return _MAP.get(component_type, ("f", 4))
