// Lijniconen 24×24, lijn 2 px: leesbaar in de zon en op armlengte.
// Eigen set (geen pakket): weinig iconen, geen externe adressen (CSP).

const P: Record<string, string> = {
  camera: "M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  alert: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0",
  permit: "M6 3h9l4 4v14H6z M15 3v4h4 M9 12h7 M9 16h5",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  check: "M5 12.5 10 17.5 19 7",
  back: "M15 5 8 12l7 7",
  next: "M9 5l7 7-7 7",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12 M18 6 6 18",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14a6 6 0 0 1 3.5 6",
  hammer: "M14 4l6 6-3 3-6-6z M11 7 3 15l3 3 8-8",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  truck: "M2 6h12v10H2z M14 10h4l3 3v3h-7 M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  share: "M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7",
  pin: "M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z M6 11a6 6 0 0 0 12 0 M12 17v4",
  grid: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  calendar: "M4 6h16v15H4z M4 10h16 M8 3v5 M16 3v5",
  home: "M3 11 12 3l9 8 M5 9.5V21h14V9.5",
  list: "M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01",
  offline: "M2 2l20 20 M8.5 16.5a5 5 0 0 1 7 0 M5 12.5a10 10 0 0 1 4.5-2.6 M14.5 9.9A10 10 0 0 1 19 12.5 M12 20h.01",
  online: "M5 12.5a10 10 0 0 1 14 0 M8.5 16.5a5 5 0 0 1 7 0 M2 9a15 15 0 0 1 20 0 M12 20h.01",
  sync: "M20 11a8 8 0 0 0-14.5-4.5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.5 4.5L20 16 M20 20v-4h-4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z",
  edit: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  key: "M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H4V18l6.2-6.2A4 4 0 0 0 14 10z M15 7h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12l2-1-1-3-2.2.2-1.3-1.3L16.7 4.7 14 4l-1 2h-2L10 4l-2.7.7.2 2.2-1.3 1.3L4 8 3 11l2 1v0l-2 1 1 3 2.2-.2 1.3 1.3L7.3 19.3 10 20l1-2h2l1 2 2.7-.7-.2-2.2 1.3-1.3L20 16l1-3z",
  doc: "M6 3h9l4 4v14H6z M15 3v4h4 M9 12h7 M9 16h7",
  building: "M4 21V5l8-2v18 M12 9l8 2v10 M2 21h20 M7 8h2 M7 12h2 M7 16h2 M15 14h2 M15 17h2",
  logout: "M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  euro: "M17.5 6.5A7 7 0 1 0 17.5 17.5 M4 10.5h9 M4 13.5h9",
  /* statusvormen */
  "st-planned": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  "st-busy": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 4v16",
  "st-delayed": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4.5l3 1.5",
  "st-done": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M8.5 12.2l2.4 2.4 4.6-4.8",
  "st-blocked": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M6.4 6.4l11.2 11.2",
};

/** Half gevuld vlak voor "bezig": de enige vorm met een vulling. */
const FILL: Record<string, string> = { "st-busy": "M12 4a8 8 0 0 1 0 16z" };

export type IconName = keyof typeof P;

export function Icon({ name, size = 24, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="bw-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {FILL[name] && <path d={FILL[name]} fill="currentColor" stroke="none" />}
      <path d={P[name]} />
    </svg>
  );
}
