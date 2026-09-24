import { ProjectEditor } from "@/components/project-editor";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectEditor key={projectId} projectId={projectId} />;
}
