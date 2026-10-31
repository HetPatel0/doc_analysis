from __future__ import annotations

import itertools
import math
import re
from collections import Counter
from typing import Any

from app.schemas import ChatRequest

# Small, language-agnostic stopword list for lexical scoring. Keeping it local
# means retrieval has no extra dependency and the eval stays reproducible.
STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "being",
        "but",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "doing",
        "for",
        "from",
        "had",
        "has",
        "have",
        "having",
        "he",
        "her",
        "him",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "me",
        "my",
        "of",
        "on",
        "or",
        "our",
        "she",
        "should",
        "so",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "to",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
    ]
)
TOKEN_RE = re.compile(r"[a-z0-9]+")
FOLLOW_UP_PREFIXES = (
    "and ",
    "also ",
    "what about",
    "how about",
    "then ",
    "so ",
)
ANAPHORS = frozenset(
    {
        "it",
        "its",
        "that",
        "this",
        "they",
        "them",
        "their",
        "those",
        "these",
        "he",
        "she",
        "him",
        "her",
        "same",
        "above",
        "previous",
    }
)


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


def build_citations(docs: list[Any]) -> list[dict[str, Any]]:
    """Structured citation metadata for clickable page references."""
    citations: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None]] = set()

    for doc in docs:
        page_number = doc.metadata.get("page_number") or normalize_page_number(
            doc.metadata
        )
        chunk_index = doc.metadata.get("chunk_index")
        label = source_label(doc.metadata)
        key = (label, page_number)
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "label": label,
                "page": page_number,
                "chunk": chunk_index + 1 if isinstance(chunk_index, int) else None,
            }
        )

    return citations


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


def _stem(token: str) -> str:
    """Conservative suffix stripping so "refunds" matches "refund".

    A full stemmer would add a dependency for little gain on the short,
    vocabulary-heavy queries this app sees.
    """
    if len(token) <= 3:
        return token
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith(("sses", "shes", "ches", "xes", "zes")):
        return token[:-2]
    if token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    if token.endswith("ing") and len(token) > 5:
        return token[:-3]
    if token.endswith("ed") and len(token) > 4:
        return token[:-2]
    return token


def tokenize(text: str) -> list[str]:
    return [
        _stem(token)
        for token in TOKEN_RE.findall(text.lower())
        if len(token) > 1 and token not in STOPWORDS
    ]


def query_terms(query: str) -> set[str]:
    return set(tokenize(query))


