import logging
import time
import uuid

from fastapi import FastAPI, Header, HTTPException

from .pipeline import block_result, partition_document
from .schemas import AnalyzeBlockRequest, PartitionDocumentRequest
from .versioning import PIPELINE_VERSION, version_info

LOGGER = logging.getLogger("thesis-rewriter-nlp")
app = FastAPI(
    title="Thesis Rewriter NLP Service",
    version=PIPELINE_VERSION,
    docs_url=None,
    redoc_url=None,
)


def correlation_id(header_value: str | None, request_id: str | None = None) -> str:
    return (header_value or request_id or str(uuid.uuid4()))[:100]


@app.get("/health")
def health():
    return {"status": "ready", **version_info()}


@app.post("/v1/analyze-block")
def analyze_block(
    request: AnalyzeBlockRequest,
    x_correlation_id: str | None = Header(default=None),
):
    correlation = correlation_id(x_correlation_id, request.requestId)
    started = time.monotonic()
    try:
        result = block_result(
            request.text,
            request.sourceType,
            request.knownTerms,
        )
        LOGGER.info(
            "nlp_stage_complete correlation_id=%s stage=block-analysis "
            "duration_ms=%d issue_count=%d",
            correlation,
            round((time.monotonic() - started) * 1000),
            len(result.issues),
        )
        return result
    except Exception as error:
        LOGGER.exception(
            "nlp_stage_failed correlation_id=%s stage=block-analysis error_type=%s",
            correlation,
            type(error).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={"code": "NLP_INVALID_OUTPUT", "correlationId": correlation},
        ) from None


@app.post("/v1/partition-document")
def partition(
    request: PartitionDocumentRequest,
    x_correlation_id: str | None = Header(default=None),
):
    correlation = correlation_id(x_correlation_id, request.requestId)
    if request.pipelineVersion != PIPELINE_VERSION:
        raise HTTPException(
            status_code=409,
            detail={"code": "NLP_PIPELINE_MISMATCH", "correlationId": correlation},
        )
    started = time.monotonic()
    try:
        result = partition_document(
            request.structuralBlocks,
            request.semanticProfile,
        )
        LOGGER.info(
            "nlp_stage_complete correlation_id=%s stage=document-partition "
            "duration_ms=%d candidate_count=%d",
            correlation,
            round((time.monotonic() - started) * 1000),
            len(result.candidates),
        )
        return result
    except Exception as error:
        LOGGER.exception(
            "nlp_stage_failed correlation_id=%s stage=document-partition error_type=%s",
            correlation,
            type(error).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={"code": "NLP_INVALID_OUTPUT", "correlationId": correlation},
        ) from None
