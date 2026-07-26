# syntax=docker/dockerfile:1.7

FROM python:3.12.11-slim@sha256:47ae396f09c1303b8653019811a8498470603d7ffefc29cb07c88f1f8cb3d19f

LABEL org.opencontainers.image.source="https://github.com/UTSC-CSCC09-Programming-on-the-Web/project-thesis-rewriter" \
      org.opencontainers.image.description="Thesis Rewriter private NLP service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/opt/huggingface \
    SENTENCE_TRANSFORMER_REVISION=c9745ed1d9f207416be6d2e6f8de32d1f16199bf \
    SENTENCE_TRANSFORMER_MODEL=sentence-transformers/all-MiniLM-L6-v2

WORKDIR /service

RUN groupadd --system nlp \
    && useradd --system --gid nlp --home-dir /service --no-create-home nlp \
    && mkdir -p /opt/huggingface \
    && chown -R nlp:nlp /service /opt/huggingface

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade \
      pip==26.1.2 \
      setuptools==83.0.0 \
    && pip install --no-cache-dir torch==2.8.0 \
      --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY --chown=nlp:nlp app ./app

USER nlp
RUN pip check \
    && python -c "from sentence_transformers import SentenceTransformer; import os; SentenceTransformer(os.environ['SENTENCE_TRANSFORMER_MODEL'], revision=os.environ['SENTENCE_TRANSFORMER_REVISION'])"

ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=90s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
