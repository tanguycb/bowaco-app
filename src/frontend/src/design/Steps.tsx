/** Lang formulier = stappen met voortgangsbalk (§8.1 regel 4). Terug mag altijd, vooruit springen enkel naar bezochte stappen. */
export function Steps({ steps, current, visited, onGo }: { steps: string[]; current: number; visited?: number; onGo?: (i: number) => void }) {
  const max = Math.max(visited ?? current, current);
  return (
    <nav className="bw-steps" aria-label={`Stap ${current + 1} van ${steps.length}`}>
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
              <span className="bw-steps__t"><span className="bw-steps__n">{i + 1}</span>{s}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
