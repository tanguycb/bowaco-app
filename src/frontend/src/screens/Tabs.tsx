// De tabbalk van Beheer en van de hubs (Offertes · Posten, Facturatie, Vergunningen & administratie, Mijn werf).
import type { Tab } from "../app/nav";

export function TabBar({ tabs, current, go, label }: { tabs: Tab[]; current: string; go: (to: string) => void; label: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav className="a-tabs" aria-label={label}>
      {tabs.map((x) => (
        <a key={x.key} href={`#/${x.to}`} className="a-tab" aria-current={x.key === current ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(x.to); }}>
          {x.label}
        </a>
      ))}
    </nav>
  );
}
