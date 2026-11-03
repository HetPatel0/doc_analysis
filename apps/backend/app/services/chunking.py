"""Chunking strategies for document indexing.

``recursive`` is the original size-based splitter: it cuts at the last
paragraph/sentence/word boundary that fits inside ``RAG_CHUNK_SIZE`` tokens.
``semantic`` groups sentences where their embeddings stay similar and cuts
where the topic changes, then applies the same hard size cap as a fallback.

Both strategies return ``Document`` objects with the source metadata intact, so
the rest of indexing (embedding, pgvector storage, citations) is unchanged.
Semantic chunking is opt-in via ``RAG_CHUNK_STRATEGY=semantic``; any failure
falls back to the recursive splitter rather than failing an upload.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from langchain_core.documents import Document

from app import dependencies as deps
from app.config import settings

logger = logging.getLogger(__name__)

STRATEGIES = frozenset({"recursive", "semantic"})
DEFAULT_STRATEGY = "recursive"

# Abbreviations whose trailing full stop must not end a sentence.
_ABBREVIATIONS = (
    "e.g.",
    "i.e.",
    "etc.",
    "vs.",
    "Mr.",
    "Mrs.",
    "Ms.",
    "Dr.",
    "Prof.",
    "Inc.",
    "Ltd.",
    "Co.",
    "U.S.",
    "U.K.",
    "No.",
)
_ABBREVIATION_RE = re.compile(
    "|".join(re.escape(item) for item in _ABBREVIATIONS), re.IGNORECASE
)
_PROTECTED_DOT = "\u0000"
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“(\[])")
_BULLET_LINE_RE = re.compile(r"^(?:[-*•]|\d+[.)])\s+")
_PARAGRAPH_RE = re.compile(r"\n\s*\n")


@dataclass(frozen=True)
class _Sentence:
    text: str
    paragraph: int


@lru_cache(maxsize=1)
def _encoding() -> Any:
    import tiktoken

    # Match RecursiveCharacterTextSplitter.from_tiktoken_encoder's default.
    return tiktoken.get_encoding("gpt2")


def _token_length(text: str) -> int:
    return len(_encoding().encode(text))


def split_documents(
    docs: Sequence[Document],
    *,
    strategy: str | None = None,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    min_chunk_chars: int | None = None,
    length_function: Callable[[str], int] | None = None,
    embedding_model: Any | None = None,
) -> list[Document]:
    """Split loaded pages into indexable chunks.

    Everything is injectable for offline tests; production calls this with no
    arguments and reads the strategy and size knobs from settings.
    """
    chosen = (strategy or settings.chunk_strategy or DEFAULT_STRATEGY).lower()
    size = chunk_size if chunk_size is not None else settings.chunk_size
    overlap = (
        chunk_overlap if chunk_overlap is not None else settings.chunk_overlap
    )
    minimum = (
        min_chunk_chars
        if min_chunk_chars is not None
        else settings.min_chunk_chars
    )
    measure = length_function or _token_length

    if chosen not in STRATEGIES:
        logger.warning(
            "unknown RAG_CHUNK_STRATEGY=%r; using %s", chosen, DEFAULT_STRATEGY
        )
        chosen = DEFAULT_STRATEGY

    if chosen == "semantic":
        try:
            chunks = _split_semantic(
                docs,
                chunk_size=size,
                chunk_overlap=overlap,
                min_chunk_chars=minimum,
                length_function=measure,
                embedding_model=embedding_model,
            )
            if chunks:
                return chunks
            logger.warning("semantic chunking produced no chunks; using recursive")
        except Exception as exc:
            logger.warning("semantic chunking failed (%s); using recursive", exc)

    return _split_recursive(
        docs,
        chunk_size=size,
        chunk_overlap=overlap,
        min_chunk_chars=minimum,
    )


def _split_recursive(
    docs: Sequence[Document],
    *,
    chunk_size: int,
    chunk_overlap: int,
    min_chunk_chars: int,
) -> list[Document]:
    _, Splitter = deps.get_indexing_dependencies()
    splitter = Splitter.from_tiktoken_encoder(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=True,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return [
        chunk
        for chunk in splitter.split_documents(list(docs))
        if len(chunk.page_content.strip()) >= min_chunk_chars
    ]


def _split_semantic(
    docs: Sequence[Document],
    *,
    chunk_size: int,
    chunk_overlap: int,
    min_chunk_chars: int,
    length_function: Callable[[str], int],
    embedding_model: Any | None,
) -> list[Document]:
    model = embedding_model or deps.get_embedding_model()
    chunks: list[Document] = []
    for doc in docs:
        chunks.extend(
            _split_page_semantically(
                doc,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                min_chunk_chars=min_chunk_chars,
                length_function=length_function,
                embedding_model=model,
            )
        )
    return chunks


def _split_page_semantically(
    doc: Document,
    *,
    chunk_size: int,
    chunk_overlap: int,
    min_chunk_chars: int,
    length_function: Callable[[str], int],
    embedding_model: Any,
) -> list[Document]:
    sentences = _sentences_for_page(doc.page_content)
    if len(sentences) < 3:
        text = _group_text(sentences)
        if not text:
            return []
        metadata = dict(doc.metadata)
        if length_function(text) <= chunk_size:
            return [Document(page_content=text, metadata=metadata)]
        return _split_recursive(
            [Document(page_content=text, metadata=metadata)],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            min_chunk_chars=min_chunk_chars,
        )

    vectors = _embed_texts([sentence.text for sentence in sentences], embedding_model)
    distances = [
        _cosine_distance(vectors[index], vectors[index + 1])
        for index in range(len(vectors) - 1)
    ]
    threshold = max(
        _percentile(distances, settings.chunk_semantic_percentile),
        settings.chunk_semantic_min_distance,
    )
    boundaries = {index for index, value in enumerate(distances) if value >= threshold}

    groups = _group_sentences(sentences, boundaries)
    groups = _merge_small_groups(groups, sentences, distances, min_chunk_chars)

    chunks: list[Document] = []
    for start, end in groups:
        text = _group_text(sentences[start : end + 1])
        if not text:
            continue
        metadata = dict(doc.metadata)
        if length_function(text) > chunk_size:
            chunks.extend(
                _split_recursive(
                    [Document(page_content=text, metadata=metadata)],
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                    min_chunk_chars=0,
                )
            )
        else:
            chunks.append(Document(page_content=text, metadata=metadata))
    return chunks


def _sentences_for_page(text: str) -> list[_Sentence]:
    """Split one page into sentences, keeping paragraph numbers for joins."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    sentences: list[_Sentence] = []
    for paragraph_index, paragraph in enumerate(_PARAGRAPH_RE.split(normalized)):
        for segment in _paragraph_segments(paragraph):
            for sentence_text in _split_sentences(segment):
                sentences.append(_Sentence(sentence_text, paragraph_index))
    return sentences


