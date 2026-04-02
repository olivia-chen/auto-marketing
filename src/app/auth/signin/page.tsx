'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import Image from 'next/image';

function SignInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [isLoading, setIsLoading] = useState(false);

  let errorMessage = '';
  if (error === 'AccessDenied') {
    errorMessage = 'Access denied. Your email is not authorized to use this tool. Please contact your administrator.';
  } else if (error) {
    errorMessage = 'An error occurred during sign in. Please try again.';
  }

  const handleSignIn = async () => {
    setIsLoading(true);
    // Clear the error from URL so a fresh attempt works
    if (error) {
      router.replace('/auth/signin?callbackUrl=' + encodeURIComponent(callbackUrl));
    }
    // Use prompt: 'select_account' to force Google account picker
    // This ensures the user can choose a different account after being denied
    await signIn('google', { callbackUrl }, { prompt: 'select_account' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 via-white to-rose-50">
      <div className="w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8 space-y-6">
          {/* Logo & Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Image
                src="/tjcf-logo.png"
                alt="The Joy Culture Foundation"
                width={200}
                height={62}
                className="object-contain"
                priority
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Campaign Matrix</h1>
              <p className="text-sm text-slate-500 mt-1">
                Sign in with your organization account to continue
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <svg className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <span>{errorMessage}</span>
                  {error === 'AccessDenied' && (
                    <p className="mt-1 text-xs text-red-500">
                      Try signing in with a different account, or use your @thejoyculturefoundation.org email.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sign In Button */}
          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-medium transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <svg className="h-5 w-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            {isLoading ? 'Signing in...' : error ? 'Try a Different Account' : 'Sign in with Google'}
          </button>

          {/* Info */}
          <p className="text-xs text-center text-slate-400">
            Only authorized team members can access this tool.
            <br />
            Contact your administrator for access.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          © {new Date().getFullYear()} The Joy Culture Foundation
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 via-white to-rose-50">
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
