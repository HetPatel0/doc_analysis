from __future__ import annotations

from app.services import chunking
from langchain_core.documents import Document


class StaticEmbeddings:
    """Return a fixed vector per sentence text, in call order."""

    def __init__(self, mapping: dict[str, list[float]]):
        self.mapping = mapping

    def embed_documents(self, texts):
        return [self.mapping[text] for text in texts]


class ExplodingEmbeddings:
    def embed_documents(self, texts):
        raise RuntimeError("embedding provider is down")


class FakeSplitter:
    """Deterministic stand-in for RecursiveCharacterTextSplitter."""

    window = 50

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    @classmethod
    def from_tiktoken_encoder(cls, **kwargs):
        return cls(**kwargs)

    def split_documents(self, docs):
        chunks = []
        for source in docs:
            text = source.page_content
            for start in range(0, len(text), self.window):
                part = text[start : start + self.window]
                if part.strip():
                    chunks.append(
                        Document(page_content=part, metadata=dict(source.metadata))
                    )
        return chunks


def page(*sentences: str) -> Document:
    return Document(
        page_content=" ".join(sentences),
        metadata={"page": 0, "file_name": "nimbus.pdf"},
    )


PRICING_SENTENCES = (
    "The Starter plan costs 9 USD per month.",
    "It includes 5 gigabytes of storage.",
    "The Team plan costs 29 USD per user.",
)
REFUND_SENTENCES = (
    "Refunds are issued within 14 days of purchase.",
    "Refund requests need an order number.",
    "Refunds return to the original card.",
)


def test_sentence_split_keeps_abbreviations_and_decimals():
    assert chunking._split_sentences(
        "Wren Labs Inc. employs 42 people. It costs 9 USD."
    ) == [
        "Wren Labs Inc. employs 42 people.",
        "It costs 9 USD.",
    ]
    assert chunking._split_sentences(
        "The plan costs 3.5 USD. Storage is 5 GB."
    ) == [
        "The plan costs 3.5 USD.",
        "Storage is 5 GB.",
    ]
    assert chunking._split_sentences(
        "Use a key, e.g. the personal one. It never expires."
    ) == [
        "Use a key, e.g. the personal one.",
        "It never expires.",
    ]


def test_bullet_points_stay_separate_sentences():
    sentences = chunking._sentences_for_page(
        "Plans:\n- Starter costs 9 USD\n- Team costs 29 USD\n\nRefunds: 14 days."
    )

    assert [sentence.text for sentence in sentences] == [
        "Plans:",
        "- Starter costs 9 USD",
        "- Team costs 29 USD",
        "Refunds: 14 days.",
    ]
    assert [sentence.paragraph for sentence in sentences] == [0, 0, 0, 1]


def test_semantic_split_breaks_at_topic_shift():
    embeddings = StaticEmbeddings(
        {
            **{text: [1.0, 0.0, 0.0] for text in PRICING_SENTENCES},
            **{text: [0.0, 1.0, 0.0] for text in REFUND_SENTENCES},
        }
    )
    doc = page(*PRICING_SENTENCES, *REFUND_SENTENCES)

    chunks = chunking.split_documents(
        [doc],
        strategy="semantic",
        chunk_size=200,
        min_chunk_chars=10,
        length_function=lambda text: len(text.split()),
        embedding_model=embeddings,
    )

    assert len(chunks) == 2
    assert "Starter plan" in chunks[0].page_content
    assert "Refunds" in chunks[1].page_content
    assert chunks[0].metadata["page"] == 0
    assert chunks[1].metadata["page"] == 0


def test_semantic_keeps_uniform_text_together():
    sentences = PRICING_SENTENCES + REFUND_SENTENCES
    embeddings = StaticEmbeddings({text: [1.0, 0.0, 0.0] for text in sentences})

    chunks = chunking.split_documents(
        [page(*sentences)],
        strategy="semantic",
        chunk_size=200,
        min_chunk_chars=10,
        length_function=lambda text: len(text.split()),
        embedding_model=embeddings,
    )

    assert len(chunks) == 1
    assert "Refunds" in chunks[0].page_content


