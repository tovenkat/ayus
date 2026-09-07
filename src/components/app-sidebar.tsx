"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Upload, BookOpen, Search, MessageSquare,
  Tags, Settings, Stethoscope, Pill, UtensilsCrossed, FileText,
  ClipboardList, Siren, Network, Users, ClipboardCheck, Building2,
  BedDouble, ScrollText, ShieldCheck, ActivitySquare,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
// IMPORTANT: import from the -shared module, not @/lib/account-kind. This is
// a "use client" component; the server-only module pulls in Prisma → pg → dns
// which breaks the browser bundle.
import { ACCOUNT_KIND_LABEL, type AccountKind } from "@/lib/account-kind-shared";

// A nav entry with an optional `soon` flag — placeholder routes are shown in
// the sidebar so the plan structure is visible from day one, but they render
// as disabled with a "Soon" badge until the corresponding phase lands.
type NavItem = {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

// Common nav — every kind gets these.
const COMMON_MAIN: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];
const COMMON_BOTTOM: NavItem[] = [
  { title: "Settings", href: "/settings", icon: Settings },
];

// Kind-specific nav. Structure per kind:
//   Main + (kind's operational groups) + Common bottom.

const NAV_BY_KIND: Record<AccountKind, NavGroup[]> = {
  personal: [
    { label: "Main", items: [
      ...COMMON_MAIN,
      { title: "Upload",    href: "/upload", icon: Upload },
      { title: "Chat",      href: "/chat",   icon: MessageSquare },
      { title: "Search",    href: "/search", icon: Search },
    ] },
    { label: "Health", items: [
      { title: "Reports",         href: "/reports",      icon: FileText },
      { title: "Doctor Notes",    href: "/doctor-notes", icon: Stethoscope },
      { title: "Visit Prep",      href: "/prep",         icon: ClipboardList },
      { title: "Emergency Card",  href: "/emergency",    icon: Siren },
      { title: "Medications",     href: "/medications",  icon: Pill },
      { title: "Diet Schedule",   href: "/diet",         icon: UtensilsCrossed },
    ] },
    { label: "Notes & Docs", items: [
      { title: "Health Notes",  href: "/wiki",       icon: BookOpen },
      { title: "Graph View",    href: "/wiki/graph", icon: Network },
      { title: "Tags",          href: "/tags",       icon: Tags },
    ] },
    { label: "System", items: COMMON_BOTTOM },
  ],

  lab: [
    { label: "Main", items: [
      ...COMMON_MAIN,
      { title: "Upload", href: "/upload", icon: Upload },
      { title: "Search", href: "/search", icon: Search },
    ] },
    { label: "Patients", items: [
      { title: "Roster",       href: "/patients",       icon: Users,          /* live */ },
      { title: "Reports",      href: "/reports",        icon: FileText,       /* live */ },
      { title: "Needs Review", href: "/reports?status=NEEDS_REVIEW", icon: ClipboardCheck /* live */ },
    ] },
    { label: "Operations", items: [
      { title: "Volume",   href: "/analytics/volume",   icon: ActivitySquare, soon: true },
      { title: "Quality",  href: "/analytics/quality",  icon: ShieldCheck,    soon: true },
    ] },
    { label: "System", items: COMMON_BOTTOM },
  ],

  doctor: [
    { label: "Main", items: [
      ...COMMON_MAIN,
      { title: "Search", href: "/search", icon: Search },
    ] },
    { label: "Patients", items: [
      { title: "Roster",        href: "/patients",      icon: Users,        /* live */ },
      { title: "Consultations", href: "/consultations", icon: Stethoscope,  soon: true },
      { title: "Referrals",     href: "/referrals",     icon: ScrollText,   soon: true },
    ] },
    { label: "Clinical", items: [
      { title: "Prescriptions",     href: "/prescriptions",     icon: Pill,          soon: true },
      { title: "Decision Support",  href: "/decision-support",  icon: ClipboardCheck, soon: true },
    ] },
    { label: "System", items: COMMON_BOTTOM },
  ],

  hospital: [
    { label: "Main", items: [
      ...COMMON_MAIN,
      { title: "Search", href: "/search", icon: Search },
    ] },
    { label: "Patients", items: [
      { title: "Roster",        href: "/patients",      icon: Users,       /* live */ },
      { title: "Consultations", href: "/consultations", icon: Stethoscope, soon: true },
      { title: "Referrals",     href: "/referrals",     icon: ScrollText,  soon: true },
    ] },
    { label: "Clinical", items: [
      { title: "Prescriptions",     href: "/prescriptions",     icon: Pill,          soon: true },
      { title: "Decision Support",  href: "/decision-support",  icon: ClipboardCheck, soon: true },
    ] },
    { label: "Operations", items: [
      { title: "Departments", href: "/departments", icon: Building2, soon: true },
      { title: "Admissions",  href: "/admissions",  icon: BedDouble, soon: true },
      { title: "Team",        href: "/team",        icon: Users,     soon: true },
    ] },
    { label: "System", items: COMMON_BOTTOM },
  ],

  // Unknown accounts (e.g. ENTERPRISE, no membership) get the personal nav
  // as the safe default — they can still see their own data.
  unknown: [], // populated below via a spread
};

// Copy the personal nav for `unknown` — kept out of the literal above to
// avoid a self-reference at declaration time.
NAV_BY_KIND.unknown = NAV_BY_KIND.personal;

type Props = { kind: AccountKind };

export function AppSidebar({ kind }: Props) {
  const pathname = usePathname();
  const groups = NAV_BY_KIND[kind];

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton
        isActive={!item.soon && pathname.startsWith(item.href)}
        disabled={item.soon}
        render={item.soon ? undefined : <Link href={item.href} />}
        aria-disabled={item.soon}
        className={item.soon ? "opacity-50 cursor-not-allowed" : undefined}
      >
        <item.icon className="size-4" />
        <span>{item.title}</span>
        {item.soon && (
          <Badge variant="outline" className="ml-auto text-[9px] uppercase tracking-wider">Soon</Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-6 py-4">
        <Link href="/dashboard">
          <Logo size="sm" />
        </Link>
        {kind !== "personal" && kind !== "unknown" && (
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            {ACCOUNT_KIND_LABEL[kind]}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{g.items.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
