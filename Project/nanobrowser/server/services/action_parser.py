"""
Action Parser — parses LLM output into structured AgentAction list.

The LLM is prompted to return ONLY a JSON array. This parser is
resilient: it tries strict JSON first, then extracts JSON from
markdown code blocks, then falls back to regex for common patterns.
"""

import json
import re
from typing import List, Optional
from ..models.schemas import AgentAction


def parse_actions(raw_text: str) -> tuple[List[AgentAction], str]:
    """
    Parses the LLM output into a list of AgentAction objects.

    Returns:
        (actions, reasoning) tuple where reasoning is any non-JSON text.
    """
    raw_text = raw_text.strip()
    reasoning = ""

    # Strategy 1: Try direct JSON parse
    actions = _try_json_parse(raw_text)
    if actions is not None:
        return actions, reasoning

    # Strategy 2: Extract JSON from markdown code block
    code_block = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw_text, re.IGNORECASE)
    if code_block:
        candidate = code_block.group(1).strip()
        actions = _try_json_parse(candidate)
        if actions is not None:
            # Everything outside the code block is reasoning
            reasoning = raw_text.replace(code_block.group(0), "").strip()
            return actions, reasoning

    # Strategy 3: Find first JSON array in text
    array_match = re.search(r"\[[\s\S]*\]", raw_text)
    if array_match:
        candidate = array_match.group(0)
        actions = _try_json_parse(candidate)
        if actions is not None:
            reasoning = raw_text.replace(candidate, "").strip()
            return actions, reasoning

    # Strategy 4: Return empty list with full text as reasoning
    return [], raw_text


def _try_json_parse(text: str) -> Optional[List[AgentAction]]:
    """Attempts to parse text as a JSON array of actions. Returns None on failure."""
    try:
        data = json.loads(text)
        if not isinstance(data, list):
            return None
        actions = []
        for item in data:
            if not isinstance(item, dict):
                continue
            action_type = item.get("type", "").lower()
            if action_type not in ("click", "scroll", "type", "navigate", "wait"):
                continue
            try:
                actions.append(AgentAction(**{k: v for k, v in item.items()}))
            except Exception:
                continue
        return actions
    except (json.JSONDecodeError, ValueError):
        return None


def sanitize_actions(actions: List[AgentAction]) -> List[AgentAction]:
    """
    Post-processes parsed actions to remove unsafe ones.
    - Blocks navigate actions to non-http/https URLs.
    - Removes actions with empty required fields.
    """
    safe = []
    for action in actions:
        if action.type == "navigate":
            url = action.url or ""
            if not url.startswith(("http://", "https://")):
                continue
        if action.type in ("click", "type") and not action.selector:
            continue
        safe.append(action)
    return safe
