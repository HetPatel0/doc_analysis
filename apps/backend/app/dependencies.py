from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_mistralai import ChatMistralAI, MistralAIEmbeddings


@lru_cache
def get_indexing_dependencies() -> tuple[type, type, type]:
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_community.vectorstores import Chroma
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    return PyPDFLoader, Chroma, RecursiveCharacterTextSplitter


@lru_cache
def get_embedding_model() -> MistralAIEmbeddings:
    from langchain_mistralai import MistralAIEmbeddings

    return MistralAIEmbeddings()


@lru_cache
def get_llm() -> ChatMistralAI:
    from langchain_mistralai import ChatMistralAI

    return ChatMistralAI(model_name=settings.mistral_model)


@lru_cache
def get_prompt() -> ChatPromptTemplate:
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You are a helpful AI assistant answering questions about a document.

Use only the provided context to answer the question.
Every context block has a source label like [p. 3, chunk 2].
When you answer, include concise citations using those labels.

The context may state a fact using different words than the question. Treat a
paraphrase as present. Before answering, silently identify the sentence that
states the requested fact; if you find one, answer from it.
Only if no sentence supports an answer, say exactly:
"I could not find the answer in the document."
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


@lru_cache
def get_query_rewrite_prompt() -> ChatPromptTemplate:
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """Rewrite the user's latest question into a standalone search query
for the document. Use the recent conversation only to resolve references such
as "it", "that", or "and the price?".

Rules:
- Preserve names, numbers and technical terms exactly.
- Do not answer the question and do not add facts.
- Return only the rewritten query on one line, with no quotes or explanation.
""",
            ),
            (
                "human",
                """Recent conversation:
{history}

Latest question:
{question}

Standalone search query:""",
            ),
        ]
    )
