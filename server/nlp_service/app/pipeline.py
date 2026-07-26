import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass

import numpy as np
import spacy
from sentence_transformers import SentenceTransformer

from .schemas import (
    AnalyzeBlockResponse,
    Candidate,
    Issue,
    PartitionDocumentResponse,
    SemanticAnchor,
    SentenceResult,
)
from .versioning import (
    CONTRACT_VERSION,
    EMBEDDING_MODEL_NAME,
    EMBEDDING_MODEL_REVISION,
    PIPELINE_VERSION,
)

SPACY = spacy.load("en_core_web_sm")
EMBEDDINGS = SentenceTransformer(
    EMBEDDING_MODEL_NAME,
    revision=EMBEDDING_MODEL_REVISION,
)

STRUCTURAL_SKIP_TYPES = {
    "heading",
    "subheading",
    "customPseudoHeading",
    "figureCaption",
    "bibliographyHeading",
    "bibliographyEntry",
    "referenceEntry",
    "annotation",
    "imageDescription",
    "listLabel",
    "code",
    "equation",
}
AUTO_SKIP = {
    "EMPTY_OR_SYMBOL_ONLY",
    "OCR_GARBAGE",
    "TRUNCATED_EXTRACTION",
    "GENERIC_IMAGE_DESCRIPTION",
    "MEANINGLESS_FRAGMENT",
    "LOW_INFORMATION_SENTENCE",
    "NON_ARGUMENTATIVE_STRUCTURE",
    "PSEUDO_TITLE",
}
TYPO_MAP = {
    "accomodate": "accommodate",
    "becuase": "because",
    "beleive": "believe",
    "definately": "definitely",
    "goverment": "government",
    "grammer": "grammar",
    "occured": "occurred",
    "recieve": "receive",
    "seperate": "separate",
    "sucessful": "successful",
    "teh": "the",
    "untill": "until",
    "wierd": "weird",
    "writting": "writing",
}
PROFILES = {
    "low": {
        "split": 0.30,
        "severe": 0.18,
        "minimum": 600,
        "target": 700,
        "maximum": 800,
    },
    "medium": {
        "split": 0.42,
        "severe": 0.25,
        "minimum": 450,
        "target": 650,
        "maximum": 800,
    },
    "high": {
        "split": 0.52,
        "severe": 0.32,
        "minimum": 250,
        "target": 550,
        "maximum": 800,
    },
}

LOW_INFORMATION_RE = re.compile(
    r"^(?:hello(?:\s*,?\s*world)?|this is (?:a|the) new line|"
    r"test(?:ing)?(?:\s+(?:line|sentence|text))?|"
    r"sample(?:\s+(?:line|sentence|text))?)[.!?]*$",
    re.I,
)
PSEUDO_TITLE_RE = re.compile(
    r"^(?:assignment|article|chapter|section|part|appendix|abstract|"
    r"introduction|conclusion)\b",
    re.I,
)
ACADEMIC_SIGNAL_RE = re.compile(
    r"\b(?:argu|claim|eviden|result|research|study|analys|method|finding|"
    r"valid|reliab|signific|hypothes|theor|conclud|demonstrat|indicat|"
    r"suggest|support)\w*\b",
    re.I,
)


def text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def cp_offset(value: str, character_offset: int) -> int:
    return len(value[:character_offset])


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.dot(left, right) / denominator) if denominator else 0.0


def topic_terms(doc) -> list[str]:
    counts = Counter(
        token.lemma_.lower()
        for token in doc
        if token.is_alpha
        and not token.is_stop
        and len(token.lemma_) >= 4
        and token.lemma_.lower() not in {"document", "paper"}
    )
    return [
        term
        for term, _count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )[:8]
    ]


@dataclass
class InternalSentence:
    public: SentenceResult
    text: str
    embedding: np.ndarray


