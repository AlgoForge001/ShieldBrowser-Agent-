"""
Agent process endpoint — POST /agent/process

Receives sanitized screenshot + task → queries VLM → returns action list.
"""

from fastapi import APIRouter, HTTPException
from ..models.schemas import AgentProcessRequest, AgentProcessResponse, AgentAction
from ..services.vlm_client import query_vlm
from ..services.action_parser import parse_actions, sanitize_actions
from ..services.image_utils import validate_image, resize_image_if_needed
import logging

logger = logging.getLogger("agent")
router = APIRouter()


@router.post("/agent/process", response_model=AgentProcessResponse)
async def agent_process(request: AgentProcessRequest) -> AgentProcessResponse:
    # Log signed manifest if present
    if request.signed_manifest:
        logger.info(
            "[AUDIT] 📜 Received signed egress manifest: frame_hash=%s... regions=%d nonce=%s sig_len=%d",
            request.signed_manifest.frame_hash[:16],
            request.signed_manifest.regions_count,
            request.signed_manifest.nonce,
            len(request.signed_manifest.signature),
        )

    # Validate image
    is_valid, err = validate_image(request.screenshot)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid screenshot: {err}")

    # Resize if needed (keep bandwidth + VLM context manageable)
    screenshot_b64 = resize_image_if_needed(request.screenshot, max_dim=1280)

    # Build redaction report dict
    report = request.redaction_report.model_dump()

    # Query VLM
    try:
        raw_text, model_used = await query_vlm(
            screenshot_b64=screenshot_b64,
            task=request.task,
            dom_context=request.dom_context,
            redaction_report=report,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("VLM query failed")
        raise HTTPException(status_code=500, detail=f"VLM error: {e}")

    # Parse + sanitize actions
    actions, reasoning = parse_actions(raw_text)
    safe_actions = sanitize_actions(actions)

    logger.info(
        "Processed request | model=%s | actions=%d | task=%r",
        model_used,
        len(safe_actions),
        request.task[:80],
    )

    return AgentProcessResponse(
        actions=safe_actions,
        reasoning=reasoning or raw_text[:500],
        model_used=model_used,
    )
