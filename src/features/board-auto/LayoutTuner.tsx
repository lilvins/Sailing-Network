import { useEffect, useState } from "react";
import { LAYOUT, LAYOUT_DEFAULTS, setLayout, useLayoutVersion, type LayoutKey } from "./layout";

/**
 * Dev-only sliders over the table (?layout=1): resize the pieces and watch them
 * move, then copy the values and paste them to whoever keeps the code.
 */
const SLIDERS: { key: LayoutKey; label: string; min: number; max: number; step: number }[] = [
  { key: "card", label: "Table cards", min: 80, max: 160, step: 2 },
  { key: "ownHand", label: "Your hand", min: 80, max: 190, step: 2 },
  { key: "topHand", label: "Top hand", min: 50, max: 150, step: 2 },
  { key: "don", label: "DON!! cards", min: 60, max: 130, step: 2 },
  { key: "donStep", label: "DON!! spacing", min: 8, max: 80, step: 2 },
  { key: "givenFan", label: "DON!! under a card", min: 6, max: 40, step: 1 },
  { key: "lifeStep", label: "Life spacing", min: 6, max: 50, step: 1 },
  { key: "gap", label: "Between cards", min: 0, max: 60, step: 2 },
  { key: "fieldMax", label: "Field width", min: 800, max: 1600, step: 10 },
];

export function LayoutTuner({ rotated }: { rotated: boolean }) {
  useLayoutVersion();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [overflow, setOverflow] = useState(0);

  // the height is the budget: say when the pieces no longer fit
  useEffect(() => {
    // the halves give way first, so the rows inside them are what spills
    const spill = (el: Element | null) => (el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0);
    setOverflow(Math.max(spill(document.querySelector(".ba-centercol")), spill(document.querySelector(".ba-halfmain"))));
  });

  const text = SLIDERS.map((s) => `${s.key}: ${LAYOUT[s.key]}`).join(", ");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Layout: ${text}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false); // no clipboard here: the values below can be selected by hand
    }
  };

  return (
    <div className={`ba-tuner${rotated ? " rot" : ""}`} data-layout-tuner>
      <button className="ba-tuner-toggle" onClick={() => setOpen(!open)}>{open ? "▾ Layout" : "▸ Layout"}</button>
      {open && (
        <>
          {SLIDERS.map((s) => (
            <label key={s.key} className="ba-tuner-row">
              <span>{s.label} <b>{LAYOUT[s.key]}</b></span>
              <input
                type="range"
                data-layout-key={s.key}
                min={s.min}
                max={s.max}
                step={s.step}
                value={LAYOUT[s.key]}
                onChange={(e) => setLayout({ [s.key]: Number(e.target.value) })}
              />
            </label>
          ))}
          {overflow > 0 && <p className="ba-tuner-warn">Too tall by {overflow}px: something gets cut off</p>}
          <div className="ba-tuner-actions">
            <button onClick={copy}>{copied ? "Copied" : "Copy values"}</button>
            <button onClick={() => setLayout({ ...LAYOUT_DEFAULTS })}>Reset</button>
          </div>
          <textarea className="ba-tuner-out" readOnly rows={3} value={text} onFocus={(e) => e.target.select()} />
        </>
      )}
    </div>
  );
}
