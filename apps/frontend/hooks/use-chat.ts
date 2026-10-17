"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Message } from "@/components/chat-message";
import { reportError, toErrorMessage } from "@/lib/errors";
import type { DocumentSummary } from "@/lib/workspace-types";

type ErrorResponse = { detail?: string };

type HistoryResponse = {
  messages?: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  detail?: string;
};

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Upload one PDF to begin. Guest mode allows one document and three chat messages before login is required.",
  },
];

function documentIntroMessage(document: DocumentSummary): Message {
  return {
    id: `document-${document.documentId}`,
    role: "assistant",
    content: `Current document: "${document.fileName}". ${
      document.status === "ready"
        ? "You can ask questions now."
        : "Indexing is still in progress."
    }`,
  };
}

function parseSseBuffer(buffer: string) {
  const events = buffer.split("\n\n");
  const remainder = events.pop() ?? "";
  const parsed: Array<{ event: string; data: string }> = [];

  for (const raw of events) {
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trim();
      }
    }
    parsed.push({ event, data });
  }

  return { parsed, remainder };
}

type UseChatOptions = {
  document: DocumentSummary | null;
  onAfterSend?: () => void;
  onStreamUpdate?: () => void;
  onLimitReached?: () => void;
};

export function useChat({
  document,
  onAfterSend,
  onStreamUpdate,
  onLimitReached,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;

  const appendAssistant = useCallback((content: string) => {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "assistant", content },
    ]);
  }, []);

  useEffect(() => {
    const documentId = document?.documentId;

    if (!documentId) {
      setMessages(initialMessages);
      return;
    }

    let cancelled = false;

    async function load() {
      const activeDocument = documentRef.current;
      if (!activeDocument) {
        return;
      }

      try {
        const response = await fetch(
          `/api/documents/${documentId}/messages`,
          { cache: "no-store" }
        );
        const result = ((await response.json()) as HistoryResponse) ?? {};

        if (!response.ok || !Array.isArray(result.messages)) {
          throw new Error(result.detail ?? "Could not load messages.");
        }

        if (cancelled) {
          return;
        }

        const history: Message[] = result.messages
          .filter(
            (item) =>
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim()
          )
          .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
          }));

        setMessages(
          history.length > 0 ? history : [documentIntroMessage(activeDocument)]
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        reportError(error, { scope: "useChat.loadHistory", documentId });
        setMessages([documentIntroMessage(documentRef.current ?? activeDocument)]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [document?.documentId]);

  const persistAssistantReply = useCallback(
    async (documentId: string, content: string) => {
      if (!content.trim()) {
        return;
      }

      try {
        await fetch(`/api/documents/${documentId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content }),
        });
      } catch (error) {
        reportError(error, { scope: "useChat.persistAssistantReply" });
      }
    },
    []
  );

  const handleSend = useCallback(
    async (overridePrompt?: string) => {
      const activeDocument = document;
      const trimmed = (overridePrompt ?? prompt).trim();

      if (!activeDocument || !trimmed || isSending) {
        return;
      }

      const recentHistory = messages
        .filter((message) => message.id !== "welcome" && !message.error)
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));

      const assistantId = crypto.randomUUID();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setPrompt("");
      setIsSending(true);
      onStreamUpdate?.();

      let streamedChars = 0;
      let streamedAnswer = "";

      try {
        const response = await fetch("/api/documents/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: activeDocument.documentId,
            message: trimmed,
            history: recentHistory,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const result =
            ((await response.json().catch(() => null)) as ErrorResponse | null) ??
            {};
          throw new Error(result.detail ?? "Could not send the message.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let readerDone = false;

        while (!readerDone) {
          const { value, done } = await reader.read();
          readerDone = done;

          if (!value) {
            continue;
          }

          buffer += decoder.decode(value, { stream: true });
          const { parsed, remainder } = parseSseBuffer(buffer);
          buffer = remainder;

          for (const { event, data } of parsed) {
            if (event === "token" && data) {
              const { token } = JSON.parse(data) as { token: string };
              streamedChars += token.length;
              streamedAnswer += token;
              setMessages((current) =>
                current.map((item) =>
                  item.id === assistantId
                    ? { ...item, content: item.content + token }
                    : item
                )
              );
              onStreamUpdate?.();
            } else if (event === "error") {
              const { detail } = JSON.parse(data) as { detail?: string };
              throw new Error(detail ?? "Chat request failed.");
            }
          }
        }

        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId ? { ...item, streaming: false } : item
          )
        );
        await persistAssistantReply(activeDocument.documentId, streamedAnswer);
        onStreamUpdate?.();
        onAfterSend?.();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, streaming: false } : item
            )
          );
          await persistAssistantReply(activeDocument.documentId, streamedAnswer);
          return;
        }

        reportError(error, { scope: "useChat.handleSend" });
        const message = toErrorMessage(error, "Could not send the message.");

        if (streamedChars === 0) {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: message,
                    streaming: false,
                    error: true,
                    retryPrompt: trimmed,
                  }
                : item
            )
          );
        } else {
          setMessages((current) => [
            ...current.map((item) =>
              item.id === assistantId ? { ...item, streaming: false } : item
            ),
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: message,
              error: true,
              retryPrompt: trimmed,
            },
          ]);
        }

        if (/guest chats|log in|limit/i.test(message)) {
          onLimitReached?.();
        }
      } finally {
        setIsSending(false);
        abortRef.current = null;
      }
    },
    [
      document,
      isSending,
      messages,
      onAfterSend,
      onLimitReached,
      onStreamUpdate,
      persistAssistantReply,
      prompt,
    ]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    prompt,
    setPrompt,
    isSending,
    handleSend,
    handleStop,
    appendAssistant,
  };
}
