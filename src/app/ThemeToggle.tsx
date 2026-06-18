import { useState } from "react";
import { useUiStore } from "./uiStore";

/** Global dark/light switch, fixed top-right. Slides via [data-theme] in CSS. */
export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggle = useUiStore((s) => s.toggleTheme);
  const isLight = theme === "light";

  const [confirming, setConfirming] = useState(false);
  const [whatever, setWhatever] = useState(false);

  function handleClick() {
    if (isLight) {
      // going back to dark — no judgement needed
      toggle();
      return;
    }
    // about to switch to light mode — are you sure? it's very ugly
    setConfirming(true);
  }

  function confirmLight() {
    setConfirming(false);
    toggle();
    setWhatever(true);
    window.clearTimeout((window as unknown as { __whateverT?: number }).__whateverT);
    (window as unknown as { __whateverT?: number }).__whateverT = window.setTimeout(
      () => setWhatever(false),
      1800,
    );
  }

  return (
    <>
      <button
        className="theme-toggle"
        onClick={handleClick}
        title={isLight ? "Switch to dark mode" : "Switch to light mode"}
        aria-label="Toggle color theme"
        aria-pressed={isLight}
      >
        <span className="theme-toggle-knob">
          {isLight ? (
            // sun
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
            </svg>
          ) : (
            // moon
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z" />
            </svg>
          )}
        </span>
      </button>

      {confirming && (
        <div className="tt-overlay" onClick={() => setConfirming(false)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modal-title">Are you sure?</div>
            <p className="tt-modal-text">it's very ugly</p>
            <div className="tt-modal-actions">
              <button className="tt-cancel" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="tt-yes" onClick={confirmLight}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {whatever && <div className="tt-toast">whatever</div>}
    </>
  );
}
