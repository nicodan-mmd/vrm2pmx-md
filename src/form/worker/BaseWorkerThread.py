# -*- coding: utf-8 -*-
#
import threading
import time
from abc import ABCMeta, abstractmethod
from functools import wraps
from queue import Empty
from threading import Thread
from typing import Any

import wx
import wx.xrc

from utils import MFormUtils  # noqa
from utils.MLogger import MLogger  # noqa

logger = MLogger(__name__)


# https://wiki.wxpython.org/LongRunningTasks
# https://teratail.com/questions/158458
# http://nobunaga.hatenablog.jp/entry/2016/06/03/204450
class BaseWorkerThread(metaclass=ABCMeta):
    """Worker Thread Class."""

    def __init__(self, frame: Any, result_event: Any, console: Any):
        """Init Worker Thread Class."""
        # Thread.__init__(self)
        self.frame = frame
        # self._want_abort = 0
        self.event_id = wx.NewId()
        self.result_event = result_event
        self.result = True
        self.monitor = None
        self.is_killed = False

    def start(self):
        self.run()

    def stop(self):
        self.is_killed = True

    def run(self):
        # スレッド実行
        self.thread_event()

        # 後処理実行
        self.post_event()

    def post_event(self):
        wx.PostEvent(self.frame, self.result_event(result=self.result))

    @abstractmethod
    def thread_event(self):
        pass

    @abstractmethod
    def thread_delete(self):
        pass


# https://doloopwhile.hatenablog.com/entry/20090627/1275175850
class SimpleThread(Thread):
    """呼び出し可能オブジェクト（関数など）を実行するだけのスレッド"""

    def __init__(self, base_thread, acallable):
        self.base_thread = base_thread
        self.acallable = acallable
        self._result = None
        super(SimpleThread, self).__init__(
            name="simple_thread", kwargs={"is_killed": False}
        )

    def run(self):
        self._result = self.acallable(self.base_thread)

    def result(self):
        return self._result


def task_takes_time(acallable):
    """
    関数デコレータ
    acallable本来の処理は別スレッドで実行しながら、
    ウィンドウを更新するwx.YieldIfNeededを呼び出し続けるようにする
    """

    @wraps(acallable)
    def f(base_thread):
        t = SimpleThread(base_thread, acallable)
        t.daemon = True
        t.start()
        while t.is_alive():
            base_thread.gauge_ctrl.Pulse()
            wx.YieldIfNeeded()
            time.sleep(0.01)

            if base_thread.is_killed:
                # 呼び出し元から停止命令が出ている場合、自分以外の全部のスレッドに終了命令
                for th in threading.enumerate():
                    if th.ident != threading.current_thread().ident:
                        thread_kwargs = getattr(th, "_kwargs", None)
                        if isinstance(thread_kwargs, dict):
                            thread_kwargs["is_killed"] = True
                break

        return t.result()

    return f


# コンソールに文字列を出力する
def monitering(console, queue):
    while True:
        try:
            console.write(queue.get(timeout=3))
            wx.Yield()
        except Empty:
            continue
        except Exception:
            logger.debug("コンソール監視中に出力更新へ失敗しました。")
