"use client";

// X27: "Alert me", a scratch version. FIRMS emails every new detection in an area; this shows
// the email Almatafi would send when the area's month turns unusual. It asks for no email
// address, stores nothing and sends nothing (backend/app/alerts.py).

import { useState } from "react";
import Popover from "./Popover";
import { api, ApiError, type AlertPreview } from "@/lib/api";
import { cloudsApply } from "@/lib/queries";
import { useSelection } from "@/lib/store";

const LEVELS = [["above_normal", "Above normal"], ["unusual_high", "Unusually high"]] as const;
type Level = (typeof LEVELS)[number][0];

export default function AlertMenu() {
  const s = useSelection();
  const [level, setLevel] = useState<Level>("above_normal");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.alertPreview({ aoi: s.aoi, name: s.aoiLabel, threshold: level,
                                          clouds: cloudsApply("harmonized", "detections", s.clouds) ? "correct" : "off" }));
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError ? e.message : "The preview failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover className="alert-pop" align="end" label={<><BellIcon /> Alert me</>} ariaLabel="Alert me when this area's month is unusual">
      {() => (
        <div className="alert-panel">
          <p className="menu-title">An email when {s.aoiLabel} has an unusual month</p>
          <p className="alert-why">
            NASA FIRMS emails every new detection. This would email you only when the month is out of the ordinary
            for this area, against 25 years of harmonized records.
          </p>
          <fieldset className="alert-level">
            <legend>Send it when the month is at least</legend>
            {LEVELS.map(([v, text]) => (
              <label key={v}>
                <input type="radio" name="alert-level" value={v} checked={level === v} onChange={() => setLevel(v)} /> {text}
              </label>
            ))}
          </fieldset>
          <button type="button" className="chip-btn alert-go" onClick={run} disabled={busy}>
            {busy ? "Checking this month…" : "Preview this month's alert"}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          {preview && (
            <div className="alert-preview" aria-live="polite">
              <p className={`alert-flag ${preview.triggered ? "on" : "off"}`}>
                {preview.triggered ? "This month would send an alert." : "No alert this month."}
              </p>
              {/* The backend escapes every value; the sandbox (no scripts, no same origin) is a second fence. */}
              <iframe title={`Alert email: ${preview.email.subject}`} sandbox="" srcDoc={preview.email.html} className="alert-mail" />
            </div>
          )}
          <p className="alert-demo">Demo: no email is sent and nothing is stored.</p>
        </div>
      )}
    </Popover>
  );
}

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" /><path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}
