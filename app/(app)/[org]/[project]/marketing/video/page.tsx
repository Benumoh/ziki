import type { Metadata } from "next";
import { VideoStudio } from "@/components/marketing/video/video-studio";
import { requireProject } from "@/lib/project-route";

export const metadata: Metadata = { title: "Create a video" };

export default async function CreateVideoPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project } = await params;
  const context = await requireProject(org, project);

  return (
    <VideoStudio slug={context.project.ref} projectName={context.project.name} />
  );
}
