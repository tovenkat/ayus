import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { ChatFab } from "@/components/chat/chat-fab";
import { AiDisclaimer } from "@/components/ui/ai-disclaimer";
import { auth } from "@/auth";
import { getAccountKind, type AccountKind } from "@/lib/account-kind";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Resolve the current user's account kind once for the whole app shell —
  // sidebar + (later) topbar / chat all consume it. Signed-out visitors get
  // 'unknown', which the sidebar treats as personal.
  const session = await auth();
  const kind: AccountKind = session?.user?.id
    ? await getAccountKind(session.user.id)
    : "unknown";

  return (
    <SidebarProvider>
      <AppSidebar kind={kind} />
      <SidebarInset>
        <AppTopbar />
        <main className="flex-1 p-6">
          {children}
          {/* App-wide AI + medical disclaimer — visible on every page. */}
          <AiDisclaimer variant="footer" />
        </main>
      </SidebarInset>
      <ChatFab />
    </SidebarProvider>
  );
}
