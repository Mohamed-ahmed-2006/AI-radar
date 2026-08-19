"use client";

import { useCallback, useRef, useState } from "react";

import {
  optimizerHref,
  type OptimizerInput,
  type OptimizerReadModel,
} from "../../../lib/product/optimizer";
import { DemoNotice } from "../common/DemoNotice";
import { ErrorState, LoadingState } from "../../radar/ui/DataState";
import { OptimizerForm } from "./OptimizerForm";
import { OptimizerResults } from "./OptimizerResults";

type Status = "ready" | "loading" | "error";

interface OptimizerViewProps {
  initialInput: OptimizerInput;
  initialResult: OptimizerReadModel;
}

export function OptimizerView({
  initialInput,
  initialResult,
}: OptimizerViewProps) {
  const [draft, setDraft] = useState<OptimizerInput>(initialInput);
  const [result, setResult] = useState<OptimizerReadModel>(initialResult);
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const submit = useCallback((input: OptimizerInput) => {
    const href = optimizerHref(input);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(window.history.state, "", href);
    }

    const id = ++requestId.current;
    setStatus("loading");
    setError(null);

    const query = href.includes("?") ? href.slice(href.indexOf("?")) : "";
    fetch(`/api/optimizer${query}`, { signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        const payload = (await response.json()) as OptimizerReadModel & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "The optimizer could not be read.");
        }
        if (id !== requestId.current) return;
        setResult(payload);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setError(
          cause instanceof Error ? cause.message : "The optimizer could not be read.",
        );
        setStatus("error");
      });
  }, []);

  return (
    <div className="radar-surface-stack">
      {result.isDemo && (
        <DemoNotice title="Demonstration optimizer ranking">
          Estimated monthly cost, eligibility and rank are supplied by a
          replaceable adapter. This screen does not calculate them. Claude&apos;s
          deterministic optimizer can replace the fixture without a component
          redesign.
        </DemoNotice>
      )}

      <OptimizerForm
        input={draft}
        providerOptions={result.providerOptions}
        onChange={setDraft}
        onSubmit={() => submit(draft)}
        busy={status === "loading"}
      />

      {status === "loading" ? (
        <LoadingState title="Finding the best fit…" />
      ) : status === "error" ? (
        <ErrorState
          title="The optimizer could not be read"
          description={error ?? undefined}
        />
      ) : (
        <OptimizerResults result={result} />
      )}
    </div>
  );
}
