import { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

/**
 * Access control: allows individual emails AND entire domains.
 * 
 * ALLOWED_EMAILS: comma-separated list of specific emails
 *   e.g. oliviachen212@gmail.com,friend@gmail.com
 * 
 * ALLOWED_DOMAINS: comma-separated list of email domains (without @)
 *   e.g. thejoyculturefoundation.org
 * 
 * If NEITHER is set, all Google sign-ins are allowed (dev mode).
 */
function isEmailAllowed(email: string): boolean {
  const normalizedEmail = email.toLowerCase();

  const allowedEmails = process.env.ALLOWED_EMAILS;
  const allowedDomains = process.env.ALLOWED_DOMAINS;

  // If neither is configured, allow all (dev mode)
  if (!allowedEmails && !allowedDomains) return true;

  // Check individual emails
  if (allowedEmails) {
    const emails = allowedEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (emails.includes(normalizedEmail)) return true;
  }

  // Check domain
  if (allowedDomains) {
    const domains = allowedDomains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    const emailDomain = normalizedEmail.split('@')[1];
    if (emailDomain && domains.includes(emailDomain)) return true;
  }

  return false;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      if (!isEmailAllowed(email)) {
        return false; // Will redirect to signin page with ?error=AccessDenied
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
