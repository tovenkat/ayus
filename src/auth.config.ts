import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        return token;
      }
      // Existing token: confirm the user still exists. Without this, a JWT
      // cookie that outlives the underlying User row passes auth locally
      // and then explodes on the first FK insert (P2003).
      if (token?.id) {
        const { prisma } = await import("@/lib/prisma");
        const exists = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { id: true },
        });
        if (!exists) return null;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = [
        "/dashboard",
        "/wiki",
        "/upload",
        "/chat",
        "/search",
        "/tags",
        "/collections",
        "/settings",
        "/reports",
        "/doctor-notes",
        "/medications",
        "/diet",
      ];
      const isProtected = protectedRoutes.some((route) =>
        nextUrl.pathname.startsWith(route)
      );

      if (isProtected && !isLoggedIn) {
        const loginUrl = new URL("/login", nextUrl.origin);
        loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
        return Response.redirect(loginUrl);
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
