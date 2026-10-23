import { useState } from "react";
import { login, register } from "./api";
import posthog, { isPostHogConfigured } from "./posthog";

/** Sign in / sign up. Kept to email + password -- anything more is friction
 *  before someone has seen the product work. */
export default function AuthModal({ onClose, onAuthed, initialMode = "signin" }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signup = mode === "signup";

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = signup
        ? await register(email.trim(), password)
        : await login(email.trim(), password);
      onAuthed(user);
      if (isPostHogConfigured) {
        posthog.capture(signup ? "account_registered" : "user_signed_in");
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        <button className="editor-close auth-x" onClick={onClose} aria-label="Close">×</button>

        <h3>{signup ? "Create your account" : "Welcome back"}</h3>
        <p className="auth-sub">
          {signup
            ? "20 free credits to start — enough for 2 finished clips."
            : "Sign in to continue and keep this video in your KlipCut library."}
        </p>

        <form onSubmit={submit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={8}
              required
            />
            {signup && <small>At least 8 characters.</small>}
          </label>

          {error && <div className="editor-error">{error}</div>}

          <button className="btn btn-primary btn-block btn-sm" type="submit" disabled={busy}>
            {busy ? "Working…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {signup ? "Already have an account?" : "New here?"}{" "}
          <button type="button" onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); }}>
            {signup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
