# -*- coding: utf-8 -*-
#

import wx

from utils.MLogger import MLogger  # noqa

logger = MLogger(__name__)


class StatusCtrl(wx.TextCtrl):

    def __init__(
        self,
        parent,
        id=wx.ID_ANY,
        value="",
        pos=wx.DefaultPosition,
        size=wx.DefaultSize,
        style=0,
        validator=wx.DefaultValidator,
        name=wx.TextCtrlNameStr,
    ):
        super().__init__(parent, id, value, pos, size, style, validator, name)

    def write(self, text):
        try:
            wx.CallAfter(self.SetValue, text)
        except:  # noqa
            # nosec B110: UI破棄後の書き込み失敗は自己回復不能で、再帰ログも避ける
            pass

    # def monitor(self, queue):
    #     while True:
    #         # super().write(queue.get())
    #         wx.CallAfter(queue.get())
    #         # 0.1秒待機
    #         time.sleep(0.1)
