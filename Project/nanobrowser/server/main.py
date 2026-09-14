"""
ShieldBrowse Server — FastAPI entry point

Start with:
    uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

Or use: server/start.bat
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes.health import router as health_router
from .routes.agent import router as agent_router
from .routes.verify import router as verify_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("shieldbrowse")

app = FastAPI(
    title="ShieldBrowse Server",
    description=(
        "Privacy-preserving browser vision agent backend. "
        "Receives sanitized screenshots (PII redacted client-side), "
        "queries a local VLM (Ollama), and returns browser action commands."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow Chrome extension to POST from any chrome-extension:// origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

# Register routers
app.include_router(health_router, tags=["Health"])
app.include_router(agent_router, tags=["Agent"])
app.include_router(verify_router, tags=["Manifest"])


@app.on_event("startup")
async def startup_event() -> None:
    from .services.vlm_client import check_vlm_health
    ok, model = await check_vlm_health()
    if ok:
        logger.info("ShieldBrowse server started. VLM reachable. Model: %s", model or "(auto)")
    else:
        logger.warning(
            "ShieldBrowse server started (VLM status: %s). "
            "Set OPENROUTER_API_KEY or configure local vision provider.",
            model
        )
