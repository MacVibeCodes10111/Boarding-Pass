// ============================================================================
// AIRCRAFT PHOTO (v2.62)
//   A side view of an aircraft type, from public/aircraft/<model id>.webp
//   (made from the Airline Empires community templates; see Credits). Types
//   without a picture, and custom aircraft, show their map icon instead.
// ============================================================================
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AIRCRAFT_PHOTOS, aircraftArt } from '../game/aircraftPhotos';
import { cloudSkyCss } from '../game/cloudSky';
import { specialLabel, type Livery } from '../game/livery';
import { holdPhoto, paintedPhoto } from '../game/liveryPaint';
import type { AircraftModel, BrandKind } from '../game/types';

export interface LiveryCtx {
  liveries: Livery[];
  name: string;
  logo?: string;
  /** The subsidiaries' own liveries and names: their aircraft are painted in them. */
  brands?: Partial<Record<BrandKind, { name: string; livery: Livery }>>;
}
/** The player's liveries (up to two, and the subsidiaries'), so every picture of their aircraft is painted in its livery. */
export const LiveryContext = createContext<LiveryCtx | null>(null);

/** What one of the player's aircraft is painted in: the livery, the name on its side, and whether it's the special one. */
export function paintOf(ctx: LiveryCtx | null, ac: { livery?: number; brand?: BrandKind }): { livery?: Livery; name: string; special: boolean } {
  const b = ac.brand ? ctx?.brands?.[ac.brand] : undefined;
  if (b) return { livery: b.livery, name: b.name, special: false };
  const special = Boolean(ctx && ac.livery === 1 && ctx.liveries.length > 1);
  return { livery: ctx ? ctx.liveries[special ? 1 : 0] : undefined, name: ctx?.name ?? '', special };
}

/** A made-up registration for pictures of a type rather than of one aircraft. */
export const SAMPLE_REG = 'P4-ABC';

/** The picture of a model in a livery (plain white until it's painted). `cssWidth`: how wide it's shown. */
export function usePaintedPhoto(id: string, livery: Livery | null | undefined, name: string, reg = SAMPLE_REG, cssWidth = 1280): string {
  const plain = aircraftArt(id);
  const [url, setUrl] = useState(plain);
  useEffect(() => {
    let live = true;
    if (!livery || !AIRCRAFT_PHOTOS[id]) {
      setUrl(plain);
      return;
    }
    paintedPhoto(id, livery, name, reg, cssWidth).then((u) => live && setUrl(u ?? plain));
    // kept while shown, so its address is never taken back under it
    const release = holdPhoto(id, livery, name, reg, cssWidth);
    return () => {
      live = false;
      release();
    };
  }, [id, livery, name, reg, cssWidth, plain]);
  return url;
}

const BUY_PREF = 'bp_buy_livery_v1';
let buyLivery = (() => {
  try {
    return localStorage.getItem(BUY_PREF) !== '0';
  } catch {
    return true;
  }
})();
const buySubs = new Set<() => void>();
/** Show the airline's livery on the aircraft in the Buy screen (a choice kept on this device). */
export function useBuyLivery(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (f) => {
      buySubs.add(f);
      return () => buySubs.delete(f);
    },
    () => buyLivery
  );
  return [
    v,
    (x: boolean) => {
      buyLivery = x;
      try {
        localStorage.setItem(BUY_PREF, x ? '1' : '0');
      } catch {
        /* kept for this visit */
      }
      buySubs.forEach((f) => f());
    },
  ];
}

export function hasAircraftPhoto(model: AircraftModel): boolean {
  return Boolean(AIRCRAFT_PHOTOS[model.id]);
}

