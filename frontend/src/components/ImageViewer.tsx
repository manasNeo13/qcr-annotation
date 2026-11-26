import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Dialog, IconButton, Paper, Tooltip, Typography, type SxProps, type Theme } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import BrokenImageIcon from '@mui/icons-material/BrokenImageOutlined';
import { colors } from '../theme';
import type { ScanImage } from '../types';

const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8];
const MAX = STEPS[STEPS.length - 1];
const stepUp = (z: number) => STEPS.find((s) => s > z + 1e-6) ?? MAX;
const stepDown = (z: number) => [...STEPS].reverse().find((s) => s < z - 1e-6) ?? 1;

function Controls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  return (
    <>
      <Tooltip title="Zoom out">
        <span>
          <IconButton size="small" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(stepDown(zoom))}>
            <ZoomOutIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={zoom > 1 ? 'Reset to fit' : 'Drag to move · wheel or double-click to zoom'}>
        <Box
          component="button"
          type="button"
          onClick={() => setZoom(1)}
          sx={{
            fontSize: 12,
            fontWeight: 600,
            minWidth: 44,
            textAlign: 'center',
            color: colors.muted,
            bgcolor: 'transparent',
            border: 0,
            cursor: zoom > 1 ? 'pointer' : 'default',
            p: 0.5,
            borderRadius: '6px',
            '&:hover': zoom > 1 ? { bgcolor: colors.brandSoft } : undefined,
          }}
        >
          {Math.round(zoom * 100)}%
        </Box>
      </Tooltip>
      <Tooltip title="Zoom in">
        <span>
          <IconButton size="small" aria-label="Zoom in" disabled={zoom >= MAX} onClick={() => setZoom(stepUp(zoom))}>
            <ZoomInIcon />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}

/**
 * Zoom + pan by CSS transform (not scrolling): image fits the frame at 100%, zoom scales it,
 * drag moves it freely in every direction (any spot can be brought to the middle).
 * Wheel = zoom at the pointer (inline view: Ctrl + wheel, so the page still scrolls). Double-click = zoom in there.
 */
function ZoomFrame({
  src,
  alt,
  zoom,
  setZoom,
  wheel,
  onError,
  sx,
}: {
  src: string;
  alt: string;
  zoom: number;
  setZoom: (z: number) => void;
  /** true = plain wheel zooms (full screen); false = needs Ctrl. */
  wheel: boolean;
  onError: () => void;
  sx: SxProps<Theme>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const zoomRef = useRef(zoom);
  const pending = useRef<{ x: number; y: number } | null>(null); // zoom anchor (px from frame centre)

  /** Keep the image reachable: any point of it can come to the frame centre, no further. */
  const clamp = useCallback((p: { x: number; y: number }, z: number) => {
    const el = img.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const mx = (el.clientWidth * z) / 2;
    const my = (el.clientHeight * z) / 2;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  }, []);

  // Zoom changed → scale offset around the anchor (pointer, or frame centre for buttons).
  useLayoutEffect(() => {
    const prev = zoomRef.current;
    zoomRef.current = zoom;
    if (prev === zoom) return;
    const a = pending.current ?? { x: 0, y: 0 };
    pending.current = null;
    const r = zoom / prev;
    setPos((p) => clamp({ x: a.x - (a.x - p.x) * r, y: a.y - (a.y - p.y) * r }, zoom));
  }, [zoom, clamp]);

  const anchorAt = (clientX: number, clientY: number) => {
    const b = frame.current!.getBoundingClientRect();
    return { x: clientX - (b.left + b.width / 2), y: clientY - (b.top + b.height / 2) };
  };

  // Wheel needs a non-passive listener to stop page scroll.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!wheel && !e.ctrlKey) return;
      e.preventDefault();
      const z = zoomRef.current;
      const next = e.deltaY < 0 ? stepUp(z) : stepDown(z);
      if (next === z) return;
      pending.current = anchorAt(e.clientX, e.clientY);
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel, setZoom]);

  const active = zoom > 1;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, id: e.pointerId };
    frame.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    setPos(clamp({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) }, zoom));
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    frame.current?.releasePointerCapture(d.id);
    drag.current = null;
    setDragging(false);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (zoom >= MAX) return setZoom(1);
    pending.current = anchorAt(e.clientX, e.clientY);
    setZoom(stepUp(zoom));
  };

  return (
    <Box
      ref={frame}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
      sx={[
        {
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: active ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          touchAction: active ? 'none' : 'auto',
          userSelect: 'none',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        component="img"
        ref={img}
        src={src}
        alt={alt}
        onError={onError}
        draggable={false}
        sx={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: dragging ? 'none' : 'transform .12s ease-out',
          willChange: 'transform',
        }}
      />
    </Box>
  );
}

const FIELD_LABEL: Record<string, string> = { mrp: 'MRP', batch: 'Batch', mfd: 'Mfg date', exp: 'Expiry' };
const FIELD_ORDER = ['mfd', 'exp', 'batch', 'mrp'];
const sortFields = (f: string[]) => [...f].sort((a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b));

/** Small flags: which fields were read from this photo. */
function FieldTags({ fields, dark }: { fields: string[]; dark?: boolean }) {
  if (!fields.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {sortFields(fields).map((f) => (
        <Box
          key={f}
          component="span"
          sx={{
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: 1,
            px: 0.75,
            py: 0.5,
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            bgcolor: dark ? 'rgba(255,255,255,.14)' : colors.brandSoft,
            color: dark ? '#fff' : colors.brandDark,
            border: `1px solid ${dark ? 'rgba(255,255,255,.25)' : colors.brand100}`,
          }}
        >
          {FIELD_LABEL[f] ?? f.toUpperCase()}
        </Box>
      ))}
    </Box>
  );
}

const arrowSx = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  width: 40,
  height: 40,
  bgcolor: 'rgba(18,23,30,.62)',
  color: '#fff',
  '&:hover': { bgcolor: 'rgba(18,23,30,.82)' },
  '&.Mui-disabled': { opacity: 0, pointerEvents: 'none' },
} as const;

