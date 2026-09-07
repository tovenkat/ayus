import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export async function requireAuth(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
}

type ApiAuthSuccess = { userId: string; error?: never };
type ApiAuthError = { userId?: never; error: NextResponse };
type ApiAuthResult = ApiAuthSuccess | ApiAuthError;

export async function requireApiAuth(): Promise<ApiAuthResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId: session.user.id };
}
