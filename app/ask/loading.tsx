import { LoadingState } from "@/components/radar/ui/DataState";
import { RadarShell } from "@/components/radar/layout/RadarShell";

export default function AskLoading() {
  return (
    <RadarShell isMock={false}>
      <LoadingState title="Loading Ask AI Radar…" />
    </RadarShell>
  );
}
