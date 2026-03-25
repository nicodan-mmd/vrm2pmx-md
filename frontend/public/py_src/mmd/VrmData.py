# -*- coding: utf-8 -*-
#

from typing import Any

from module.MMath import (  # noqa
    MMatrix4x4,
    MQuaternion,
    MRect,
    MVector2D,
    MVector3D,
    MVector4D,
)
from utils.MException import SizingException  # noqa
from utils.MLogger import MLogger  # noqa

logger = MLogger(__name__, level=MLogger.DEBUG)


class VrmModel:
    def __init__(self):
        self.path: str = ""
        self.digest: str = ""
        self.json_data: dict[str, Any] = {}
        self.detected_profile: str = "generic"
        self.profile_reason: str = "not-detected"
        self.profile_metadata: dict[str, Any] = {}