def _paragraph_segments(paragraph: str) -> list[str]:
    """Join PDF line-wraps but keep bullet points as separate segments."""
    lines = [line.strip() for line in paragraph.splitlines() if line.strip()]
    segments: list[str] = []
    current: list[str] = []
    for line in lines:
        if _BULLET_LINE_RE.match(line):
            if current:
                segments.append(" ".join(current))
                current = []
            segments.append(line)
        else:
            current.append(line)
    if current:
        segments.append(" ".join(current))
    return segments


def _split_sentences(text: str) -> list[str]:
    protected = _ABBREVIATION_RE.sub(
        lambda match: match.group(0).replace(".", _PROTECTED_DOT), text
    )
    sentences: list[str] = []
    for part in _SENTENCE_BOUNDARY_RE.split(protected):
        sentence = part.replace(_PROTECTED_DOT, ".").strip()
        if not sentence:
            continue
        # A stray fragment ("Pricing" and the like) belongs to the sentence it
        # follows, unless it is the first thing in the segment.
        if sentences and len(sentence) < 15:
            sentences[-1] = f"{sentences[-1]} {sentence}"
        else:
            sentences.append(sentence)
    return sentences


def _embed_texts(texts: list[str], model: Any) -> list[list[float]]:
    batch_size = max(1, settings.embedding_batch_size)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        vectors.extend(model.embed_documents(texts[start : start + batch_size]))
    if len(vectors) != len(texts):
        raise ValueError(
            f"expected {len(texts)} sentence embeddings, got {len(vectors)}"
        )
    return vectors


def _cosine_distance(left: Sequence[float], right: Sequence[float]) -> float:
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right, strict=True):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm <= 0 or right_norm <= 0:
        return 1.0
    similarity = dot / math.sqrt(left_norm * right_norm)
    return 1.0 - max(-1.0, min(1.0, similarity))


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        return 0.0
    percentile = max(0.0, min(100.0, percentile))
    ordered = sorted(values)
    position = (len(ordered) - 1) * (percentile / 100)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[int(position)]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _group_sentences(
    sentences: Sequence[_Sentence], boundaries: set[int]
) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    start = 0
    for index in range(len(sentences) - 1):
        if index in boundaries:
            groups.append((start, index))
            start = index + 1
    groups.append((start, len(sentences) - 1))
    return groups


def _merge_small_groups(
    groups: list[tuple[int, int]],
    sentences: Sequence[_Sentence],
    distances: Sequence[float],
    min_chunk_chars: int,
) -> list[tuple[int, int]]:
    """Merge fragments instead of dropping them, keeping the tighter boundary."""
    while len(groups) > 1:
        small = next(
            (
                index
                for index, (start, end) in enumerate(groups)
                if len(_group_text(sentences[start : end + 1])) < min_chunk_chars
            ),
            None,
        )
        if small is None:
            break

        if small == 0:
            neighbor = 1
        elif small == len(groups) - 1:
            neighbor = small - 1
        else:
            left_gap = distances[groups[small - 1][1]]
            right_gap = distances[groups[small][1]]
            neighbor = small - 1 if left_gap <= right_gap else small + 1

        lower = min(small, neighbor)
        upper = max(small, neighbor)
        groups[lower : upper + 1] = [
            (groups[lower][0], groups[upper][1])
        ]
    return groups


def _group_text(sentences: Sequence[_Sentence]) -> str:
    parts: list[str] = []
    previous_paragraph: int | None = None
    for sentence in sentences:
        if previous_paragraph is not None:
            separator = "\n\n" if sentence.paragraph != previous_paragraph else " "
            parts.append(separator)
        parts.append(sentence.text)
        previous_paragraph = sentence.paragraph
    return "".join(parts)