/** On-image photo navigation: ‹ › arrows + "Shows: …" flag + dots. Sits over the frame, so nothing to scroll to. */
function PhotoOverlay({ images, index, onPick }: { images: ScanImage[]; index: number; onPick: (i: number) => void }) {
  const photo = images[index];
  const many = images.length > 1;
  return (
    <>
      {photo && (photo.fields.length > 0 || many) && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 2,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            maxWidth: 'calc(100% - 20px)',
            px: 1,
            py: 0.75,
            borderRadius: '8px',
            bgcolor: 'rgba(18,23,30,.72)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {many && (
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              Photo {index + 1}/{images.length}
            </Typography>
          )}
          {photo.fields.length > 0 && (
            <>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>
                {many ? '· Shows' : 'Shows'}
              </Typography>
              <FieldTags fields={photo.fields} dark />
            </>
          )}
        </Box>
      )}
      {many && (
        <>
          <IconButton aria-label="Previous photo" disabled={index === 0} onClick={() => onPick(index - 1)} sx={{ ...arrowSx, left: 10 }}>
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            aria-label="Next photo"
            disabled={index === images.length - 1}
            onClick={() => onPick(index + 1)}
            sx={{ ...arrowSx, right: 10 }}
          >
            <ChevronRightIcon />
          </IconButton>
          <Box
            sx={{
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2,
              display: 'flex',
              gap: 0.75,
              px: 1,
              py: 0.75,
              borderRadius: 99,
              bgcolor: 'rgba(18,23,30,.62)',
            }}
          >
            {images.map((img, i) => (
              <Box
                key={img.url + i}
                component="button"
                type="button"
                aria-label={`Photo ${i + 1}`}
                aria-current={i === index}
                onClick={() => onPick(i)}
                sx={{
                  width: i === index ? 18 : 8,
                  height: 8,
                  p: 0,
                  border: 0,
                  borderRadius: 99,
                  cursor: 'pointer',
                  bgcolor: i === index ? '#fff' : 'rgba(255,255,255,.45)',
                  transition: 'width .15s, background-color .15s',
                }}
              />
            ))}
          </Box>
        </>
      )}
    </>
  );
}

/**
 * Old captures: one `src`. New scans: `images` (best photos + fields read from each);
 * several → tabs to switch, the fields shown on each photo are flagged on it.
 */
