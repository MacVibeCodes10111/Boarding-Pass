// ============================================================================
// AIRCRAFT PHOTO (v2.62)
//   A side view of an aircraft type, from public/aircraft/<model id>.webp
//   (made from the Airline Empires community templates; see Credits). Types
//   without a picture, and custom aircraft, show their map icon instead.
// ============================================================================
import { createContext, useContext, useEffect, useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import { cloudSkyCss } from '../game/cloudSky';
import type { Livery } from '../game/livery';
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
}) {
  const size = AIRCRAFT_PHOTOS[props.model.id];
  const [failed, setFailed] = useState(false);
  const ctx = useContext(LiveryContext);
  const livery = ctx ? ctx.liveries[props.liveryIndex ?? 0] ?? ctx.liveries[0] : undefined;
  const src = usePaintedPhoto(props.model.id, livery, ctx?.name ?? '', props.tailNumber || SAMPLE_REG);
  if (!size || failed) {
    if (!props.fallback) return null;
    const s = props.iconSize ?? 24;
    return <img src={props.fallback} alt="" style={{ width: s, height: s, flex: 'none', ...props.style }} />;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ display: 'block', width: props.width, maxWidth: '100%', height: 'auto', aspectRatio: `${size[0]} / ${size[1]}`, objectFit: 'contain', flex: 'none', ...props.style }}
    />
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
