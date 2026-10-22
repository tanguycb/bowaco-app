/** Lang formulier = stappen met voortgangsbalk (§8.1 regel 4). Terug mag altijd, vooruit springen enkel naar bezochte stappen. */
export function Steps({ steps, current, visited, onGo }: { steps: string[]; current: number; visited?: number; onGo?: (i: number) => void }) {
  const max = Math.max(visited ?? current, current);
  return (
    <nav className="bw-steps" aria-label="Stappen">
      <div className="bw-steps__bar" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current + 1}>
        <div className="bw-steps__fill" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
      <ol className="bw-steps__list" style={{ ["--n" as string]: steps.length }}>
        {steps.map((s, i) => (
          <li key={s} className={`bw-steps__item${i === current ? " bw-steps__item--now" : i < current ? " bw-steps__item--done" : ""}`}>
            <button
              type="button"
              className="bw-steps__btn"
              disabled={!onGo || i > max || i === current}
              aria-current={i === current ? "step" : undefined}
              onClick={() => onGo?.(i)}
            >
              <span className="bw-steps__n">{i < current ? "✓" : i + 1}/{steps.length}</span>
              <span className="bw-steps__t">{s}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
