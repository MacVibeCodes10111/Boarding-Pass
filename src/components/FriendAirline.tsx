// ============================================================================
// A FRIEND'S AIRLINE (Update A)
//   Opened from the info button on a friend's aircraft: their liveries, their
//   airline at a glance and their route map. All of it comes from what they
//   already share with friends (their profile and weekly schedule), so it shows
//   nothing new about them: never money or passenger numbers.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { cloudSkyCss } from '../game/cloudSky';
import { friendAirlineStats, friendRouteMap, type FriendRoute } from '../game/friendAirline';
import { loadFriends, type FriendCard } from '../game/friends';
import { friendLiveries, friendsMapViewer, friendsOnMap, onFriendsMapChange } from '../game/friendsMap';
import { loadMaplibre } from '../game/icons';
import { specialLabel } from '../game/livery';
import { paintedPhoto } from '../game/liveryPaint';
import type { Airport } from '../game/types';
import { Button, C, DISPLAY, ModalShell, Stat } from '../ui/kit';
import { TrustedCredits, friendTintFor, mapStyleFor, type MapStyleId } from './LiveMap';

const OPEN_EVENT = 'bp-open-friend-airline';
const MAP_FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
const SHOWN = 8;

/** Opens a friend's airline (their id on the map). */
export const openFriendAirline = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));

export function FriendAirlineHost(props: { airports: ReadonlyMap<string, Airport>; mapStyle: MapStyleId }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setId(String((e as CustomEvent<string>).detail));
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return id ? <FriendAirlineWindow key={id} id={id} airports={props.airports} mapStyle={props.mapStyle} onClose={() => setId(null)} /> : null;
}

