import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Dialog, IconButton, Paper, Tooltip, Typography, type SxProps, type Theme } from '@mui/material';
import PanToolIcon from '@mui/icons-material/PanToolOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CloseIcon from '@mui/icons-material/Close';
import BrokenImageIcon from '@mui/icons-material/BrokenImageOutlined';
import { colors } from '../theme';

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

export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [fullZoom, setFullZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [fullPan, setFullPan] = useState(false);
  const [broken, setBroken] = useState(false);

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
          <Img src={src} alt={alt} zoom={zoom} onError={() => setBroken(true)} />
        )}
      </PanFrame>

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
          <Img src={src} alt={alt} zoom={fullZoom} onError={() => setBroken(true)} />
        </PanFrame>
      </Dialog>
    </Paper>
  );
}
