"""Health check endpoint."""

from fastapi import APIRouter
from ..services.vlm_client import check_vlm_health
from ..models.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    vlm_ok, model = await check_vlm_health()
    return HealthResponse(
        status="ok" if vlm_ok else "degraded",
        vlm_reachable=vlm_ok,
        model=model,
    )
