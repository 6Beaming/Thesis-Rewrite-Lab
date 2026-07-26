FROM python:3.12.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SENTENCE_TRANSFORMER_REVISION=c9745ed1d9f207416be6d2e6f8de32d1f16199bf \
    SENTENCE_TRANSFORMER_MODEL=sentence-transformers/all-MiniLM-L6-v2

WORKDIR /service

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN python -c "from sentence_transformers import SentenceTransformer; import os; SentenceTransformer(os.environ['SENTENCE_TRANSFORMER_MODEL'], revision=os.environ['SENTENCE_TRANSFORMER_REVISION'])"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