function FriendAirlineWindow(props: { id: string; airports: ReadonlyMap<string, Airport>; mapStyle: MapStyleId; onClose: () => void }) {
  const { id, airports } = props;
  const [fr, setFr] = useState(() => friendsOnMap().find((f) => f.id === id) ?? null);
  // Unfriended, blocked or no longer on the map: what was showing goes too
  useEffect(() => onFriendsMapChange(() => setFr(friendsOnMap().find((f) => f.id === id) ?? null)), [id]);
  const stats = useMemo(() => (fr ? friendAirlineStats(fr.snapshot, airports) : null), [fr, airports]);

  const [card, setCard] = useState<FriendCard | null>(null);
  useEffect(() => {
    const me = friendsMapViewer();
    if (!me) return;
    let live = true;
    loadFriends(me)
      .then((d) => live && setCard(d?.friends.find((f) => f.id === id)?.card ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  const [pics, setPics] = useState<{ label: string; url: string | null }[] | null>(null);
  const [badge, setBadge] = useState<string | null>(null);
  const model = stats ? pictureModel(stats.mainModel, fr!.snapshot.models) : null;
  const reg = fr && model ? regOf(fr.snapshot, model) : '';
  const name = fr?.airline ?? '';
  const version = fr?.updatedAt;
  useEffect(() => {
    if (!version) return;
    let live = true;
    void friendLiveries(id).then(async (lvs) => {
      if (!live) return;
      const b = lvs[0]?.badge ? lvs[0].logos?.[lvs[0].badge] : undefined;
      setBadge(b ?? null);
      const shown = lvs.slice(0, 2).map((l, i) => ({ label: i === 0 ? 'Main livery' : specialLabel(l), url: null as string | null, l }));
      setPics(shown.map(({ label }) => ({ label, url: null })));
      if (!model) return;
      const urls = await Promise.all(shown.map((s) => paintedPhoto(model, s.l, name, reg).catch(() => null)));
      if (live) setPics(shown.map((s, i) => ({ label: s.label, url: urls[i] })));
    });
    return () => {
      live = false;
    };
  }, [id, version, model, name, reg]);

  return (
    <ModalShell onClose={props.onClose} maxWidth={640} label={fr ? fr.airline : 'Friend’s airline'}>
      <div style={{ padding: '20px 22px 22px' }}>
        {!fr || !stats ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, margin: 0 }}>Friend’s airline</h2>
            <p style={{ fontSize: 13.5, color: C.muted, margin: 0, lineHeight: 1.5 }}>This airline isn’t on your map any more, so there’s nothing to show.</p>
            <Button onClick={props.onClose}>Close</Button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 30 }}>
              {badge && <img src={badge} alt="" style={{ width: 48, height: 48, flex: 'none', padding: 4, borderRadius: 11, background: '#fff', objectFit: 'contain' }} />}
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{fr.airline}</h2>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
                  {[fr.code, fr.callsign, card?.stats?.founded ? `since ${new Date(`${card.stats.founded}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''].filter(Boolean).join(' · ')}
                  {' · '}
                  <span style={{ color: C.friends }}>Friend</span>
                </div>
              </div>
            </header>

            {pics && pics.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 10 }}>
                {pics.map((p, i) => (
                  <figure key={i} style={{ margin: 0 }}>
                    <div style={{ position: 'relative', aspectRatio: '2.8', borderRadius: 10, overflow: 'hidden', background: `${cloudSkyCss(`${fr.id}${i}`)} center/cover` }}>
                      {p.url && <img src={p.url} alt={`${fr.airline}, ${p.label}`} style={{ position: 'absolute', left: '6%', width: '88%', top: '50%', transform: 'translateY(-50%)', filter: 'drop-shadow(0 8px 10px rgba(10,20,40,.28))' }} />}
                    </div>
                    <figcaption style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{p.label}</figcaption>
                  </figure>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '12px 16px', padding: '12px 14px', borderRadius: 12, background: C.raised }}>
              <Stat label="Aircraft" value={(card?.fleet ?? stats.aircraft).toLocaleString()} sub={card?.fleet != null && card.fleet !== stats.aircraft ? `${stats.aircraft.toLocaleString()} flying` : undefined} />
              <Stat label="Routes" value={stats.routes.length.toLocaleString()} />
              <Stat label="Destinations" value={stats.destinations.toLocaleString()} />
              <Stat label="Flights a week" value={stats.weeklyFlights.toLocaleString()} />
              {card?.stats && <Stat label="Hubs" value={card.stats.hubs.toLocaleString()} />}
              {card?.stats && <Stat label="Weeks running" value={card.stats.weeks.toLocaleString()} />}
            </div>

            <section>
              <SectionHead title="Route map" note={stats.longest ? `Longest: ${stats.longest.a}–${stats.longest.b}, ${stats.longest.nm.toLocaleString()} nm` : undefined} />
              {stats.routes.length ? (
                <RouteMap routes={stats.routes} airports={airports} mapStyle={props.mapStyle} />
              ) : (
                <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>No flights this game can show.</p>
              )}
            </section>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <section style={{ flex: '1 1 240px', minWidth: 0 }}>
                <SectionHead title="Busiest routes" />
                <List
                  rows={stats.routes.slice(0, SHOWN).map((r) => [`${r.a}–${r.b}`, `${r.weekly} a week`, `${r.nm.toLocaleString()} nm`])}
                  more={stats.routes.length - SHOWN}
                />
              </section>
              <section style={{ flex: '1 1 240px', minWidth: 0 }}>
                <SectionHead title="Fleet flying" />
                <List rows={stats.types.slice(0, SHOWN).map((t) => [t.name, `${t.count}`, ''])} more={stats.types.length - SHOWN} />
                {stats.busiest.length > 0 && (
                  <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0', lineHeight: 1.45 }}>
                    Busiest airports: {stats.busiest.slice(0, 3).map((b) => `${b.name} (${b.iata})`).join(', ')}
                  </p>
                )}
              </section>
            </div>

            <p style={{ fontSize: 11.5, color: C.faint, margin: 0, lineHeight: 1.45 }}>From the weekly schedule they show friends. Their money and passengers stay private.</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/** The type the pictures are painted on: their most flown one with a picture in this game. */
function pictureModel(main: string | null, models: readonly string[]): string | null {
  if (main && AIRCRAFT_PHOTOS[main]) return main;
  return models.find((m) => AIRCRAFT_PHOTOS[m]) ?? null;
}

function regOf(snap: { models: string[]; regs: string[]; flights: (string | number)[][] }, model: string): string {
  const mi = snap.models.indexOf(model);
  const f = snap.flights.find((x) => x[5] === mi);
  return f ? snap.regs[Number(f[6])] ?? '' : '';
}

function SectionHead(props: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <h3 style={{ fontSize: 14, fontWeight: 650, margin: 0, flex: 1 }}>{props.title}</h3>
      {props.note && <span style={{ fontSize: 12, color: C.muted }}>{props.note}</span>}
    </div>
  );
}

function List(props: { rows: string[][]; more: number }) {
  return (
    <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
      {props.rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[0]}</span>
          <span className="num" style={{ color: C.textDim }}>{r[1]}</span>
          {r[2] && (
            <span className="num" style={{ color: C.muted, minWidth: 62, textAlign: 'right' }}>
              {r[2]}
            </span>
          )}
        </div>
      ))}
      {props.more > 0 && <div style={{ fontSize: 12, color: C.muted, paddingTop: 4 }}>and {props.more.toLocaleString()} more</div>}
    </div>
  );
}

