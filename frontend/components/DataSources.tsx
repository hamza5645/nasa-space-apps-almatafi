"use client";

// X34: "Where the numbers come from": the three NASA FIRMS sources behind the explorer, and
// which months each one covers right now.

import Popover from "./Popover";

export const TIERS = (year: number) => [
  { id: "archive", name: "The archive, 2000 to last year", what: `FIRMS's yearly country files: science-quality ("standard") processing, with the fire type (vegetation, volcano, flare). MODIS since November 2000; VIIRS since 2012. This is what the calendar is built on through ${year - 1}.` },
  { id: "year", name: `This year, ${year}`, what: "FIRMS's area API (a free key): standard processing where it has caught up, then near-real-time data for the latest weeks (no fire type: known static sources are masked instead). The current month compares its days so far with the same days in past years." },
  { id: "live", name: "The last 7 days", what: "FIRMS's public 24-hour, 48-hour and 7-day CSV files (no key, refreshed hourly, near-real-time): the landing page's globe shows one such week. Too short to judge a month, so they feed the globe, not the record." },
];

export default function DataSources({ dataVersion }: { dataVersion?: string }) {
  const year = new Date().getUTCFullYear();
  const mock = !dataVersion || dataVersion.startsWith("mock");
  return (
    <Popover className="data-pop" align="end" label={<span className="pop-key">Data</span>} ariaLabel="Where the numbers come from">
      {() => (
        <div className="data-panel">
          <p className="menu-title">Where the numbers come from: NASA FIRMS, three ways</p>
          {TIERS(year).map((t) => (
            <div key={t.id} className={`data-tier ${t.id}`}>
              <i aria-hidden="true" />
              <div><strong>{t.name}</strong><span>{t.what}</span></div>
            </div>
          ))}
          <p className="data-note">
            {mock ? "This copy runs on mock data in the real FIRMS formats until the real download finishes on Nov 13. " : `Data version ${dataVersion}. `}
            Every number on screen is one of these three, cleaned the same way; the Method page says how.
          </p>
        </div>
      )}
    </Popover>
  );
}