def analyze_sentences(
    text: str,
    source_type: str,
    known_terms: list[str],
) -> tuple[list[InternalSentence], object]:
    doc = SPACY(text)
    spans = list(doc.sents) or ([doc[:]] if text else [])
    texts = [span.text_with_ws for span in spans]
    vectors = (
        EMBEDDINGS.encode(texts, convert_to_numpy=True, batch_size=32)
        if texts
        else np.empty((0, 384), dtype=np.float32)
    )
    protected = {term.lower() for term in known_terms}
    results: list[InternalSentence] = []
    for index, (span, sentence_text, vector) in enumerate(
        zip(spans, texts, vectors, strict=True)
    ):
        start_cp = cp_offset(text, span.start_char)
        end_cp = start_cp + len(sentence_text)
        trimmed = sentence_text.strip()
        structural_skip = source_type in STRUCTURAL_SKIP_TYPES
        reasons: list[str] = []
        issues: list[Issue] = []
        visible = sum(character.isalnum() for character in trimmed)
        letters = sum(character.isalpha() for character in trimmed)
        finite = any(
            token.pos_ in {"VERB", "AUX"}
            and "Fin" in token.morph.get("VerbForm")
            for token in span
        ) or any(token.pos_ in {"VERB", "AUX"} for token in span)
        unmatched = any(
            trimmed.count(opening) != trimmed.count(closing)
            for opening, closing in (("(", ")"), ("[", "]"), ("{", "}"), ("“", "”"))
        )
        ends_function_word = bool(
            re.search(r"\b(a|an|and|as|at|by|for|from|in|of|on|or|the|to|with)\W*$", trimmed, re.I)
        )

        word_count = len([
            token for token in span if token.is_alpha or token.like_num
        ])
        pseudo_title = (
            bool(trimmed)
            and word_count <= 16
            and not re.search(r"[.!?]$", trimmed)
            and (
                bool(PSEUDO_TITLE_RE.match(trimmed))
                or bool(re.match(
                    r"^[A-Z0-9][^.!?]{1,120}:\s*[^.!?]{1,100}$",
                    trimmed,
                ))
            )
        )

        if structural_skip:
            reasons.append("NON_ARGUMENTATIVE_STRUCTURE")
        elif not trimmed or not visible:
            reasons.append("EMPTY_OR_SYMBOL_ONLY")
        elif LOW_INFORMATION_RE.match(trimmed):
            reasons.append("LOW_INFORMATION_SENTENCE")
        elif pseudo_title:
            reasons.append("PSEUDO_TITLE")
        elif len(trimmed) >= 8 and letters / max(1, len(trimmed)) < 0.35:
            reasons.append("OCR_GARBAGE")
        elif re.search(r"(?:\uFFFD{2,}|\.{4,}|\[\s*(truncated|missing)\s*\])$", trimmed, re.I):
            reasons.append("TRUNCATED_EXTRACTION")
        elif re.match(r"^(an?\s+)?(image|picture|photo)\s+of\b", trimmed, re.I) and len(list(span)) < 12:
            reasons.append("GENERIC_IMAGE_DESCRIPTION")
        elif not finite and unmatched and ends_function_word:
            reasons.append("MEANINGLESS_FRAGMENT")
        elif (
            word_count <= 3
            and not ACADEMIC_SIGNAL_RE.search(trimmed)
            and not any(character.isdigit() for character in trimmed)
        ):
            reasons.append("LOW_INFORMATION_SENTENCE")

        for token in span:
            normalized = token.text.lower()
            suggestion = TYPO_MAP.get(normalized)
            if not suggestion or normalized in protected:
                continue
            token_start = cp_offset(text, token.idx)
            issues.append(Issue(
                startCp=token_start,
                endCp=token_start + len(token.text),
                code="SPELLING_TYPO",
                severity="warning",
                message=f"Possible spelling issue: “{token.text}”.",
                original=token.text,
                suggestion=suggestion,
                confidence="high",
            ))

        if not reasons and not finite and len(list(span)) > 2:
            issues.append(Issue(
                startCp=start_cp,
                endCp=end_cp,
                code="POSSIBLE_FRAGMENT",
                severity="warning",
                message="This sentence may be incomplete.",
                confidence="medium",
            ))
        if not reasons and unmatched:
            issues.append(Issue(
                startCp=start_cp,
                endCp=end_cp,
                code="UNMATCHED_DELIMITER",
                severity="blocking",
                message="A bracket or quotation mark appears to be unmatched.",
                confidence="high",
            ))
        if (
            not reasons
            and word_count >= 4
            and not re.search(r"""[.!?]["')\]}]*$""", trimmed)
        ):
            issues.append(Issue(
                startCp=start_cp,
                endCp=end_cp,
                code="MISSING_END_PUNCTUATION",
                severity="warning",
                message="This sentence may need ending punctuation.",
                confidence="high",
            ))

        skipped = any(reason in AUTO_SKIP for reason in reasons)
        blocking = skipped or any(item.severity == "blocking" for item in issues)
        status = (
            "skipped"
            if skipped
            else "blocked"
            if blocking
            else "warning"
            if issues
            else "pass"
        )
        sentence_doc = SPACY(sentence_text)
        terms = topic_terms(sentence_doc)
        public = SentenceResult(
            index=index,
            startCp=start_cp,
            endCp=end_cp,
            textHash=text_hash(sentence_text),
            status=status,
            issues=issues,
            entities=[entity.text for entity in sentence_doc.ents[:10]],
            nounChunks=[chunk.text for chunk in list(sentence_doc.noun_chunks)[:10]],
            topicTerms=terms,
            reasonCodes=reasons,
            sourceType=source_type,
            hardBoundaryBefore=False,
            oversizedSentence=len(sentence_text) > 800,
        )
        results.append(InternalSentence(public=public, text=sentence_text, embedding=vector))
    return results, doc


