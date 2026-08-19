import { LoadingState } from "@/components/radar/ui/DataState";
import { RadarShell } from "@/components/radar/layout/RadarShell";

export default function OptimizerLoading() {
  return (
    <RadarShell isMock={false}>
      <LoadingState title="Loading optimizer…" />
    </RadarShell>
  );
}
