"use client";

import { useCallback, useRef, useState } from "react";

import {
  askHref,
  emptyAskReadModel,
  type AskReadModel,
} from "../../../lib/product/ask";
import { DemoNotice } from "../common/DemoNotice";
import { ErrorState } from "../../radar/ui/DataState";
import { AskExamples, AskForm, AskGroundingPresets } from "./AskForm";
import { AskResult } from "./AskResult";

type Status = "ready" | "loading" | "error";

interface AskViewProps {
  initialQuery: string;
  initialResult: AskReadModel | null;
}

export function AskView({ initialQuery, initialResult }: AskViewProps) {
  const [draft, setDraft] = useState(initialQuery);
  const [result, setResult] = useState<AskReadModel | null>(initialResult);
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const submit = useCallback((query: string) => {
    const trimmed = query.trim();
    const href = askHref(trimmed);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(window.history.state, "", href);
    }

    if (!trimmed) {
      setResult(null);
      setStatus("ready");
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setStatus("loading");
    setError(null);

    fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as AskReadModel & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Ask AI Radar could not be read.");
        }
        if (id !== requestId.current) return;
        setResult(payload);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setError(
          cause instanceof Error ? cause.message : "Ask AI Radar could not be read.",
        );
        setStatus("error");
      });
  }, []);

  const showDemo = result?.isDemo === true;

  return (
    <div className="radar-ask-split">
      <div>
      {status === "loading" ? (
        <div className="radar-ask-reasoning" role="status" aria-live="polite" aria-busy="true">
          <span className="radar-spinner" aria-hidden="true" />
          Reading trusted evidence… assembling observed records, not a chain of thought.
        </div>
      ) : status === "error" ? (
        <ErrorState
          title="Ask AI Radar could not be read"
          description={error ?? undefined}
        />
      ) : (
        <AskResult result={result ?? emptyAskReadModel()} />
      )}
      </div>

      <div className="radar-ask-composer radar-surface-stack">
      {showDemo && (
        <DemoNotice title="Demonstration grounded answers">
          Example questions are answered from a replaceable fixture adapter.
          Claude&apos;s grounded natural-language backend can replace it without a
          component redesign. Answers are never invented from model memory.
        </DemoNotice>
      )}

      <AskForm
        query={draft}
        onChange={setDraft}
        onSubmit={() => submit(draft)}
        busy={status === "loading"}
      />

      <AskGroundingPresets
        onSelect={(query) => {
          setDraft(query);
          submit(query);
        }}
      />

      <AskExamples
        onSelect={(query) => {
          setDraft(query);
          submit(query);
        }}
      />
      </div>
    </div>
  );
}
