# -*- coding: utf-8 -*-
#

from typing import Any

from module.MMath import MRect, MVector2D, MVector3D, MVector4D, MQuaternion, MMatrix4x4 # noqa

from utils.MException import SizingException # noqa
from utils.MLogger import MLogger # noqa

logger = MLogger(__name__, level=MLogger.DEBUG)


class VrmModel:
    def __init__(self):
        self.path: str = ''
        self.digest: str = ''
        self.json_data: dict[str, Any] = {}
            
    