/**
 * full / onFullChange: page controls full screen (stays open across prev/next).
 * fullFooter: shown under the image in full screen (values + edit + submit/next).
 */
export default function ImageViewer({
  src,
  alt,
  images,
  full: fullProp,
  onFullChange,
  fullFooter,
}: {
  src: string;
  alt: string;
  images?: ScanImage[];
  full?: boolean;
  onFullChange?: (open: boolean) => void;
  fullFooter?: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [fullOwn, setFullOwn] = useState(false);
  const full = fullProp ?? fullOwn;
  const setFull = (v: boolean) => (onFullChange ? onFullChange(v) : setFullOwn(v));
  const [fullZoom, setFullZoom] = useState(1);
  const [broken, setBroken] = useState(false);
  const [index, setIndex] = useState(0);

  const scan = images !== undefined;
  const photo = scan ? images[index] : undefined;
  const current = scan ? (photo?.url ?? '') : src;
  const missing = scan && !images.length;
  const pick = (i: number) => {
    setIndex(i);
    setBroken(false);
    setZoom(1);
    setFullZoom(1);
  };

  if (missing) {
    return (
      <Paper sx={{ overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${colors.border}` }}>
          <Typography variant="h5" component="h2">
            Document image
          </Typography>
        </Box>
        <Box
          sx={{
            bgcolor: colors.background,
            height: { xs: '30vh', md: 320 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.muted,
            gap: 1,
          }}
        >
          <BrokenImageIcon sx={{ fontSize: 48, color: colors.subtle }} />
          <Typography>No image for this scan.</Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 2,
          py: 1,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Typography variant="h5" component="h2" sx={{ flex: 1 }}>
          Document image
        </Typography>
        {!broken && (
          <>
            <Controls zoom={zoom} setZoom={setZoom} />
            <Tooltip title="Full screen">
              <IconButton size="small" aria-label="Open full screen" onClick={() => setFull(true)}>
                <FullscreenIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      <Box sx={{ position: 'relative' }}>
      {scan && <PhotoOverlay images={images} index={index} onPick={pick} />}
      {broken ? (
        <Box
          sx={{
            bgcolor: colors.background,
            height: { xs: '45vh', md: 'clamp(320px, calc(100dvh - 260px), 720px)' },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: colors.muted,
            px: 2,
          }}
        >
          <BrokenImageIcon sx={{ fontSize: 48, color: colors.subtle }} />
          <Typography>Image unavailable. The link may have expired — reload the page.</Typography>
        </Box>
      ) : (
        <ZoomFrame
          key={current}
          src={current}
          alt={alt}
          zoom={zoom}
          setZoom={setZoom}
          wheel={false}
          onError={() => setBroken(true)}
          sx={{
            bgcolor: colors.background,
            // Fixed frame: whole image visible without page scroll.
            height: { xs: '45vh', md: 'clamp(320px, calc(100dvh - 260px), 720px)' },
            p: { xs: 1, sm: 1.5 },
          }}
        />
      )}
      </Box>

      <Dialog
        fullScreen
        open={full}
        onClose={() => setFull(false)}
        // Controlled (stays open on next capture) → no re-open animation flash.
        transitionDuration={onFullChange ? 0 : undefined}
        slotProps={{ paper: { 'data-viewer-full': '', sx: { display: 'flex', flexDirection: 'column' } } as object }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 2,
            py: 1,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <Typography variant="h5" sx={{ flex: 1 }} noWrap>
            {alt}
          </Typography>
          <Controls zoom={fullZoom} setZoom={setFullZoom} />
          <IconButton aria-label="Close" onClick={() => setFull(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {scan && (
          <PhotoOverlay
            images={images}
            index={index}
            onPick={pick}
          />
        )}
        <ZoomFrame
          key={current}
          src={current}
          alt={alt}
          zoom={fullZoom}
          setZoom={setFullZoom}
          wheel
          onError={() => setBroken(true)}
          sx={{ height: '100%', bgcolor: '#12171e', p: 2 }}
        />
        </Box>
        {fullFooter && (
          <Box sx={{ flexShrink: 0, borderTop: `1px solid ${colors.border}`, bgcolor: '#fff', maxHeight: '45dvh', overflowY: 'auto' }}>
            {fullFooter}
          </Box>
        )}
      </Dialog>
    </Paper>
  );
}
