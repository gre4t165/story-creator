// Builds resources/sfx/ambience: seamless loops of CC0 Freesound recordings plus generated noise, and the credits
// file. Download the previews listed in SOURCES into a folder first (file names start with the Freesound id), then:
//   node scripts/ambience-pack.cjs <folder with the downloads>
// and afterwards rebuild the catalog: node scripts/sfx-catalog.cjs
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const ffmpeg = require('ffmpeg-static')
const out = path.join(root, 'resources', 'sfx', 'ambience')

/** Freesound id → our name. All of them are CC0 (checked on each sound page). */
const SOURCES = [
  { id: 833924, name: 'rain-roof', title: 'Rain on the House Roof Window #001', author: 'bassimat' },
  { id: 251233, name: 'rain-tent', title: 'In the Tent - Rain', author: 'pulswelle' },
  { id: 767061, name: 'rain-night', title: 'Rain at night', author: 'ThabzMalik' },
  { id: 399682, name: 'thunderstorm', title: 'Rainy night with thunder and water dropping', author: 'BonnyOrbit' },
  { id: 667010, name: 'ocean', title: 'Baltic Sea II - Zingst/Germany', author: 'pulswelle' },
  { id: 722875, name: 'river', title: 'Relaxing River Sound', author: 'IceVFX' },
  { id: 496130, name: 'fireplace', title: 'Fireplace for Six Minutes (Stereo)', author: 'petebuchwald' },
  { id: 729396, name: 'campfire', title: 'Campfire 02', author: 'HECKFRICKER' },
  { id: 121965, name: 'forest', title: 'Nord_Odal_Nyhus quiet forest birds insects leaf rustle 02', author: 'nfsgit' },
  { id: 400353, name: 'crickets', title: 'Village Night Crickets', author: 'savvah' },
  { id: 849302, name: 'wind', title: 'WNW Wind and Snow on Holehead Hill', author: 'Sandy-Ogilvie' },
  { id: 689957, name: 'cafe', title: 'Ambience Coffee', author: 'Matias44' },
  { id: 437342, name: 'fan', title: 'Fan, setting 1', author: 'giddster' }
]

/** Loops are at most this long; the join is a crossfade of the end into the start. */
const MAX_SEC = 300
const FADE_SEC = 5
/** Quiet enough that two or three layers together stay comfortable for sleep. */
const TARGET_LUFS = -26

/** ffmpeg's log (stderr), where both the stream info and loudnorm's measurement are printed. */
function run(args, check = true) {
  const r = spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (check && r.status !== 0) throw new Error(r.stderr.split('\n').slice(-5).join('\n'))
  return r.stderr
}

const durationOf = (file) => {
  // Without an output ffmpeg prints the stream info and exits with an error, which is expected here.
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(run(['-i', file], false))
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0
}

const FMT = 'asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo'

/**
 * A loop of `len` seconds from the same source opened twice ([0:a] and [1:a]; asplit stalls with acrossfade): the
 * stretch after the first FADE_SEC, whose end crossfades into those first seconds, so the last sample leads
 * straight back into the first.
 */
const loopGraph = (from, len) =>
  `[0:a]atrim=start=${from + FADE_SEC}:duration=${len},${FMT}[body];[1:a]atrim=start=${from}:duration=${FADE_SEC},${FMT}[head];` +
  `[body][head]acrossfade=d=${FADE_SEC}:c1=qsin:c2=qsin`

/** Two-pass loudnorm: measure, then apply one fixed gain so the recording keeps its natural dynamics. */
function encode(input, graph, dest) {
  const inputArgs = [...input, ...input]
  const measure = run([...inputArgs, '-filter_complex', `${graph},loudnorm=I=${TARGET_LUFS}:TP=-3:LRA=20:print_format=json`, '-f', 'null', '-'])
  const json = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1))
  const norm = `loudnorm=I=${TARGET_LUFS}:TP=-3:LRA=20:linear=true:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}`
  run([...inputArgs, '-filter_complex', `${graph},${norm},aresample=48000`, '-c:a', 'libvorbis', '-q:a', '3', '-y', dest])
}

const src = process.argv[2]
if (!src) {
  console.error('Pakai: node scripts/ambience-pack.cjs <folder unduhan>')
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })
const files = fs.readdirSync(src)
for (const s of SOURCES) {
  const f = files.find((x) => x.startsWith(`${s.id}_`) || x.startsWith(`${s.id}.`))
  if (!f) {
    console.log(`lewati ${s.name}: file ${s.id} tidak ada`)
    continue
  }
  const file = path.join(src, f)
  const total = durationOf(file)
  // Skip the first seconds: recordings often start with handling noise.
  const from = total > 60 ? 4 : 0.5
  const len = Math.floor(Math.min(MAX_SEC, total - from - FADE_SEC - 0.5))
  encode(['-i', file], loopGraph(from, len), path.join(out, `${s.name}.ogg`))
  console.log(`${s.name}: ${len} dtk dari ${Math.round(total)} dtk`)
}

// Noise made here: a minute of each colour, looped the same way.
for (const color of ['white', 'pink', 'brown']) {
  encode(['-f', 'lavfi', '-i', `anoisesrc=color=${color}:amplitude=0.3:duration=${60 + FADE_SEC + 1}:sample_rate=48000:seed=7`], loopGraph(0.5, 60), path.join(out, `${color}noise.ogg`))
  console.log(`${color}noise: 60 dtk`)
}

const credits = [
  'Story Creator ambience library (resources/sfx/ambience)',
  '',
  'Recordings from Freesound (https://freesound.org), all released under Creative Commons 0 (CC0 1.0,',
  'https://creativecommons.org/publicdomain/zero/1.0/). Credit is not required; it is given as thanks.',
  'They were trimmed to seamless loops and loudness-matched for this app.',
  '',
  ...SOURCES.map((s) => `${s.name}.ogg  "${s.title}" by ${s.author}  https://freesound.org/s/${s.id}/`),
  '',
  'whitenoise.ogg, pinknoise.ogg, brownnoise.ogg: generated with FFmpeg for Story Creator, released under CC0.',
  ''
].join('\n')
fs.writeFileSync(path.join(root, 'resources', 'licenses', 'Freesound-ambience-CC0.txt'), credits)
console.log('selesai')
