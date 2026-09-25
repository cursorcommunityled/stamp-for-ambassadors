/**
 * A section that stays shut until asked for. Built on `<details>` so it needs
 * no JavaScript and no client boundary: these wrap server-rendered forms.
 *
 * For the jobs done once, in the quiet week before the doors open. On the
 * night the page is read standing up, and a form nobody is going to touch is
 * one more thing to look past.
 */
export function Fold({
  title,
  hint,
  summary,
  open,
  children,
}: {
  title: string;
  /** Shown only once open: what needs reading before acting. */
  hint?: string;
  /** Shown while shut, so a row says something without being opened. */
  summary?: string;
  /** Start open. Shut sections stay shut until asked for. */
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="fold" open={open}>
      <summary>
        <span className="fold-title">{title}</span>
        <span className="fold-meta">
          {summary ? <span className="fold-summary">{summary}</span> : null}
          <span className="fold-mark" aria-hidden />
        </span>
      </summary>
      <div className="fold-body">
        {hint ? <p className="fold-hint">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}