export function AircraftPhoto(props: {
  model: AircraftModel;
  /** Width in CSS pixels; the height follows the picture. */
  width: number | string;
  /** Shown when there is no picture (the map icon), at iconSize. */
  fallback?: string;
  iconSize?: number;
  style?: React.CSSProperties;
  /** One of the player's aircraft: its registration, and which livery it wears. */
  tailNumber?: string;
  liveryIndex?: number;
  /** The subsidiary it flies for: it wears that brand's livery and name. */
  brand?: BrandKind;
  /** No "Special Livery" tag (where it's shown beside the picture already). */
  noTag?: boolean;
  /** The plain white picture, without the airline's livery. */
  plain?: boolean;
  /** How wide it's shown, in CSS pixels, when `width` is a percentage (paints a smaller picture). */
  paintWidth?: number;
}) {
  const size = AIRCRAFT_PHOTOS[props.model.id];
  const [failed, setFailed] = useState(false);
  const ctx = useContext(LiveryContext);
  const { livery, name: paintName, special } = paintOf(ctx, { livery: props.liveryIndex, brand: props.brand });
  const src = usePaintedPhoto(props.model.id, props.plain ? undefined : livery, paintName, props.tailNumber || SAMPLE_REG, typeof props.width === 'number' ? props.width : props.paintWidth ?? 1280);
  if (!size || failed) {
    if (!props.fallback) return null;
    const s = props.iconSize ?? 24;
    return <img src={props.fallback} alt="" style={{ width: s, height: s, flex: 'none', ...props.style }} />;
  }
  const img = (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ display: 'block', width: special ? '100%' : props.width, maxWidth: '100%', height: 'auto', aspectRatio: `${size[0]} / ${size[1]}`, objectFit: 'contain', flex: 'none', ...(special ? {} : props.style) }}
    />
  );
  if (!special || props.noTag) return img;
  // the special livery is tagged on its picture, as flight trackers do
  const small = typeof props.width === 'number' && props.width < 120;
  return (
    <span style={{ position: 'relative', display: 'block', width: props.width, maxWidth: '100%', flex: 'none', ...props.style }} title={specialLabel(ctx!.liveries[1])}>
      {img}
      {small ? (
        <span aria-label={specialLabel(ctx!.liveries[1])} style={{ position: 'absolute', top: -3, right: -3, width: 14, height: 14, borderRadius: 99, background: SPECIAL_COLOUR, color: '#fff', fontSize: 9, display: 'grid', placeItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.4)' }}>
          ★
        </span>
      ) : (
        <span style={{ position: 'absolute', left: 6, top: 4 }}>
          <SpecialTag name={ctx!.liveries[1].name} />
        </span>
      )}
    </span>
  );
}

const SPECIAL_COLOUR = '#a8326e';

/** "Retro · Special Livery", the tag on aircraft in the second livery. */
export function SpecialTag({ name }: { name?: string }) {
  return (
    <span
      className="bp-special-tag"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, padding: '1px 7px', borderRadius: 99, background: SPECIAL_COLOUR, color: '#fff', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.2, verticalAlign: 'middle', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,.35)' }}
    >
      ★ {specialLabel({ v: 2, layers: [], logos: {}, name })}
    </span>
  );
}

/** One of the player's aircraft in the airline's livery, on a sky of its own (picked by its tail number). */
export function AircraftHero(props: { model: AircraftModel; tailNumber: string; liveryIndex?: number; brand?: BrandKind; photoWidth?: string; style?: React.CSSProperties }) {
  if (!AIRCRAFT_PHOTOS[props.model.id]) return null;
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '3 / 1',
        borderRadius: 12,
        overflow: 'hidden',
        background: `${cloudSkyCss(props.tailNumber || props.model.id)} center / cover`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        ...props.style,
      }}
    >
      {/* pinned to the middle, whatever the card's size */}
      <AircraftPhoto
        model={props.model}
        tailNumber={props.tailNumber}
        liveryIndex={props.liveryIndex}
        brand={props.brand}
        width={props.photoWidth ?? 'min(86%, 720px)'}
        style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: '92%', maxHeight: '86%', filter: 'drop-shadow(0 10px 12px rgba(10,20,40,.28))' }}
      />
    </div>
  );
}