def test_semantic_never_crosses_a_page_boundary():
    first = page(*PRICING_SENTENCES)
    second = Document(
        page_content=" ".join(REFUND_SENTENCES),
        metadata={"page": 1, "file_name": "nimbus.pdf"},
    )
    embeddings = StaticEmbeddings(
        {text: [1.0, 0.0, 0.0] for text in PRICING_SENTENCES + REFUND_SENTENCES}
    )

    chunks = chunking.split_documents(
        [first, second],
        strategy="semantic",
        chunk_size=200,
        min_chunk_chars=10,
        length_function=lambda text: len(text.split()),
        embedding_model=embeddings,
    )

    assert len(chunks) == 2
    assert chunks[0].metadata["page"] == 0
    assert chunks[1].metadata["page"] == 1
    assert "Refunds" not in chunks[0].page_content


def test_semantic_falls_back_to_recursive_when_embeddings_fail(monkeypatch):
    monkeypatch.setattr(
        chunking.deps, "get_indexing_dependencies", lambda: (object, FakeSplitter)
    )

    chunks = chunking.split_documents(
        [page(*PRICING_SENTENCES)],
        strategy="semantic",
        chunk_size=200,
        min_chunk_chars=10,
        length_function=lambda text: len(text.split()),
        embedding_model=ExplodingEmbeddings(),
    )

    assert chunks
    assert all(chunk.metadata["page"] == 0 for chunk in chunks)


def test_semantic_keeps_a_short_page_without_embedding_it():
    chunks = chunking.split_documents(
        [page("A short note.")],
        strategy="semantic",
        min_chunk_chars=80,
        length_function=lambda text: len(text.split()),
        embedding_model=ExplodingEmbeddings(),
    )

    assert len(chunks) == 1
    assert chunks[0].page_content == "A short note."


def test_semantic_merges_short_groups_instead_of_dropping_them():
    embeddings = StaticEmbeddings(
        {
            "Hi.": [1.0, 0.0, 0.0],
            "The Starter plan costs 9 USD per month.": [0.0, 1.0, 0.0],
            "Refunds are issued within 14 days.": [0.0, 1.0, 0.0],
        }
    )

    chunks = chunking.split_documents(
        [
            page(
                "Hi.",
                "The Starter plan costs 9 USD per month.",
                "Refunds are issued within 14 days.",
            )
        ],
        strategy="semantic",
        chunk_size=200,
        min_chunk_chars=20,
        length_function=lambda text: len(text.split()),
        embedding_model=embeddings,
    )

    assert len(chunks) == 1
    assert "Hi." in chunks[0].page_content
    assert "refunds" in chunks[0].page_content.lower()


def test_semantic_hard_splits_oversized_groups():
    sentences = PRICING_SENTENCES + REFUND_SENTENCES
    embeddings = StaticEmbeddings({text: [1.0, 0.0, 0.0] for text in sentences})

    chunks = chunking.split_documents(
        [page(*sentences)],
        strategy="semantic",
        chunk_size=8,
        chunk_overlap=0,
        min_chunk_chars=1,
        embedding_model=embeddings,
    )

    assert len(chunks) > 1
    assert all(chunking._token_length(chunk.page_content) <= 8 for chunk in chunks)
    assert "".join(chunk.page_content for chunk in chunks).count("Refund") == 3


def test_unknown_strategy_falls_back_to_recursive(monkeypatch):
    calls = []
    monkeypatch.setattr(
        chunking,
        "_split_recursive",
        lambda docs, **kwargs: calls.append(kwargs) or [],
    )

    assert chunking.split_documents([page(*PRICING_SENTENCES)], strategy="nope") == []
    assert calls
