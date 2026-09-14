"""
Pydantic request/response schemas for the ShieldBrowse server.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Literal, Optional, List


class RedactionReport(BaseModel):
    faces_redacted: int = Field(default=0, ge=0)
    pii_fields_redacted: int = Field(default=0, ge=0)
    total_regions: int = Field(default=0, ge=0)


class RedactedRegion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    x: float
    y: float
    width: float
    height: float
    type: Optional[str] = None


class SignedManifest(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    timestamp: str
    nonce: str
    frame_hash: str = Field(alias="frameHash")
    regions_count: int = Field(default=0, alias="regionsCount")
    regions: List[RedactedRegion] = Field(default_factory=list)
    signature: str
    algorithm: str = "ECDSA-P256-SHA256"


class ManifestReceiptResponse(BaseModel):
    received: bool = True
    nonce: str
    timestamp: str
    region_count: int
    frame_hash: str
    message: str = "Signed manifest recorded in audit log"


class AgentProcessRequest(BaseModel):
    screenshot: str = Field(description="Base64-encoded sanitized PNG (no data: prefix)")
    dom_context: str = Field(default="", description="Redacted DOM text context")
    task: str = Field(description="User task description")
    redaction_report: RedactionReport = Field(default_factory=RedactionReport)
    signed_manifest: Optional[SignedManifest] = None


class AgentAction(BaseModel):
    type: Literal["click", "scroll", "type", "navigate", "wait"]
    selector: Optional[str] = None
    description: Optional[str] = None
    direction: Optional[Literal["up", "down", "left", "right"]] = None
    amount: Optional[int] = None
    value: Optional[str] = None
    url: Optional[str] = None
    ms: Optional[int] = None


class AgentProcessResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    actions: List[AgentAction] = Field(default_factory=list)
    reasoning: str = Field(default="")
    model_used: str = Field(default="")


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    vlm_reachable: bool
    model: str