def block_result(text: str, source_type: str, known_terms: list[str]) -> AnalyzeBlockResponse:
    sentences, doc = analyze_sentences(text, source_type, known_terms)
    issues = [issue for sentence in sentences for issue in sentence.public.issues]
    reasons = sorted({
        reason
        for sentence in sentences
        for reason in sentence.public.reasonCodes
    })
    usable = [item for item in sentences if item.public.status != "skipped"]
    if len(usable) < 2:
        coherence = 1.0 if usable else None
    else:
        coherence = sum(
            cosine(usable[index - 1].embedding, usable[index].embedding)
            for index in range(1, len(usable))
        ) / (len(usable) - 1)
        coherence = max(0.0, min(1.0, coherence))
    anchor = None
    valid = [
        item
        for item in sentences
        if item.public.status in {"pass", "warning"}
    ]
    terms = topic_terms(doc)
    if valid and terms:
        centroid = np.mean([item.embedding for item in valid], axis=0)
        representative = max(
            valid,
            key=lambda item: cosine(item.embedding, centroid),
        )
        representative_similarity = cosine(representative.embedding, centroid)
        score = (
            (coherence if coherence is not None else 0.5) * 0.55
            + representative_similarity * 0.35
            + min(1.0, len(terms) / 4) * 0.10
        )
        if score >= 0.42:
            anchor = SemanticAnchor(
                topicTerms=terms[:5],
                representativeStartCp=representative.public.startCp,
                representativeEndCp=representative.public.endCp,
                confidence=(
                    "high" if score >= 0.7 else "medium" if score >= 0.55 else "low"
                ),
            )
    all_skipped = bool(sentences) and all(
        item.public.status == "skipped" for item in sentences
    )
    has_blocking = any(item.severity == "blocking" for item in issues)
    status = (
        "skipped"
        if all_skipped
        else "blocked"
        if has_blocking or not sentences
        else "warning"
        if issues
        else "pass"
    )
    return AnalyzeBlockResponse(
        textHash=text_hash(text),
        pipelineVersion=PIPELINE_VERSION,
        contractVersion=CONTRACT_VERSION,
        status=status,
        reasonCodes=reasons,
        sentenceCount=len(sentences),
        sentences=[item.public for item in sentences],
        issues=issues,
        issueCounts={
            "warning": sum(item.severity == "warning" for item in issues),
            "blocking": sum(item.severity == "blocking" for item in issues),
        },
        semanticCoherence=coherence,
        semanticAnchor=anchor,
        rewriteEligible=status in {"pass", "warning"},
    )


