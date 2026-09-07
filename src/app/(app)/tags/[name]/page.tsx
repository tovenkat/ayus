import { redirect } from "next/navigation";

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  // Redirect to wiki filtered by tag
  redirect(`/wiki?tag=${encodeURIComponent(name)}`);
}
