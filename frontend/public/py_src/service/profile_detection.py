from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProfileDetectionResult:
    profile: str
    reason: str
    has_vrm0_extension: bool
    has_vrm1_extension: bool
    has_spring_extension: bool
    generator: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "reason": self.reason,
            "has_vrm0_extension": self.has_vrm0_extension,
            "has_vrm1_extension": self.has_vrm1_extension,
            "has_spring_extension": self.has_spring_extension,
            "generator": self.generator,
        }


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def detect_profile(
    json_data: dict[str, Any] | None,
    source_path: str = "",
) -> ProfileDetectionResult:
    data = _as_mapping(json_data)
    extensions = _as_mapping(data.get("extensions"))
    asset = _as_mapping(data.get("asset"))

    has_vrm0 = "VRM" in extensions
    has_vrm1 = "VRMC_vrm" in extensions
    has_spring = "VRMC_springBone" in extensions
    generator = str(asset.get("generator") or "")

    normalized_path = source_path.lower()
    normalized_generator = generator.lower()
    is_vroid_hint = "vroid" in normalized_path or "vroid" in normalized_generator

    if is_vroid_hint and (has_vrm0 or has_vrm1):
        return ProfileDetectionResult(
            profile="vroid",
            reason="vroid hint detected in path/generator",
            has_vrm0_extension=has_vrm0,
            has_vrm1_extension=has_vrm1,
            has_spring_extension=has_spring,
            generator=generator,
        )

    if has_vrm1:
        return ProfileDetectionResult(
            profile="generic",
            reason="VRMC_vrm extension detected",
            has_vrm0_extension=has_vrm0,
            has_vrm1_extension=has_vrm1,
            has_spring_extension=has_spring,
            generator=generator,
        )

    if has_vrm0:
        return ProfileDetectionResult(
            profile="generic",
            reason="VRM extension detected",
            has_vrm0_extension=has_vrm0,
            has_vrm1_extension=has_vrm1,
            has_spring_extension=has_spring,
            generator=generator,
        )

    return ProfileDetectionResult(
        profile="generic",
        reason="unknown metadata, fallback to generic",
        has_vrm0_extension=has_vrm0,
        has_vrm1_extension=has_vrm1,
        has_spring_extension=has_spring,
        generator=generator,
    )