def partition_document(
    structural_blocks,
    semantic_profile: str,
) -> PartitionDocumentResponse:
    profile = PROFILES[semantic_profile]
    output: list[Candidate] = []
    for paragraph_index, structural in enumerate(structural_blocks):
        text = structural.text
        if not text:
            continue
        if structural.sourceType in STRUCTURAL_SKIP_TYPES:
            analysis = block_result(
                text,
                structural.sourceType,
                structural.knownTerms,
            )
            output.append(Candidate(
                text=text,
                startCp=0,
                endCp=len(text),
                paragraphIndex=paragraph_index,
                sourceType=structural.sourceType,
                level=structural.level,
                initialStatus="skipped",
                nlpStatus="skipped",
                reasonCodes=analysis.reasonCodes,
                semanticCoherence=analysis.semanticCoherence,
                semanticAnchor=analysis.semanticAnchor,
                nlpAnalysis=analysis,
                oversizedSentence=len(text) > 800,
            ))
            continue
        analyzed, _doc = analyze_sentences(
            text,
            structural.sourceType,
            structural.knownTerms,
        )
        groups: list[tuple[list[InternalSentence], str]] = []
        current: list[InternalSentence] = []

        def flush():
            nonlocal current
            if current:
                groups.append((current, "unprocessed"))
                current = []

        for sentence in analyzed:
            if sentence.public.status == "skipped":
                flush()
                groups.append(([sentence], "skipped"))
                continue
            if not current:
                current = [sentence]
                continue
            centroid = np.mean([item.embedding for item in current], axis=0)
            coherence = (
                0.6 * cosine(sentence.embedding, centroid)
                + 0.4 * cosine(sentence.embedding, current[-1].embedding)
            )
            start_cp = current[0].public.startCp
            projected = sentence.public.endCp - start_cp
            current_length = current[-1].public.endCp - start_cp
            should_split = (
                projected > profile["maximum"]
                or coherence < profile["severe"]
                or (
                    coherence < profile["split"]
                    and current_length >= profile["minimum"]
                )
            )
            if should_split:
                flush()
                current = [sentence]
            else:
                current.append(sentence)
        flush()

        for group, initial_status in groups:
            start_cp = group[0].public.startCp
            end_cp = group[-1].public.endCp
            candidate_text = text[start_cp:end_cp]
            analysis = block_result(
                candidate_text,
                structural.sourceType,
                structural.knownTerms,
            )
            nlp_status = "skipped" if initial_status == "skipped" else analysis.status
            analysis.status = nlp_status
            analysis.rewriteEligible = nlp_status in {"pass", "warning"}
            output.append(Candidate(
                text=candidate_text,
                startCp=start_cp,
                endCp=end_cp,
                paragraphIndex=paragraph_index,
                sourceType=structural.sourceType,
                level=structural.level,
                initialStatus=initial_status,
                nlpStatus=nlp_status,
                reasonCodes=analysis.reasonCodes,
                semanticCoherence=analysis.semanticCoherence,
                semanticAnchor=analysis.semanticAnchor,
                nlpAnalysis=analysis,
                oversizedSentence=any(
                    sentence.public.oversizedSentence for sentence in group
                ),
            ))
    return PartitionDocumentResponse(
        pipelineVersion=PIPELINE_VERSION,
        semanticProfile=semantic_profile,
        candidates=output,
    )
