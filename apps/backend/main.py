from __future__ import annotations

import json
import os
import re
import secrets
import shutil
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from langchain_community.vectorstores import Chroma
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_mistralai import ChatMistralAI, MistralAIEmbeddings

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = Path(os.getenv("BOOKIFY_STORAGE_DIR", str(BASE_DIR)))
UPLOADS_DIR = Path(
    os.getenv("BOOKIFY_UPLOADS_DIR", str(STORAGE_DIR / "uploads"))
)
VECTORSTORES_DIR = Path(
    os.getenv("BOOKIFY_VECTORSTORES_DIR", str(STORAGE_DIR / "vectorstores"))
)
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))
MIN_CHUNK_CHARS = 80
RETRIEVAL_FETCH_K = int(os.getenv("RAG_RETRIEVAL_FETCH_K", "16"))
RETRIEVAL_TOP_K = int(os.getenv("RAG_RETRIEVAL_TOP_K", "5"))
MISTRAL_MODEL = os.getenv("MISTRAL_MODEL", "mistral-small-2506")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
WARM_ON_STARTUP = os.getenv("BOOKIFY_WARM_ON_STARTUP", "true").lower() in {
    "1",
    "true",
    "yes",
}
BOOKIFY_API_SECRET = os.getenv("BOOKIFY_API_SECRET", "")
MAX_UPLOAD_MB = int(os.getenv("BOOKIFY_MAX_UPLOAD_MB", "20"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
VECTORSTORES_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if WARM_ON_STARTUP:
        # Warm the heavy indexing stack once at startup instead of during the first upload.
        get_indexing_dependencies()
        get_embedding_model()
        get_prompt()
    yield


app = FastAPI(title="Bookify API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    document_id: str
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)


class DocumentStatusResponse(BaseModel):
    document_id: str
    file_name: str
    status: str
    chunks_indexed: int | None = None
    error: str | None = None


def require_backend_auth(
    x_bookify_secret: str | None = Header(default=None, alias="X-Bookify-Secret"),
) -> None:
    if not BOOKIFY_API_SECRET:
        return
    if not secrets.compare_digest(x_bookify_secret or "", BOOKIFY_API_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def sanitize_file_name(raw_name: str | None) -> str:
    name = Path(raw_name or "document.pdf").name.strip() or "document.pdf"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "document.pdf"
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name[:128]


@lru_cache
def get_indexing_dependencies() -> tuple[type, type, type]:
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_community.vectorstores import Chroma
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    return PyPDFLoader, Chroma, RecursiveCharacterTextSplitter


@lru_cache
def get_embedding_model() -> "MistralAIEmbeddings":
    from langchain_mistralai import MistralAIEmbeddings

    return MistralAIEmbeddings()


@lru_cache
def get_llm() -> "ChatMistralAI":
    from langchain_mistralai import ChatMistralAI

    return ChatMistralAI(model_name=MISTRAL_MODEL)


@lru_cache
def get_prompt() -> "ChatPromptTemplate":
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You are a helpful AI assistant.

Use only the provided context to answer the question.
Every context block has a source label like [p. 3, chunk 2].
When you answer, include concise citations using those labels.

If the answer is not present in the context,
say exactly: "I could not find the answer in the document."
""",
            ),
            (
                "human",
                """Recent conversation:
{history}

Context:
{context}

Question:
{question}
""",
            ),
        ]
    )


def get_vectorstore_path(document_id: str) -> Path:
    return VECTORSTORES_DIR / document_id


def get_document_status_path(document_id: str) -> Path:
    return VECTORSTORES_DIR / f"{document_id}.json"


def write_document_status(
    document_id: str,
    *,
    file_name: str,
    status: str,
    chunks_indexed: int | None = None,
    error: str | None = None,
) -> None:
    get_document_status_path(document_id).write_text(
        json.dumps(
            {
                "document_id": document_id,
                "file_name": file_name,
                "status": status,
                "chunks_indexed": chunks_indexed,
                "error": error,
            }
        ),
        encoding="utf-8",
    )


def read_document_status(document_id: str) -> DocumentStatusResponse:
    status_path = get_document_status_path(document_id)
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Document not found.")
    return DocumentStatusResponse.model_validate_json(status_path.read_text(encoding="utf-8"))


def normalize_page_number(metadata: dict[str, Any]) -> int | None:
    page = metadata.get("page")
    if isinstance(page, int):
        return page + 1
    if isinstance(page, str) and page.isdigit():
        return int(page) + 1
    return None


def source_label(metadata: dict[str, Any]) -> str:
    page_number = metadata.get("page_number") or normalize_page_number(metadata)
    chunk_index = metadata.get("chunk_index")

    parts: list[str] = []
    if page_number:
        parts.append(f"p. {page_number}")
    if isinstance(chunk_index, int):
        parts.append(f"chunk {chunk_index + 1}")

    return ", ".join(parts) if parts else "document"


def format_context(docs: list[Any]) -> tuple[str, list[str]]:
    context_blocks: list[str] = []
    sources: list[str] = []

    for doc in docs:
        label = source_label(doc.metadata)
        if label not in sources:
            sources.append(label)
        context_blocks.append(f"[{label}]\n{doc.page_content.strip()}")

    return "\n\n".join(context_blocks), sources


def format_history(history: list[dict[str, str]]) -> str:
    lines: list[str] = []

    for item in history[-6:]:
        role = item.get("role", "").strip().lower()
        content = item.get("content", "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        lines.append(f"{role.title()}: {content[:800]}")

    return "\n".join(lines) if lines else "No previous conversation."


def build_retrieval_query(request: ChatRequest) -> str:
    recent_user_turns = [
        item.get("content", "").strip()
        for item in request.history[-6:]
        if item.get("role") == "user" and item.get("content", "").strip()
    ]
    return "\n".join([*recent_user_turns, request.message.strip()])


def query_terms(query: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]{3,}", query.lower()))


def rerank_documents(docs: list[Any], query: str, limit: int) -> list[Any]:
    terms = query_terms(query)

    def score_doc(position_and_doc: tuple[int, Any]) -> tuple[float, int]:
        position, doc = position_and_doc
        content = doc.page_content.lower()
        lexical_hits = sum(1 for term in terms if term in content)
        page_bonus = 0.1 if doc.metadata.get("page_number") else 0
        return (lexical_hits + page_bonus, -position)

    ranked = sorted(enumerate(docs), key=score_doc, reverse=True)
    return [doc for _, doc in ranked[:limit]]


def with_source_footer(answer: Any, sources: list[str]) -> str:
    text = answer if isinstance(answer, str) else str(answer)
    if not sources or "I could not find the answer in the document." in text:
        return text
    if re.search(r"\[(p\.|document)", text, flags=re.IGNORECASE):
        return text
    return f"{text}\n\nSources: {', '.join(sources)}"


def ensure_document_exists(document_id: str) -> Path:
    status = read_document_status(document_id)
    if status.status == "failed":
        raise HTTPException(status_code=400, detail=status.error or "Document indexing failed.")
    if status.status != "ready":
        raise HTTPException(status_code=409, detail="Document is still being indexed.")

    vectorstore_path = get_vectorstore_path(document_id)
    if not vectorstore_path.exists():
        raise HTTPException(status_code=404, detail="Document index not found.")
    return vectorstore_path


def index_pdf(document_id: str, file_name: str, upload_path: Path) -> None:
    write_document_status(document_id, file_name=file_name, status="indexing")

    try:
        PyPDFLoader, Chroma, RecursiveCharacterTextSplitter = get_indexing_dependencies()
        loader = PyPDFLoader(str(upload_path))
        docs = [doc for doc in loader.load() if doc.page_content.strip()]

        if not docs:
            raise ValueError("The PDF did not contain readable pages.")

        splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            add_start_index=True,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = [
            chunk
            for chunk in splitter.split_documents(docs)
            if len(chunk.page_content.strip()) >= MIN_CHUNK_CHARS
        ]

        if not chunks:
            raise ValueError("The PDF did not contain enough readable text to index.")

        for chunk_index, chunk in enumerate(chunks):
            page_number = normalize_page_number(chunk.metadata)
            chunk.metadata.update(
                {
                    "document_id": document_id,
                    "file_name": file_name,
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "source_label": source_label(
                        {**chunk.metadata, "chunk_index": chunk_index}
                    ),
                }
            )

        Chroma.from_documents(
            documents=chunks,
            embedding=get_embedding_model(),
            persist_directory=str(get_vectorstore_path(document_id)),
        )

        write_document_status(
            document_id,
            file_name=file_name,
            status="ready",
            chunks_indexed=len(chunks),
        )
    except Exception as exc:
        write_document_status(
            document_id,
            file_name=file_name,
            status="failed",
            error=str(exc),
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/documents/{document_id}",
    response_model=DocumentStatusResponse,
    dependencies=[Depends(require_backend_auth)],
)
def get_document_status(document_id: str) -> DocumentStatusResponse:
    return read_document_status(document_id)


def delete_document_files(document_id: str) -> None:
    shutil.rmtree(get_vectorstore_path(document_id), ignore_errors=True)
    status_path = get_document_status_path(document_id)
    if status_path.exists():
        status_path.unlink()
    for upload_path in UPLOADS_DIR.glob(f"{document_id}-*"):
        if upload_path.is_file():
            upload_path.unlink()


@app.delete(
    "/documents/{document_id}", dependencies=[Depends(require_backend_auth)]
)
def delete_document(document_id: str) -> dict[str, str]:
    read_document_status(document_id)  # 404 if unknown
    delete_document_files(document_id)
    return {"document_id": document_id, "status": "deleted"}


@app.post("/upload", dependencies=[Depends(require_backend_auth)])
async def upload_pdf(
    background_tasks: BackgroundTasks, file: UploadFile = File(...)
) -> dict[str, str | int]:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds the {MAX_UPLOAD_MB}MB limit.",
        )
    if file_bytes[:4] != b"%PDF":
        raise HTTPException(status_code=400, detail="File is not a valid PDF.")

    document_id = str(uuid4())
    safe_name = sanitize_file_name(file.filename)
    upload_path = UPLOADS_DIR / f"{document_id}-{safe_name}"

    upload_path.write_bytes(file_bytes)
    write_document_status(document_id, file_name=safe_name, status="queued")
    background_tasks.add_task(index_pdf, document_id, safe_name, upload_path)

    return {
        "document_id": document_id,
        "file_name": safe_name,
        "status": "queued",
    }


def prepare_chat(request: ChatRequest) -> tuple[Any, list[str]]:
    from langchain_community.vectorstores import Chroma

    vectorstore_path = ensure_document_exists(request.document_id)

    vector_store = Chroma(
        persist_directory=str(vectorstore_path),
        embedding_function=get_embedding_model(),
    )

    retrieval_query = build_retrieval_query(request)
    retriever = vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": RETRIEVAL_FETCH_K,
            "fetch_k": max(RETRIEVAL_FETCH_K * 2, 20),
            "lambda_mult": 0.5,
        },
    )

    retrieved_docs = retriever.invoke(retrieval_query)
    docs = rerank_documents(retrieved_docs, retrieval_query, RETRIEVAL_TOP_K)
    context, sources = format_context(docs)

    final_prompt = get_prompt().invoke(
        {
            "context": context,
            "history": format_history(request.history),
            "question": request.message,
        }
    )
    return final_prompt, sources


def sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@app.post(
    "/chat", response_model=ChatResponse, dependencies=[Depends(require_backend_auth)]
)
def chat_with_document(request: ChatRequest) -> ChatResponse:
    final_prompt, sources = prepare_chat(request)
    response = get_llm().invoke(final_prompt)
    return ChatResponse(
        answer=with_source_footer(response.content, sources),
        sources=sources,
    )


@app.post("/chat/stream", dependencies=[Depends(require_backend_auth)])
def chat_stream_with_document(request: ChatRequest) -> StreamingResponse:
    final_prompt, sources = prepare_chat(request)

    def generate() -> Any:
        yield sse_event("sources", {"sources": sources})
        streamed: list[str] = []
        try:
            for chunk in get_llm().stream(final_prompt):
                text = chunk.content if isinstance(chunk.content, str) else ""
                if text:
                    streamed.append(text)
                    yield sse_event("token", {"token": text})
        except Exception as exc:
            yield sse_event("error", {"detail": str(exc)})
            return

        full_text = "".join(streamed)
        footer_text = with_source_footer(full_text, sources)
        if len(footer_text) > len(full_text):
            yield sse_event("token", {"token": footer_text[len(full_text):]})

        yield sse_event("done", {})

    return StreamingResponse(generate(), media_type="text/event-stream")
