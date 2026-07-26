import os

PIPELINE_VERSION = "document-nlp-v1"
CONTRACT_VERSION = "nlp-contract-v1"
PARTITION_ALGORITHM_VERSION = "contiguous-semantic-v1"
SPACY_MODEL = "en_core_web_sm==3.8.0"
EMBEDDING_MODEL_NAME = os.getenv(
    "SENTENCE_TRANSFORMER_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)
EMBEDDING_MODEL_REVISION = os.getenv(
    "SENTENCE_TRANSFORMER_REVISION",
    "c9745ed1d9f207416be6d2e6f8de32d1f16199bf",
)
GRAMMAR_RULES_VERSION = "thesis-grammar-rules-v1"
KNOWN_TERMS_VERSION = "known-terms-v1"


def version_info() -> dict:
    return {
        "pipelineVersion": PIPELINE_VERSION,
        "contractVersion": CONTRACT_VERSION,
        "partitionAlgorithmVersion": PARTITION_ALGORITHM_VERSION,
        "spacyModel": SPACY_MODEL,
        "embeddingModel": (
            f"{EMBEDDING_MODEL_NAME}@{EMBEDDING_MODEL_REVISION}"
        ),
        "grammarRulesVersion": GRAMMAR_RULES_VERSION,
        "knownTermsVersion": KNOWN_TERMS_VERSION,
    }
