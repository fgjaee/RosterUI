import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { AppInput } from './ui';

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const email = username.includes('@') ? username : `${username}@rosterui.internal`;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Invalid username or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      {/* Background accent */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-fixed/30 via-background to-tertiary-fixed/20 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-on-primary shadow-lg mb-4">
            <span className="material-symbols-outlined text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              rule
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-background tracking-tight">
            Smart Roster Planner
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            Sign in to manage your schedule
          </p>
        </div>

        {/* Login card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-xl p-8">
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div>
              <label
                htmlFor="login-username"
                className="block font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider mb-2"
              >
                Username
              </label>
              <AppInput
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                className="h-12 px-4 text-body-md rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block font-label-bold text-label-bold text-on-surface-variant uppercase tracking-wider mb-2"
              >
                Password
              </label>
              <AppInput
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-12 px-4 text-body-md rounded-lg"
              />
            </div>

            {error && (
              <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg font-body-sm text-body-sm text-center flex items-center justify-center gap-2 border border-error/20">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {error}
              </div>
            )}

            {/* Submit — intentionally a raw button so it can be type="submit" */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full h-12 bg-primary text-on-primary font-label-bold text-label-bold uppercase tracking-wider rounded-lg hover:opacity-90 transition-all active:scale-[0.98] duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary"></div>
                  Signing in...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">login</span>
                  Sign In
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center font-body-sm text-body-sm text-outline mt-6">
          Secure access for authorized personnel only
        </p>
      </div>
    </div>
  );
}