class BM25:
    """Okapi BM25 over the fetched candidate set.

    The candidate pool is deliberately the unit of idf: this is a reranking
    signal over documents the dense retriever already considered, not a global
    index. Rarer terms inside that pool still get more weight, and term
    frequency saturates instead of counting raw hits like the old reranker.
    """

    def __init__(self, corpus: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.doc_freqs = [Counter(tokens) for tokens in corpus]
        self.doc_lengths = [len(tokens) for tokens in corpus]
        self.avg_length = (
            sum(self.doc_lengths) / len(self.doc_lengths) if corpus else 0.0
        )
        document_frequency: Counter[str] = Counter()
        for tokens in corpus:
            document_frequency.update(set(tokens))
        total = len(corpus)
        self.idf = {
            term: math.log(1 + (total - freq + 0.5) / (freq + 0.5))
            for term, freq in document_frequency.items()
        }

    def scores(self, query_tokens: list[str]) -> list[float]:
        if not self.doc_freqs:
            return []
        average = self.avg_length or 1.0
        scores: list[float] = []
        for freqs, length in zip(self.doc_freqs, self.doc_lengths, strict=True):
            score = 0.0
            for term in query_tokens:
                frequency = freqs.get(term, 0)
                if not frequency:
                    continue
                denominator = frequency + self.k1 * (
                    1 - self.b + self.b * length / average
                )
                score += self.idf.get(term, 0.0) * (
                    frequency * (self.k1 + 1) / denominator
                )
            scores.append(score)
        return scores


def _document_key(doc: Any) -> tuple[Any, ...]:
    metadata = doc.metadata or {}
    chunk_index = metadata.get("chunk_index")
    if isinstance(chunk_index, int):
        return (
            metadata.get("document_id"),
            metadata.get("page_number"),
            chunk_index,
        )
    return ("text", re.sub(r"\s+", " ", doc.page_content.strip().lower()))


def dedupe_documents(docs: list[Any]) -> list[Any]:
    """Drop duplicate chunks while keeping the best dense-ranked occurrence."""
    seen: set[tuple[Any, ...]] = set()
    unique: list[Any] = []
    for doc in docs:
        key = _document_key(doc)
        if key in seen:
            continue
        seen.add(key)
        unique.append(doc)
    return unique


def _phrase_score(content: str, query: str) -> float:
    content_tokens = tokenize(content)
    query_tokens = tokenize(query)
    if not content_tokens or not query_tokens:
        return 0.0
    content_text = " ".join(content_tokens)
    query_text = " ".join(query_tokens)
    if query_text in content_text:
        return 1.0
    if len(query_tokens) < 2:
        return 0.0
    bigrams = [
        f"{left} {right}" for left, right in itertools.pairwise(query_tokens)
    ]
    return sum(1 for bigram in bigrams if bigram in content_text) / len(bigrams)


def rerank_documents(
    docs: list[Any],
    query: str,
    limit: int,
    *,
    rrf_k: int = 60,
) -> list[Any]:
    """Fuse dense order with BM25 and rerank the result.

    Steps:
    1. Dedupe candidates (dense order is the tie-breaker).
    2. Score the deduped pool with BM25.
    3. Fuse dense rank and lexical rank with reciprocal rank fusion (RRF) so
       neither signal has to be min-max normalised.
    4. Rerank the fused pool with normalised BM25, dense-rank prior, query-term
       coverage and phrase/proximity evidence, then cut to ``limit``.

    This replaces the old "count matching terms" reranker, which ignored term
    rarity, term frequency saturation and word order.
    """
    if limit <= 0:
        return []
    if not docs:
        return []

    candidates = dedupe_documents(docs)
    corpus = [tokenize(doc.page_content) for doc in candidates]
    query_tokens = tokenize(query)
    unique_query_tokens = set(query_tokens)
    lexical_scores = BM25(corpus).scores(query_tokens)

    # Step 3: RRF over dense order + BM25 order (only positive BM25 scores).
    lexical_order = sorted(
        (index for index, score in enumerate(lexical_scores) if score > 0),
        key=lambda index: (-lexical_scores[index], index),
    )
    lexical_rank = {
        index: rank for rank, index in enumerate(lexical_order, start=1)
    }
    total = len(candidates)
    fused: list[tuple[float, int]] = []
    for index in range(total):
        dense_rank = index + 1
        score = 1.0 / (rrf_k + dense_rank)
        if index in lexical_rank:
            score += 1.0 / (rrf_k + lexical_rank[index])
        fused.append((score, index))

    # Step 4: rerank the fused pool.
    max_lexical = max(lexical_scores, default=0.0)
    max_fused = max((score for score, _ in fused), default=0.0) or 1.0
    reranked: list[tuple[float, int]] = []
    for fused_score, index in fused:
        doc = candidates[index]
        doc_tokens = set(corpus[index])
        coverage = (
            len(unique_query_tokens & doc_tokens) / len(unique_query_tokens)
            if unique_query_tokens
            else 0.0
        )
        normalised_lexical = lexical_scores[index] / max_lexical if max_lexical else 0.0
        dense_prior = 1.0 / (index + 1)
        score = (
            0.45 * normalised_lexical
            + 0.25 * (fused_score / max_fused)
            + 0.20 * coverage
            + 0.10 * _phrase_score(doc.page_content, query)
            + 0.05 * dense_prior
        )
        reranked.append((score, index))

    reranked.sort(key=lambda item: (-item[0], item[1]))
    return [candidates[index] for _, index in reranked[:limit]]


def _raw_tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def useful_history(history: list[dict[str, str]]) -> bool:
    """True when earlier user turns give the rewriter something to resolve."""
    return any(
        item.get("role") == "user" and len(tokenize(item.get("content", ""))) >= 2
        for item in history
    )


def is_concrete_question(message: str) -> bool:
    """Heuristic for "this question stands on its own".

    A concrete question has at least two content terms, does not open with a
    follow-up cue ("and ...", "what about ...") and does not refer back with a
    pronoun ("it", "that", "they", ...). With no useful history and a concrete
    question we skip the rewrite call: there is nothing to resolve and the
    deterministic query is already the question.
    """
    tokens = tokenize(message)
    if len(tokens) < 2:
        return False

    lowered = message.strip().lower()
    if any(lowered.startswith(prefix) for prefix in FOLLOW_UP_PREFIXES):
        return False

    raw = _raw_tokens(message)
    return not any(token in ANAPHORS for token in raw[:4])


def should_rewrite_query(request: ChatRequest) -> bool:
    if useful_history(request.history):
        return True
    return not is_concrete_question(request.message)


def with_source_footer(answer: Any, sources: list[str]) -> str:
    text = answer if isinstance(answer, str) else str(answer)
    if not sources or "I could not find the answer in the document." in text:
        return text
    if re.search(r"\[(p\.|document)", text, flags=re.IGNORECASE):
        return text
    return f"{text}\n\nSources: {', '.join(sources)}"
