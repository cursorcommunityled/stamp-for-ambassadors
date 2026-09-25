import { cn } from "@/lib/utils";
import type { CatalogRow } from "@/lib/catalog";

export function ProjectCatalog({
  rows,
  closed,
}: {
  rows: CatalogRow[];
  closed: boolean;
}) {
  const tied =
    rows.filter((row) => row.place === 1).length > 1;

  return (
    <ul className="mt-8 border-y border-line">
      {rows.map((project, index) => {
        const won = closed && project.place === 1;
        return (
          <li
            key={project.id}
            className={cn("ballot", won && "is-winner")}
          >
            <p className="ballot-index">
              {closed && project.place !== null
                ? `#${project.place}`
                : String(index + 1).padStart(2, "0")}
            </p>
            <div className="min-w-0">
              <span className="ballot-label">
                <h2 className="ballot-name">{project.name}</h2>
                <span className="ballot-builders">{project.builders}</span>
                {won ? (
                  <span className="ballot-won">{tied ? "Tied" : "Winner"}</span>
                ) : null}
              </span>
              {project.description ? (
                <p className="ballot-blurb">{project.description}</p>
              ) : null}
            </div>
            {project.votes !== null ? (
              <div className="ballot-action">
                <span className="ballot-tally">
                  {project.votes} {project.votes === 1 ? "vote" : "votes"}
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
