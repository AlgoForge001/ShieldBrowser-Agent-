"""
Image utilities for the ShieldBrowse server.
Validates and preprocesses base64 images before sending to the VLM.
"""

import base64
import io
from PIL import Image


def decode_base64_image(b64_string: str) -> bytes:
    """Decode a base64 string (with or without data: prefix) to raw bytes."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    # Fix padding
    b64_string = b64_string.strip()
    padding = 4 - len(b64_string) % 4
    if padding != 4:
        b64_string += "=" * padding
    return base64.b64decode(b64_string)


def validate_image(b64_string: str) -> tuple[bool, str]:
    """
    Validates that the base64 string is a decodable image.
    Returns (is_valid, error_message).
    """
    try:
        raw = decode_base64_image(b64_string)
        img = Image.open(io.BytesIO(raw))
        img.verify()
        return True, ""
    except Exception as e:
        return False, str(e)


def resize_image_if_needed(b64_string: str, max_dim: int = 1280) -> str:
    """
    If the image is larger than max_dim on any side, downscale it proportionally.
    Returns a base64 PNG string.
    """
    raw = decode_base64_image(b64_string)
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    w, h = img.size
    if w <= max_dim and h <= max_dim:
        # Return original (re-encode as PNG for consistency)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    scale = max_dim / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def image_to_data_url(b64_string: str, mime_type: str = "image/png") -> str:
    """Wraps a raw base64 string in a data URL (required by some Ollama models)."""
    return f"data:{mime_type};base64,{b64_string}"
