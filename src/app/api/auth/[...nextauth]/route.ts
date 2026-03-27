import NextAuth from "next-auth";
import type { NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "authentik",
      name: "Authentik",
      type: "oauth",
      wellKnown:
        process.env.AUTHENTIK_ISSUER
          ? `${process.env.AUTHENTIK_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`
          : "https://auth.presshome.net/application/o/pedquest/.well-known/openid-configuration",
      clientId: process.env.AUTHENTIK_CLIENT_ID,
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
      idToken: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username,
          email: profile.email,
          image: profile.picture ?? null,
        };
      },
    },
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as Record<string, unknown>;
        token.email = p.email as string;
        token.name = (p.name || p.preferred_username) as string;
        token.picture = (p.picture as string) ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? null;
        session.user.name = token.name ?? null;
        session.user.image = (token.picture as string) ?? null;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
