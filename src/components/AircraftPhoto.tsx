// ============================================================================
// AIRCRAFT PHOTO (v2.62)
//   A side view of an aircraft type, from public/aircraft/<model id>.webp
//   (made from the Airline Empires community templates; see Credits). Types
//   without a picture, and custom aircraft, show their map icon instead.
// ============================================================================
import { useState } from 'react';
import { AIRCRAFT_PHOTOS } from '../game/aircraftPhotos';
import type { AircraftModel } from '../game/types';

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
}) {
  const size = AIRCRAFT_PHOTOS[props.model.id];
  const [failed, setFailed] = useState(false);
  if (!size || failed) {
    if (!props.fallback) return null;
    const s = props.iconSize ?? 24;
    return <img src={props.fallback} alt="" style={{ width: s, height: s, flex: 'none', ...props.style }} />;
  }
  return (
    <img
      src={`/aircraft/${props.model.id}.webp`}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ display: 'block', width: props.width, maxWidth: '100%', height: 'auto', aspectRatio: `${size[0]} / ${size[1]}`, objectFit: 'contain', flex: 'none', ...props.style }}
    />
  );
}
