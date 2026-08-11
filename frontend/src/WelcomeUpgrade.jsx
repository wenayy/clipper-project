import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

const UNLOCKED = {
  multilingual: "Captions for speech that switches language mid-sentence",
  gameplay: "Gameplay split-screen layout",
  tighten_pauses: "Automatic dead-air removal",
  caption_editing: "Full caption editing — words, style, colour, position",
  branding: "Your own logo and handle on every clip",
  no_watermark: "No KlipCut watermark",
  share_pages: "Public share pages for any clip",
  priority: "Priority rendering",
};

export function PaymentProcessing({ status, user, onClose, onStart }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    if (status !== "processing") return;
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(id);
  }, [status]);

  if (!status) return null;

  const isSuccess = status === "success" && user;
  const isFailed = status === "failed";

  const planName = isSuccess
    ? (user.plan || "creator").replace(/^./, (c) => c.toUpperCase())
    : "";
  const credits = isSuccess ? (user.credits ?? 0) : 0;
  const clips = Math.floor(credits / 10);
  const perks = isSuccess
    ? (user.entitlements || []).map((k) => UNLOCKED[k]).filter(Boolean)
    : [];

  return createPortal(
    <div className="upgrade-veil" data-testid="payment-processing">
      <div
        className={`upgrade-card welcome-card${isSuccess ? " welcome-success" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        {isSuccess && (
          <button className="upgrade-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        {status === "processing" && (
          <>
            <div className="payment-spinner" />
            <h3 id="welcome-title">Setting up your account{dots}</h3>
            <p className="upgrade-sub">
              Confirming payment and adding your credits. This takes just a
              moment.
            </p>
          </>
        )}

        {isSuccess && (
          <>
            <span className="upgrade-eyebrow">Payment confirmed</span>
            <h3 id="welcome-title">
              Welcome to {planName}! 🎉
            </h3>
            <p className="welcome-balance">
              <strong>{credits.toLocaleString()}</strong> credits
              <span> — about {clips.toLocaleString()} finished clips</span>
            </p>
            {perks.length > 0 && (
              <>
                <p className="upgrade-sub">Now unlocked for you:</p>
                <ul className="welcome-perks">
                  {perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="upgrade-actions">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Later
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onClose?.();
                  onStart?.();
                }}
              >
                Start creating →
              </button>
            </div>
          </>
        )}

        {isFailed && (
          <>
            <h3 id="welcome-title">Almost there</h3>
            <p className="upgrade-sub">
              Your payment went through but your account is still updating.
              This usually resolves in a few seconds.
            </p>
            <div className="upgrade-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => window.location.reload()}
              >
                Refresh now
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function WelcomeUpgrade({ user, onClose, onStart }) {
  return (
    <PaymentProcessing
      status="success"
      user={user}
      onClose={onClose}
      onStart={onStart}
    />
  );
}
