// The livery editor's manual: short pages, one per thing you can do.
import { useEffect, useState } from 'react';
import { MAX_LAYERS, MAX_LIVERIES, MAX_LOGOS } from '../../game/livery';
import { Button, C, DISPLAY, floatShadow, well } from '../../ui/kit';

type Page = { id: string; title: string; body: React.ReactNode };

const Keys = ({ rows }: { rows: [string, string][] }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '6px 14px', alignItems: 'baseline' }}>
    {rows.map(([k, what]) => (
      <div key={k} style={{ display: 'contents' }}>
        <span>
          {k.split(' + ').map((part, i) => (
            <span key={i}>
              {i > 0 && ' + '}
              <kbd style={{ display: 'inline-block', minWidth: 22, textAlign: 'center', padding: '1px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: well(), fontFamily: 'inherit', fontSize: 12, fontWeight: 650 }}>{part}</kbd>
            </span>
          ))}
        </span>
        <span>{what}</span>
      </div>
    ))}
  </div>
);

const Steps = ({ items }: { items: React.ReactNode[] }) => (
  <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ol>
);

const List = ({ items }: { items: React.ReactNode[] }) => (
  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ul>
);

const B = ({ children }: { children: React.ReactNode }) => <b style={{ fontWeight: 650 }}>{children}</b>;

const pages = (phone: boolean): Page[] => [
  {
    id: 'start',
    title: 'Quick start',
    body: (
      <>
        <p>A livery is the paint your aircraft wear. Four steps make one:</p>
        <Steps
          items={[
            <>
              <B>Pick a style.</B> {phone ? 'Open the Styles tab' : 'Press Styles at the top'}, choose two colours and tap a design. Or skip this and start from plain white.
            </>,
            <>
              <B>Colour the parts.</B> In <B>Parts</B>, tap the square next to Tail, Fuselage, Engines or Wingtips and choose a colour.
            </>,
            <>
              <B>Add your name and logo.</B> In <B>Layers</B>, press + Add for your airline name. In <B>Logos</B>, pick a logo, then tap the aircraft where it goes.
            </>,
            <>
              <B>Save.</B> Every aircraft you own is repainted. Undo is always there if a change looks wrong.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'parts',
    title: 'Parts',
    body: (
      <>
        <p>The aircraft has four parts you can paint: the tail, the fuselage, the engines and the wingtips.</p>
        <List
          items={[
            <>
              <B>The coloured square</B> paints the whole part in one colour.
            </>,
            <>
              <B>Draw</B> zooms in on the part. While it is on, everything you draw stays on that part, so a brush stroke on the tail can't spill onto the fuselage. Press <B>Done</B> or <B>Whole aircraft</B> to zoom back out.
            </>,
            <>
              <B>×</B> takes the part's colour off again.
            </>,
            <>
              <B>Neo mask</B> paints the dark mask round the cockpit windows of the A320neo family.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'tools',
    title: 'Tools',
    body: (
      <>
        <p>Pick a tool, then use it on the aircraft. The line under the picture says what the tool in hand does.</p>
        <Keys
          rows={[
            ['V', 'Move: tap something on the aircraft to pick it, drag to move it.'],
            ['H', 'Pan: drag to look around when zoomed in.'],
            ['B', 'Brush: draw freehand.'],
            ['E', 'Eraser: rub out brush strokes on the paint layer you picked.'],
            ['L', 'Line: drag for a straight line.'],
            ['G', 'Fill: tap a part to colour all of it.'],
            ['U', 'Shape: drag to draw a rectangle, circle, triangle, star or chevron.'],
            ['T', 'Text: tap where the words go, then type them in Layers.'],
            ['O', 'Logo: tap where the chosen logo goes.'],
          ]}
        />
        <p>
          The <B>Colour</B> square under the tools sets the colour for whatever you draw next. The settings for the tool in hand (brush size, shape, colour) are at the top of <B>Parts</B>.
        </p>
      </>
    ),
  },
  {
    id: 'layers',
    title: 'Layers',
    body: (
      <>
        <p>
          Everything on the aircraft is a layer: a colour, a stripe, your name, a logo, some brushwork. The list is in order, so the layer at the top is painted over the ones below it. A livery can have up to {MAX_LAYERS}.
        </p>
        <List
          items={[
            <>
              <B>Tap a layer</B> to pick it. Its settings (colour, size, place, angle, see-through) appear under the list.
            </>,
            <>
              <B>The dot</B> hides or shows a layer. <B>The padlock</B> locks it so it can't be moved or deleted by accident.
            </>,
            <>
              <B>Up and Down</B> change what is in front. <B>Duplicate</B> makes a copy. <B>Delete</B> removes it.
            </>,
            <>
              <B>+ Add</B> makes a new one: a fill, a band along the fuselage, a shape, text, your airline name, the registration, or an empty paint layer to draw on.
            </>,
          ]}
        />
        <p>Your airline name and the registration follow the airline and the aircraft: rename the airline and every aircraft shows the new name.</p>
      </>
    ),
  },
  {
    id: 'logos',
    title: 'Logos',
    body: (
      <>
        <List
          items={[
            <>
              <B>Ready-made logos</B> come in your two colours. Tap one to add it, then tap the aircraft to place it.
            </>,
            <>
              <B>Upload</B> takes a PNG, JPG or WebP picture. Big pictures are made smaller. <B>Fit</B> keeps the whole picture, <B>Fill square</B> crops it to a square, and <B>Take out a white background</B> makes white see-through.
            </>,
            <>
              <B>Use my airline logo</B> places the logo from Airline details.
            </>,
            <>A placed logo is a layer: pick it in Layers to resize or turn it.</>,
          ]}
        />
        <p>
          A livery keeps up to {MAX_LOGOS} logos. Only upload pictures you own or have the right to use.
        </p>
      </>
    ),
  },
  {
    id: 'types',
    title: 'One aircraft type',
    body: (
      <>
        <p>One livery is worn by every aircraft type, and the editor places things to suit each one. When a logo or your name still sits wrong on one type, fix it for that type alone:</p>
        <Steps
          items={[
            <>Open the aircraft menu at the top (it shows the type on screen) and choose the type.</>,
            <>
              Choose <B>Only the …</B> in the same menu.
            </>,
            <>Move, resize or recolour the layer. Only that type changes. New layers you add are only on that type too.</>,
            <>
              Switch back to <B>Every aircraft type</B> when you are done.
            </>,
          ]}
        />
        <p>
          With a layer picked, Layers also shows <B>Hide it on this type</B> and <B>Back to the shared placement</B>.
        </p>
      </>
    ),
  },
  {
    id: 'second',
    title: 'A second livery',
    body: (
      <>
        <p>
          You can keep {MAX_LIVERIES} liveries: your main one and a special one, for a retro scheme or a one-off.
        </p>
        <List
          items={[
            <>
              Open the livery menu at the top left and choose <B>+ Second livery</B>. It starts as a copy of the main one.
            </>,
            <>The same menu switches between them, renames them and deletes the second one.</>,
            <>Choose which aircraft wear the second livery in each aircraft's own window.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'view',
    title: 'Zoom and undo',
    body: phone ? (
      <List
        items={[
          <>
            <B>+ and −</B> on the picture zoom in and out. The number between them goes back to the whole aircraft.
          </>,
          <>
            Zoomed in, use the <B>Pan</B> tool to look around.
          </>,
          <>
            <B>↶ and ↷</B> at the top undo and redo, as far back as you like.
          </>,
          <>
            <B>×</B> closes without saving.
          </>,
        ]}
      />
    ) : (
      <Keys
        rows={[
          ['Ctrl/Cmd + scroll', 'Zoom in and out.'],
          ['+', 'Zoom in.'],
          ['−', 'Zoom out.'],
          ['0', 'Show the whole aircraft.'],
          ['[', 'Smaller brush.'],
          [']', 'Bigger brush.'],
          ['Ctrl/Cmd + Z', 'Undo.'],
          ['Ctrl/Cmd + Shift + Z', 'Redo.'],
          ['Delete', 'Delete the layer you picked.'],
          ['?', 'Open this manual.'],
          ['Esc', 'Close a menu, or the editor when nothing has changed.'],
        ]}
      />
    ),
  },
];

export function LiveryManual({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const all = pages(phone);
  const [at, setAt] = useState(all[0].id);
  const page = all.find((p) => p.id === at) ?? all[0];
  const i = all.indexOf(page);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const tabBtn = (p: Page): React.CSSProperties => ({
    textAlign: 'left',
    padding: phone ? '7px 12px' : '8px 12px',
    borderRadius: 9,
    border: 'none',
    background: p.id === at ? `${C.brand}22` : 'transparent',
    color: p.id === at ? C.brand : C.textSoft,
    fontWeight: p.id === at ? 650 : 500,
    fontSize: 13.5,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: 'none',
  });
  return (
    <div role="dialog" aria-modal="true" aria-label="Livery editor manual" onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,12,20,.5)', display: 'grid', placeItems: 'center', padding: phone ? 0 : 24 }}>
      <div style={{ width: phone ? '100%' : 'min(820px, 100%)', height: phone ? '100%' : 'min(600px, 100%)', display: 'flex', flexDirection: 'column', background: C.panel, color: C.text, borderRadius: phone ? 0 : 16, border: phone ? 'none' : `1px solid ${C.border}`, boxShadow: floatShadow(), overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: phone ? '10px 12px' : '14px 18px', borderBottom: `1px solid ${C.line}` }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: DISPLAY, fontSize: 22 }}>Livery manual</h2>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: phone ? 'column' : 'row' }}>
          <nav aria-label="Manual pages" style={{ display: 'flex', flexDirection: phone ? 'row' : 'column', gap: 2, padding: phone ? '8px 10px' : 12, overflowX: phone ? 'auto' : undefined, overflowY: phone ? undefined : 'auto', borderRight: phone ? 'none' : `1px solid ${C.line}`, borderBottom: phone ? `1px solid ${C.line}` : 'none', flex: 'none', width: phone ? undefined : 190, scrollbarWidth: 'none' }}>
            {all.map((p) => (
              <button key={p.id} type="button" aria-current={p.id === at ? 'page' : undefined} onClick={() => setAt(p.id)} style={tabBtn(p)}>
                {p.title}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="bp-manual" key={page.id} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: phone ? '14px 16px' : '18px 24px', fontSize: 14, lineHeight: 1.55, color: C.textSoft, display: 'grid', gap: 12, alignContent: 'start' }}>
              <h3 style={{ margin: 0, fontSize: 18, color: C.text }}>{page.title}</h3>
              {page.body}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: phone ? '10px 12px' : '12px 18px', borderTop: `1px solid ${C.line}` }}>
              <Button size="sm" disabled={i === 0} onClick={() => setAt(all[i - 1].id)}>
                Back
              </Button>
              {i < all.length - 1 ? (
                <Button size="sm" variant="primary" onClick={() => setAt(all[i + 1].id)}>
                  Next: {all[i + 1].title}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={onClose}>
                  Start painting
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
