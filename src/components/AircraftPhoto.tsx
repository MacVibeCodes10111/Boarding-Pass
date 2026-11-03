// ============================================================================
// AIRCRAFT PHOTO (v2.62)
//   A side view of an aircraft type, from public/aircraft/<model id>.webp
//   (made from the Airline Empires community templates; see Credits). Types
//   without a picture, and custom aircraft, show their map icon instead.
// ============================================================================
import { createContext, useContext, useEffect, useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { cloudSkyCss } from '../game/cloudSky';
import { specialLabel, type Livery } from '../game/livery';
import { paintedPhoto } from '../game/liveryPaint';
import type { AircraftModel } from '../game/types';

/** The player's liveries (up to two), so every picture of their aircraft is painted in its livery. */
export const LiveryContext = createContext<{ liveries: Livery[]; name: string } | null>(null);

/** A made-up registration for pictures of a type rather than of one aircraft. */
export const SAMPLE_REG = 'P4-ABC';

/** The picture of a model in a livery (plain white until it's painted). */
export function usePaintedPhoto(id: string, livery: Livery | null | undefined, name: string, reg = SAMPLE_REG): string {
  const plain = `/aircraft/${id}.webp`;
  const [url, setUrl] = useState(plain);
  useEffect(() => {
    let live = true;
    if (!livery || !AIRCRAFT_PHOTOS[id]) {
      setUrl(plain);
      return;
    }
    paintedPhoto(id, livery, name, reg).then((u) => live && setUrl(u ?? plain));
    return () => {
      live = false;
    };
  }, [id, livery, name, reg, plain]);
  return url;
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
  /** No "Special Livery" tag (where it's shown beside the picture already). */
  noTag?: boolean;
}) {
  const size = AIRCRAFT_PHOTOS[props.model.id];
  const [failed, setFailed] = useState(false);
  const ctx = useContext(LiveryContext);
  const special = Boolean(ctx && props.liveryIndex === 1 && ctx.liveries.length > 1);
  const livery = ctx ? ctx.liveries[special ? 1 : 0] : undefined;
  const src = usePaintedPhoto(props.model.id, livery, ctx?.name ?? '', props.tailNumber || SAMPLE_REG);
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
export function AircraftHero(props: { model: AircraftModel; tailNumber: string; liveryIndex?: number; photoWidth?: string; style?: React.CSSProperties }) {
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
        width={props.photoWidth ?? 'min(86%, 720px)'}
        style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: '92%', maxHeight: '86%', filter: 'drop-shadow(0 10px 12px rgba(10,20,40,.28))' }}
      />
    </div>
  );
}
