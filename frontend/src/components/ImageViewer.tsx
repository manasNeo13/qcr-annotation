import { useState } from 'react';
import { Box, Dialog, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CloseIcon from '@mui/icons-material/Close';
import BrokenImageIcon from '@mui/icons-material/BrokenImageOutlined';
import { colors } from '../theme';

const STEPS = [1, 1.5, 2, 3];

function Controls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const i = STEPS.indexOf(zoom);
  return (
    <>
      <Tooltip title="Zoom out">
        <span>
          <IconButton size="small" aria-label="Zoom out" disabled={i <= 0} onClick={() => setZoom(STEPS[i - 1])}>
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
            onClick={() => setZoom(STEPS[i + 1])}
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

export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [fullZoom, setFullZoom] = useState(1);
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
            <Controls zoom={zoom} setZoom={setZoom} />
            <Tooltip title="Full screen">
              <IconButton size="small" aria-label="Open full screen" onClick={() => setFull(true)}>
                <FullscreenIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      <Box
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
          <Controls zoom={fullZoom} setZoom={setFullZoom} />
          <IconButton aria-label="Close" onClick={() => setFull(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box
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
        </Box>
      </Dialog>
    </Paper>
  );
}
