import { useMemo } from 'preact/hooks';
import type { FieldBox } from '../ink/types';
import type { GrauerPlatz, GrauesMehr } from '../lib/sperrenExcel';
import type { Rect } from '../pages/layouts';
import { cardStyle } from './cardStyle';

// Die abgestimmten Sperren aus dem Excel-Stand, grau in den freien Plätzen der Sperrenseite. Nur zum Ansehen: Die Ebene nimmt
// keinen Tipp an, und der Stift schreibt durch sie hindurch (siehe `.graue-sperren` in app.css). In die Datei der Seite kommt
// nichts davon, die Abendroutine liest es also nie. Fand eine Sperre keinen freien Platz mehr, steht oben rechts im Platz 3 „+1“.

type Props = { fields: readonly FieldBox[]; plaetze: readonly GrauerPlatz[]; mehr: readonly GrauesMehr[] };

/** Wo „+1“ steht: oben rechts im Feld des Platzes 3. */
const mehrRect = ([x, y, w]: Rect): Rect => [x + w - 30, y + 2, 26, 14];

export function GraueSperren({ fields, plaetze, mehr }: Props) {
  const rects = useMemo(() => new Map(fields.map((f) => [f.id, f.rect])), [fields]);
  if (plaetze.length === 0 && mehr.length === 0) return null;
  return (
    <div class="graue-sperren" aria-hidden="true">
      {plaetze.map(({ feld, text }) => {
        const rect = rects.get(feld);
        return (
          rect && (
            <span key={feld} class="grau" data-feld={feld} style={cardStyle(rect)}>
              {text}
            </span>
          )
        );
      })}
      {mehr.map(({ feld, anzahl }) => {
        const rect = rects.get(feld);
        return (
          rect && (
            <span key={feld} class="grau-mehr" data-feld={feld} style={cardStyle(mehrRect(rect))}>
              {`+${anzahl}`}
            </span>
          )
        );
      })}
    </div>
  );
}
