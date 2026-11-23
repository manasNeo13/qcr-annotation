import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Dialog, IconButton, Paper, Tooltip, Typography, type SxProps, type Theme } from '@mui/material';
import PanToolIcon from '@mui/icons-material/PanToolOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import BrokenImageIcon from '@mui/icons-material/BrokenImageOutlined';
import { colors } from '../theme';
import type { ScanImage } from '../types';

const STEPS = [1, 1.5, 2, 3];

interface ControlProps {
  zoom: number;
  setZoom: (z: number) => void;
  pan: boolean;
  setPan: (p: boolean) => void;
}

function Controls({ zoom, setZoom, pan, setPan }: ControlProps) {
  const i = STEPS.indexOf(zoom);
  const canPan = zoom > 1;
  // Zooming in turns pan on (drag to move); back to 100% → pan off.
  const zoomTo = (z: number) => {
    setZoom(z);
    setPan(z > 1);
  };
  return (
    <>
      <Tooltip title={canPan ? (pan ? 'Pan on — drag image to move' : 'Pan (drag to move)') : 'Zoom in to pan'}>
        <span>
          <IconButton
            size="small"
            aria-label="Pan"
            aria-pressed={pan && canPan}
            disabled={!canPan}
            onClick={() => setPan(!pan)}
            sx={
              pan && canPan
                ? { bgcolor: colors.brandSoft, color: colors.brandDark, '&:hover': { bgcolor: colors.brandSoft } }
                : undefined
            }
          >
            <PanToolIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Zoom out">
        <span>
          <IconButton size="small" aria-label="Zoom out" disabled={i <= 0} onClick={() => zoomTo(STEPS[i - 1])}>
            <ZoomOutIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Typography
        sx={{
          fontSize: 12,
          fontWeight: 600,
          minWidth: 40,
          textAlign: 'center',
          color: colors.muted,
        }}
      >
        {Math.round(zoom * 100)}%
      </Typography>
      <Tooltip title="Zoom in">
        <span>
          <IconButton
            size="small"
            aria-label="Zoom in"
            disabled={i >= STEPS.length - 1}
            onClick={() => zoomTo(STEPS[i + 1])}
          >
            <ZoomInIcon />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}

function Img({ src, alt, zoom, onError }: { src: string; alt: string; zoom: number; onError: () => void }) {
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      onError={onError}
      draggable={false}
      // 100% = fit whole image in the frame (no scrolling); zoom grows height → frame scrolls.
      sx={
        zoom === 1
          ? {
              display: 'block',
              m: 'auto',
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
            }
          : {
              display: 'block',
              height: `${zoom * 100}%`,
              width: 'auto',
              maxWidth: 'none',
              flexShrink: 0,
            }
      }
    />
  );
}

/**
 * Scroll frame with drag-to-pan (mouse, touch, pen) when pan on + zoomed.
 * Keeps view centred on same spot when zoom changes.
 */
function PanFrame({ zoom, pan, sx, children }: { zoom: number; pan: boolean; sx: SxProps<Theme>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const prevZoom = useRef(zoom);
  const active = pan && zoom > 1;

  // Zoom change → keep centre point (fraction of content) in middle of frame.
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = prevZoom.current;
    prevZoom.current = zoom;
    if (!el || prev === zoom) return;
    if (zoom === 1) {
      el.scrollTo(0, 0);
      return;
    }
    const ratio = zoom / prev;
    const cx = (el.scrollLeft + el.clientWidth / 2) * ratio;
    const cy = (el.scrollTop + el.clientHeight / 2) * ratio;
    // Wait one frame so image has new size.
    requestAnimationFrame(() => {
      const fromFit = prev === 1;
      el.scrollLeft = fromFit ? (el.scrollWidth - el.clientWidth) / 2 : cx - el.clientWidth / 2;
      el.scrollTop = fromFit ? (el.scrollHeight - el.clientHeight) / 2 : cy - el.clientHeight / 2;
    });
  }, [zoom]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!active || !el || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    ref.current?.releasePointerCapture(d.id);
    drag.current = null;
    setDragging(false);
  };

  return (
    <Box
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      sx={[
        {
          cursor: active ? (dragging ? 'grabbing' : 'grab') : 'default',
          // Pan on → we handle touch drag ourselves; off → native scroll.
          touchAction: active ? 'none' : 'auto',
          userSelect: active ? 'none' : 'auto',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
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
export default function ImageViewer({ src, alt, images }: { src: string; alt: string; images?: ScanImage[] }) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [fullZoom, setFullZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [fullPan, setFullPan] = useState(false);
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
    setPan(false);
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
            <Controls zoom={zoom} setZoom={setZoom} pan={pan} setPan={setPan} />
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
      <PanFrame
        zoom={zoom}
        pan={pan}
        sx={{
          bgcolor: colors.background,
          overflow: 'auto',
          // Fixed frame: whole image visible without page scroll.
          height: {
            xs: '45vh',
            md: 'clamp(320px, calc(100dvh - 260px), 720px)',
          },
          display: 'flex',
          alignItems: zoom === 1 ? 'center' : 'flex-start',
          justifyContent: zoom === 1 ? 'center' : 'flex-start',
          p: { xs: 1, sm: 1.5 },
        }}
      >
        {broken ? (
          <Box sx={{ m: 'auto', textAlign: 'center', color: colors.muted, py: 6 }}>
            <BrokenImageIcon sx={{ fontSize: 48, color: colors.subtle }} />
            <Typography>Image unavailable. The link may have expired — reload the page.</Typography>
          </Box>
        ) : (
          <Img key={current} src={current} alt={alt} zoom={zoom} onError={() => setBroken(true)} />
        )}
      </PanFrame>
      </Box>

      <Dialog fullScreen open={full} onClose={() => setFull(false)}>
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
          <Controls zoom={fullZoom} setZoom={setFullZoom} pan={fullPan} setPan={setFullPan} />
          <IconButton aria-label="Close" onClick={() => setFull(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ position: 'relative' }}>
        {scan && (
          <PhotoOverlay
            images={images}
            index={index}
            onPick={(i) => {
              pick(i);
              setFullZoom(1);
              setFullPan(false);
            }}
          />
        )}
        <PanFrame
          zoom={fullZoom}
          pan={fullPan}
          sx={{
            height: 'calc(100dvh - 57px)',
            overflow: 'auto',
            bgcolor: '#12171e',
            display: 'flex',
            alignItems: fullZoom === 1 ? 'center' : 'flex-start',
            justifyContent: fullZoom === 1 ? 'center' : 'flex-start',
            p: 2,
          }}
        >
          <Img key={current} src={current} alt={alt} zoom={fullZoom} onError={() => setBroken(true)} />
        </PanFrame>
        </Box>
      </Dialog>
    </Paper>
  );
}
