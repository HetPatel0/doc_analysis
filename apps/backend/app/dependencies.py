from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from langchain_community.vectorstores import Chroma
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_mistralai import ChatMistralAI, MistralAIEmbeddings


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

    return ChatMistralAI(model_name=settings.mistral_model)


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
