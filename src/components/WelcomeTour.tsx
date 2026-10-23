// ============================================================================
// WELCOME TOUR (v2.38+)
//
// Shown when a new career starts (and from the main menu): a few cards that
// point at the parts of the screen and explain how to play. Skip any time.
// ============================================================================
import { useEffect, useLayoutEffect, useState } from 'react';
import { useLayout } from '../ui/layout';
import { Icon } from '../ui/icons';
import { Button, C, DISPLAY, glass } from '../ui/kit';

interface Step {
  title: string;
  body: string[];
  /** [data-tour] of the thing to point at; none = a card in the middle. */
  target?: string;
  careerOnly?: boolean;
}

function steps(p: { airlineName: string; hubIata: string; sandbox: boolean }): Step[] {
  const all: Step[] = [
    {
      title: `Welcome to ${p.airlineName}`,
      body: [
        `You run a new airline from ${p.hubIata}. Buy aircraft, plan routes to the world's real airports and grow into a global network.`,
        'This tour takes about a minute. You can skip it, and replay it from Menu.',
      ],
    },
    {
      title: 'The map is live',
      body: [
        'The other aircraft are the real airlines flying today’s routes, in real time. Yours are drawn in your colour.',
        'Drag to move, scroll or use + and − to zoom. Click an aircraft for its flight; click an airport to plan a route there.',
      ],
    },
    {
      title: 'Your money',
      target: 'topbar',
      body: p.sandbox
        ? ['Sandbox: money is unlimited, so build whatever you like. The economy clock runs one game week per real day.']
        : [
            'Cash, profit this week and cash flow. The economy runs one game week per real day, and keeps running while the game is closed.',
            'The clock beside them pauses the economy if you want to plan without it running.',
          ],
    },
    {
      title: '1. Get an aircraft',
      target: 'buy',
      body: [
        'Buy has two tabs: Aircraft, and Airports & hubs. Buy or lease aircraft there. Leasing costs only a deposit up front; choose how long the lease runs (longer is cheaper a day). You can return it early for part of the deposit, or buy it out later.',
        'Set How many to get several at once.',
      ],
    },
    {
      title: '2. Plan a route',
      body: [
        'Tap the airport you fly from (your hub), then the airport to fly to. The planner opens with an aircraft, a round trip and a time. The demand box shows how many people travel the route each day and who flies it today.',
        'Fares start at the market price. Charge much more and fewer people buy; at three times the market price nobody does.',
      ],
    },
    {
      title: '3. My Airline',
      target: 'my-airline',
      body: [
        'Overview, Fleet and Schedule, as tabs. Fleet lists every aircraft with how busy it is: tick several to sell, refit cabins, replace them with another type (their flights carry over) or schedule them together on one route.',
        'Schedule shows every flight by hub or by aircraft. Your airline\u2019s badge in the top corner opens My Airline too.',
      ],
    },
    {
      title: 'The bank',
      target: 'bank',
      careerOnly: true,
      body: [
        'Northgate Aviation Bank lends money and pays grants for milestones (your first routes, more aircraft, new continents…). Letters arrive here.',
        'Two weeks in a row overdrawn and the bank steps in.',
      ],
    },
    {
      title: 'The map, your way',
      target: 'layers',
      body: ['Map layers: map style, 3D aircraft, weather, how much other traffic to show, and Appearance for the game’s colours.'],
    },
    {
      title: 'Saving',
      target: 'menu',
      body: ['Your career saves itself every minute. Menu exports a save file, replays this tour, or takes you back to the home screen.', 'Good luck, captain.'],
    },
  ];
  return all.filter((s) => !(s.careerOnly && p.sandbox));
}

type Rect = { left: number; top: number; width: number; height: number };

function useTargetRect(target: string | undefined, tick: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((e) => e.offsetParent !== null);
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [target, tick]);
  return rect;
}

/** Set when the player ticks "Don't show this on new careers". */
export const TOUR_OFF_KEY = 'bp_pc_tour_off_v1';
export function tourWantedForNewCareer(): boolean {
  try {
    return localStorage.getItem(TOUR_OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

export function WelcomeTour(props: { airlineName: string; hubIata: string; sandbox: boolean; onClose: (finished: boolean) => void; onOpenBuy?: () => void }) {
  const list = steps(props);
  const [i, setI] = useState(0);
  const step = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;
  const rect = useTargetRect(step.target, i);
  const phone = useLayout() === 'phone';
  const [off, setOff] = useState(() => !tourWantedForNewCareer());
  const toggleOff = (v: boolean) => {
    setOff(v);
    try {
      if (v) localStorage.setItem(TOUR_OFF_KEY, '1');
      else localStorage.removeItem(TOUR_OFF_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose(false);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') last ? props.onClose(true) : setI((v) => v + 1);
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The card goes beside what it points at: above things in the bottom half, below things at the top
  const W = Math.min(400, window.innerWidth - 24);
  const pad = 8;
  let cardStyle: React.CSSProperties;
  if (!rect) cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  else {
    const cx = Math.min(window.innerWidth - W - 12, Math.max(12, rect.left + rect.width / 2 - W / 2));
    cardStyle =
      rect.top > window.innerHeight / 2
        ? { left: phone ? 12 : cx, bottom: window.innerHeight - rect.top + pad + 10 }
        : { left: phone ? 12 : cx, top: rect.top + rect.height + pad + 10 };
    if (phone) cardStyle = { ...cardStyle, right: 12 };
  }

  return (
    <div className="bp-tour" role="dialog" aria-modal="true" aria-label="Welcome tour" style={{ position: 'fixed', inset: 0, zIndex: 400 }}>
      {/* Dim everything except the thing being explained */}
      {rect ? (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 14,
            boxShadow: `0 0 0 3px ${C.brand}, 0 0 0 9999px rgba(4,7,13,.62)`,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'rgba(4,7,13,.62)' }} />
      )}
      <div
        style={{
          ...glass('f2'),
          position: 'fixed',
          width: phone ? undefined : W,
          maxHeight: 'calc(100dvh - 24px)',
          overflowY: 'auto',
          padding: '16px 18px 14px',
          borderRadius: 16,
          boxShadow: '0 18px 50px rgba(0,0,0,.5)',
          ...cardStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name="help" size={18} color={C.brand} />
          <span className="num" style={{ fontSize: 12, color: C.muted }}>
            {i + 1} of {list.length}
          </span>
          <button
            type="button"
            onClick={() => props.onClose(false)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', padding: '2px 4px' }}
          >
            Skip tour
          </button>
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, color: C.text, marginBottom: 6 }}>{step.title}</div>
        {step.body.map((t, k) => (
          <p key={k} style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>
            {t}
          </p>
        ))}
        {i === 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.muted, margin: '2px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={off} onChange={(e) => toggleOff(e.target.checked)} />
            Don't show this when I start a new career
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }} aria-hidden>
            {list.map((_, k) => (
              <span key={k} style={{ width: k === i ? 14 : 6, height: 6, borderRadius: 3, background: k === i ? C.brand : C.border, transition: 'width .15s' }} />
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {i > 0 && (
            <Button size="sm" onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                props.onClose(true);
                props.onOpenBuy?.();
              }}
            >
              Get my first aircraft
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setI(i + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