/** Their routes on a small map of its own, in the same map style as the game's. */
function RouteMap(props: { routes: readonly FriendRoute[]; airports: ReadonlyMap<string, Airport>; mapStyle: MapStyleId }) {
  const box = useRef<HTMLDivElement | null>(null);
  const { routes, airports, mapStyle } = props;
  useEffect(() => {
    let map: any = null;
    let dead = false;
    void loadMaplibre().then((ml) => {
      if (dead || !box.current) return;
      const m = friendRouteMap(routes, airports);
      map = new ml.Map({ container: box.current, style: mapStyleFor(mapStyle), attributionControl: false, center: [0, 30], zoom: 0.4, minZoom: -1.5, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0 });
      map.addControl(new TrustedCredits(), 'bottom-right');
      map.on('load', () => {
        const tint = friendTintFor(mapStyle);
        const halo = mapStyle === 'light' ? '#ffffff' : '#0b1220';
        map.addSource('fr-routes', { type: 'geojson', data: m.lines });
        map.addSource('fr-airports', { type: 'geojson', data: m.points });
        map.addLayer({ id: 'fr-routes', type: 'line', source: 'fr-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': tint, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['get', 'weekly'], 1, 1.2, 14, 2.2, 60, 4] } });
        map.addLayer({ id: 'fr-airports', type: 'circle', source: 'fr-airports', paint: { 'circle-radius': 3.5, 'circle-color': tint, 'circle-stroke-color': halo, 'circle-stroke-width': 1.5 } });
        map.addLayer({
          id: 'fr-labels',
          type: 'symbol',
          source: 'fr-airports',
          layout: { 'text-field': ['get', 'iata'], 'text-font': MAP_FONT, 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': mapStyle === 'light' ? '#1e293b' : '#f1f5f9', 'text-halo-color': halo, 'text-halo-width': 1.2 },
        });
        const fit = () => m.bounds && map.fitBounds(m.bounds, { padding: 34, maxZoom: 6, duration: 0 });
        fit();
        // A phone turned round, or the window resized: all of it in view again
        map.on('resize', fit);
      });
    });
    return () => {
      dead = true;
      map?.remove();
    };
  }, [routes, airports, mapStyle]);
  return <div ref={box} role="img" aria-label="Their route map" style={{ height: 'min(300px, 45vh)', borderRadius: 12, overflow: 'hidden', background: C.raised }} />;
}
