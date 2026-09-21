import { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { groupCheckConfigured, isMemberOfAllowedGroup } from './group-access';

/**
 * Access control: allows individual emails, entire domains, AND Google Group
 * membership.
 *
 * ALLOWED_EMAILS: comma-separated list of specific emails
 *   e.g. oliviachen212@gmail.com,friend@gmail.com
 *
 * ALLOWED_DOMAINS: comma-separated list of email domains (without @)
 *   e.g. thejoyculturefoundation.org
 *
 * ALLOWED_GROUPS: comma-separated Google Group emails (requires
 *   GOOGLE_ADMIN_EMAIL + domain-wide delegation — see lib/group-access.ts)
 *   e.g. tjcf.teachers@thejoyculturefoundation.org
 *
 * If NONE is set, all Google sign-ins are allowed (dev mode).
 */
async function isEmailAllowed(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();

  const allowedEmails = process.env.ALLOWED_EMAILS;
  const allowedDomains = process.env.ALLOWED_DOMAINS;

  // If nothing is configured, allow all (dev mode)
  if (!allowedEmails && !allowedDomains && !groupCheckConfigured()) return true;

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

  // Check Google Group membership (async — hits the Admin Directory API)
  if (groupCheckConfigured() && (await isMemberOfAllowedGroup(normalizedEmail))) {
    return true;
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
      if (!(await isEmailAllowed(email))) {
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
