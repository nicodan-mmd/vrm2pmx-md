# -*- coding: utf-8 -*-
#


class SizingException(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class MParseException(SizingException):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class MKilledException(SizingException):
    def __init__(self):
        super().__init__("Processing was canceled")
        self.message = None

