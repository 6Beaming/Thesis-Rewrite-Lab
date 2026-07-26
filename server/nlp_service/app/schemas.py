from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


NlpStatus = Literal["unknown", "pass", "warning", "blocked", "skipped"]
Confidence = Literal["low", "medium", "high"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyzeBlockRequest(StrictModel):
    text: str = Field(max_length=100_000)
    sourceType: str = Field(default="paragraph", max_length=80)
    locale: str = Field(default="en", max_length=20)
    knownTerms: list[str] = Field(default_factory=list, max_length=500)
    requestId: str = Field(min_length=1, max_length=100)


class StructuralBlock(StrictModel):
    text: str = Field(max_length=500_000)
    sourceType: str = Field(default="paragraph", max_length=80)
    level: int | None = None
    attrs: dict = Field(default_factory=dict)
    knownTerms: list[str] = Field(default_factory=list, max_length=500)


class PartitionDocumentRequest(StrictModel):
    structuralBlocks: list[StructuralBlock] = Field(max_length=10_000)
    semanticProfile: Literal["low", "medium", "high"] = "medium"
    locale: str = Field(default="en", max_length=20)
    pipelineVersion: str
    requestId: str = Field(min_length=1, max_length=100)


class Issue(StrictModel):
    startCp: int = Field(ge=0)
    endCp: int = Field(ge=0)
    code: str
    severity: Literal["warning", "blocking"]
    message: str
    original: str | None = None
    suggestion: str | None = None
    confidence: Confidence | None = None

    @model_validator(mode="after")
    def offsets_are_ordered(self):
        if self.endCp < self.startCp:
            raise ValueError("endCp must not precede startCp")
        return self


class SentenceResult(StrictModel):
    index: int = Field(ge=0)
    startCp: int = Field(ge=0)
    endCp: int = Field(ge=0)
    textHash: str
    status: NlpStatus
    issues: list[Issue]
    entities: list[str]
    nounChunks: list[str]
    topicTerms: list[str]
    reasonCodes: list[str]
    sourceType: str
    hardBoundaryBefore: bool = False
    oversizedSentence: bool = False


class SemanticAnchor(StrictModel):
    topicTerms: list[str]
    representativeStartCp: int | None = None
    representativeEndCp: int | None = None
    confidence: Confidence


class AnalyzeBlockResponse(StrictModel):
    textHash: str
    pipelineVersion: str
    contractVersion: str
    status: NlpStatus
    reasonCodes: list[str]
    sentenceCount: int
    sentences: list[SentenceResult]
    issues: list[Issue]
    issueCounts: dict[str, int]
    semanticCoherence: float | None
    semanticAnchor: SemanticAnchor | None
    rewriteEligible: bool
    degraded: bool = False
    analysisWarnings: list[str] = Field(default_factory=list)


class Candidate(StrictModel):
    text: str
    startCp: int
    endCp: int
    paragraphIndex: int
    sourceType: str
    level: int | None
    initialStatus: Literal["unprocessed", "skipped"]
    nlpStatus: NlpStatus
    reasonCodes: list[str]
    semanticCoherence: float | None
    semanticAnchor: SemanticAnchor | None
    nlpAnalysis: AnalyzeBlockResponse
    oversizedSentence: bool = False


class PartitionDocumentResponse(StrictModel):
    pipelineVersion: str
    semanticProfile: Literal["low", "medium", "high"]
    candidates: list[Candidate]
    degraded: bool = False
    warnings: list[str] = Field(default_factory=list)
