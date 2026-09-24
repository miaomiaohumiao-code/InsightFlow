import { InsightsPage } from "@/components/insights/insights-page";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <InsightsPage key={projectId} projectId={projectId} />;
}
