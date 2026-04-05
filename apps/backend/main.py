from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if TYPE_CHECKING:
    from langchain_community.vectorstores import Chroma
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_mistralai import ChatMistralAI, MistralAIEmbeddings

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"
VECTORSTORES_DIR = BASE_DIR / "vectorstores"
UPLOADS_DIR.mkdir(exist_ok=True)
VECTORSTORES_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Bookify API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    document_id: str
    message: str


class ChatResponse(BaseModel):
    answer: str


class DocumentStatusResponse(BaseModel):
    document_id: str
    file_name: str
    status: str
    chunks_indexed: int | None = None
    error: str | None = None


@lru_cache
def get_embedding_model() -> "MistralAIEmbeddings":
    from langchain_mistralai import MistralAIEmbeddings

    return MistralAIEmbeddings()


@lru_cache
def get_llm() -> "ChatMistralAI":
    from langchain_mistralai import ChatMistralAI

    return ChatMistralAI(model_name="mistral-small-2506")


@lru_cache
def get_prompt() -> "ChatPromptTemplate":
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You are a helpful AI assistant.

Use only the provided context to answer the question.

If the answer is not present in the context,
say exactly: "I could not find the answer in the document."
""",
            ),
            (
                "human",
                """Context:
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
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_community.vectorstores import Chroma
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    write_document_status(document_id, file_name=file_name, status="indexing")

    try:
        loader = PyPDFLoader(str(upload_path))
        docs = loader.load()

        if not docs:
            raise ValueError("The PDF did not contain readable pages.")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=150,
        )
        chunks = splitter.split_documents(docs)

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


@app.get("/documents/{document_id}", response_model=DocumentStatusResponse)
def get_document_status(document_id: str) -> DocumentStatusResponse:
    return read_document_status(document_id)


@app.post("/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks, file: UploadFile = File(...)
) -> dict[str, str | int]:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    document_id = str(uuid4())
    safe_name = Path(file.filename or "document.pdf").name
    upload_path = UPLOADS_DIR / f"{document_id}-{safe_name}"

    file_bytes = await file.read()
    upload_path.write_bytes(file_bytes)
    write_document_status(document_id, file_name=safe_name, status="queued")
    background_tasks.add_task(index_pdf, document_id, safe_name, upload_path)

    return {
        "document_id": document_id,
        "file_name": safe_name,
        "status": "queued",
    }


@app.post("/chat", response_model=ChatResponse)
def chat_with_document(request: ChatRequest) -> ChatResponse:
    from langchain_community.vectorstores import Chroma

    vectorstore_path = ensure_document_exists(request.document_id)

    vector_store = Chroma(
        persist_directory=str(vectorstore_path),
        embedding_function=get_embedding_model(),
    )

    retriever = vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": 4,
            "fetch_k": 10,
            "lambda_mult": 0.5,
        },
    )

    docs = retriever.invoke(request.message)
    context = "\n\n".join(doc.page_content for doc in docs)

    final_prompt = get_prompt().invoke(
        {
            "context": context,
            "question": request.message,
        }
    )

    response = get_llm().invoke(final_prompt)
    return ChatResponse(answer=response.content)
