"""
VLM Client — calls OpenRouter API with the sanitized screenshot.

Model used: meta-llama/llama-3.2-11b-vision-instruct  (free tier, vision-capable)

OpenRouter API key must be set as environment variable:
    OPENROUTER_API_KEY=sk-or-...

Or set in a .env file at the project root.
"""

import os
import httpx
import base64
from typing import Optional

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Vision-capable models available on OpenRouter (free or cheap tier)
# Priority order — first one that works is used
PREFERRED_MODELS = [
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "google/gemini-flash-1.5",
    "openai/gpt-4o-mini",
]

VISION_PROMPT_TEMPLATE = """\
You are a web automation assistant analyzing a browser screenshot that has been
privacy-sanitized. Black boxes indicate redacted private information (faces,
passwords, Aadhaar numbers, PAN cards, OTP fields, credit card numbers).

The user wants to: {task}

DOM context (already sanitized — any PII has been removed):
{dom_context}

Redaction summary: {total_regions} region(s) were redacted
  - Faces: {faces_redacted}
  - Sensitive fields: {pii_fields_redacted}

Based ONLY on what is visible in the screenshot (ignore redacted regions),
return ONLY a valid JSON array of actions to help complete the user's task.

Action format:
[
  {{"type": "click",    "selector": "#css-selector", "description": "what you click"}},
  {{"type": "type",     "selector": "#css-selector", "value": "text to type"}},
  {{"type": "scroll",   "direction": "down",          "amount": 300}},
  {{"type": "navigate", "url": "https://example.com"}},
  {{"type": "wait",     "ms": 1000}}
]

If no action is needed or you cannot determine what to do, return: []
Return ONLY the JSON array — no explanation, no markdown, no extra text.
"""


def _get_headers() -> dict:
    """Build OpenRouter auth headers."""
    if not OPENROUTER_API_KEY:
        raise RuntimeError(
            "OPENROUTER_API_KEY environment variable is not set. "
            "Get a free key at https://openrouter.ai and set it in your .env file."
        )
    return {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://shieldbrowse.local",  # required by OpenRouter
        "X-Title": "ShieldBrowse",
    }


async def query_vlm(
    screenshot_b64: str,
    task: str,
    dom_context: str = "",
    redaction_report: Optional[dict] = None,
    model: Optional[str] = None,
) -> tuple[str, str]:
    """
    Sends the sanitized screenshot to OpenRouter and returns (raw_text, model_used).

    Args:
        screenshot_b64: Base64 PNG (no data: prefix)
        task:           User task description
        dom_context:    Sanitized DOM text
        redaction_report: Dict with faces_redacted, pii_fields_redacted, total_regions
        model:          Force a specific model (uses PREFERRED_MODELS[0] if None)

    Returns:
        (raw_llm_output, model_name_used)
    """
    report = redaction_report or {}
    selected_model = model or PREFERRED_MODELS[0]

    prompt = VISION_PROMPT_TEMPLATE.format(
        task=task,
        dom_context=dom_context[:2000] if dom_context else "(none)",
        total_regions=report.get("total_regions", 0),
        faces_redacted=report.get("faces_redacted", 0),
        pii_fields_redacted=report.get("pii_fields_redacted", 0),
    )

    # OpenRouter expects image as a data URL in the message content
    image_data_url = f"data:image/png;base64,{screenshot_b64}"

    payload = {
        "model": selected_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url},
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        "temperature": 0.1,
        "max_tokens": 512,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt_model in ([selected_model] if model else PREFERRED_MODELS):
            payload["model"] = attempt_model
            try:
                resp = await client.post(
                    f"{OPENROUTER_BASE_URL}/chat/completions",
                    json=payload,
                    headers=_get_headers(),
                    timeout=60.0,
                )

                if resp.status_code == 402:
                    # Out of credits on this model — try next
                    continue

                if not resp.is_success:
                    raise RuntimeError(
                        f"OpenRouter error {resp.status_code} ({attempt_model}): {resp.text}"
                    )

                data = resp.json()
                raw_text = data["choices"][0]["message"]["content"].strip()
                return raw_text, attempt_model

            except httpx.TimeoutException:
                if attempt_model == PREFERRED_MODELS[-1]:
                    raise RuntimeError("All OpenRouter models timed out.")
                continue

    raise RuntimeError("All OpenRouter models failed or are unavailable.")


async def check_vlm_health() -> tuple[bool, str]:
    """Returns (is_reachable, model_name_or_empty)."""
    if not OPENROUTER_API_KEY:
        return False, "OPENROUTER_API_KEY not set"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{OPENROUTER_BASE_URL}/models",
                headers=_get_headers(),
                timeout=5.0,
            )
            if resp.is_success:
                return True, PREFERRED_MODELS[0]
            return False, f"HTTP {resp.status_code}"
    except Exception as e:
        return False, str(e)
