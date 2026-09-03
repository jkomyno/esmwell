// Derives the committed recordings from the tcut master.
//
// tcut renders the master at 2x for sharpness (2560x1600, 50 fps), which is
// too large to commit and exceeds what X accepts for a GIF (1280x1080, 350
// frames, 300M pixels). This script writes the two files that ship:
//   docs/media/playground.mp4  1280x800, 30 fps, H.264 (X re-encodes GIFs to
//                              video anyway; this keeps the frame rate)
//   docs/media/playground.gif  1280x800, 15 fps, inside every X GIF limit;
//                              the README embeds it
//
// Needs ffmpeg on the PATH. Run after `pnpm --filter playground demo`.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mediaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'media')
const source = join(mediaDir, 'playground-2x.gif')

if (!existsSync(source)) {
  console.error(`export-social: ${source} is missing; run "pnpm --filter playground demo" first`)
  process.exit(1)
}

const ffmpeg = (args, label) => {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, ...args], { stdio: 'inherit' })
  if (result.error) {
    console.error(`export-social: could not start ffmpeg (${result.error.message}); install ffmpeg and retry`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`export-social: ffmpeg failed while writing ${label}`)
    process.exit(result.status ?? 1)
  }
  console.log(`export-social: wrote ${label}`)
}

ffmpeg(
  [
    '-vf',
    'fps=30,scale=1280:-2:flags=lanczos,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    join(mediaDir, 'playground.mp4'),
  ],
  'docs/media/playground.mp4',
)

ffmpeg(
  [
    '-vf',
    'fps=15,scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    join(mediaDir, 'playground.gif'),
  ],
  'docs/media/playground.gif',
)
