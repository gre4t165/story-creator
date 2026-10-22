import { getImageModel } from './higgsfield'
import type { AspectRatio, FreeImageProvider, ModelOption } from './types'

/**
 * Image models called directly instead of through Higgsfield: Cloudflare Workers AI (a free daily allowance on
 * a free account), Pollinations (free daily "pollen" with a free key), and Google's Nano Banana models on the
 * Gemini key (cheap, but the Gemini API has no free tier for images, so it needs billing on the key's project).
 * They draw clip images and character sheets only; AI video still needs Higgsfield, while camera moves on a
 * still image stay free in the editor.
 *
 * Their ids are stored in `Project.imageModel` next to Higgsfield endpoint ids. The prefix before the slash
 * is the provider, so the two kinds never collide. The file keeps its "free" names from when every model in
 * it was free; `free` on each model says whether it still is.
 */

export interface FreeImageModel {
  id: string
  provider: FreeImageProvider
  /** What the provider calls the model (empty: let the provider choose its default). */
  remote: string
  name: string
  family: string
  description: string
  tags: string[]
  /** Longest prompt sent; longer prompts fall back to the shorter scene-first version. */
  promptLimit: number
  /** True when the provider draws at the size we ask for, false when it always returns a square. */
  sizable: boolean
  /** Longest side of the picture we ask for, when `sizable`. */
  longSide: number
  /** False for models billed per picture (Gemini); the picker and cost line say so. */
  free: boolean
  /** How many character sheets it takes as references. 0: none, so sheets are not drawn for it. */
  refs: number
  /** Gemini's output size ("1K", "2K"), for models that take one. */
  imageSize?: string
  /** One line on cost or allowance, shown under the picker. */
  note: string
}

export const FREE_PROVIDER_NAMES: Record<FreeImageProvider, string> = { cloudflare: 'Cloudflare Workers AI', pollinations: 'Pollinations', gemini: 'Google Gemini' }

export const FREE_IMAGE_MODELS: FreeImageModel[] = [
  {
    id: 'cloudflare/flux-1-schnell',
    provider: 'cloudflare',
    remote: '@cf/black-forest-labs/flux-1-schnell',
    name: 'FLUX.1 schnell',
    family: 'Cloudflare',
    description: 'Gambar paling bagus di antara pilihan gratis. Hasilnya persegi 1:1, jadi editor memotongnya ke 16:9 atau 9:16.',
    tags: ['Gratis', 'Cloudflare'],
    promptLimit: 1900,
    sizable: false,
    longSide: 1024,
    free: true,
    refs: 0,
    note: '± 170 gambar per hari'
  },
  {
    id: 'cloudflare/sdxl-lightning',
    provider: 'cloudflare',
    remote: '@cf/bytedance/stable-diffusion-xl-lightning',
    name: 'SDXL Lightning',
    family: 'Cloudflare',
    description: 'Cepat dan langsung dibuat dalam ukuran 16:9 atau 9:16. Detailnya di bawah FLUX, dan masih berstatus beta di Cloudflare.',
    tags: ['Gratis', 'Cloudflare', 'Beta'],
    promptLimit: 1900,
    sizable: true,
    longSide: 1024,
    free: true,
    refs: 0,
    note: 'Beta, tidak ditagih per langkah'
  },
  {
    id: 'pollinations/default',
    provider: 'pollinations',
    remote: '',
    name: 'Pollinations (model gratis bawaan)',
    family: 'Pollinations',
    description: 'Eksperimental. Pollinations memilih model gratisnya sendiri. Butuh kunci gratis, dan jatah hariannya kecil.',
    tags: ['Gratis', 'Pollinations', 'Eksperimental'],
    promptLimit: 1500,
    sizable: true,
    longSide: 1024,
    free: true,
    refs: 0,
    note: 'jatah harian kecil'
  },
  {
    id: 'gemini/gemini-nano-banana-2.1',
    provider: 'gemini',
    remote: 'gemini-nano-banana-2.1',
    name: 'Nano Banana 2.1',
    family: 'Gemini',
    description: 'Model gambar Google terbaru lewat kunci Gemini. Langsung 16:9 atau 9:16, dan memakai lembar karakter supaya tokoh konsisten.',
    tags: ['Murah', 'Gemini', 'Referensi'],
    promptLimit: 4000,
    sizable: true,
    longSide: 2048,
    free: false,
    refs: 6,
    imageSize: '2K',
    note: '± $0,05 per gambar 2K, ditagih Google ke akun Gemini-mu'
  },
  {
    id: 'gemini/gemini-3-pro-image',
    provider: 'gemini',
    remote: 'gemini-3-pro-image',
    name: 'Nano Banana Pro',
    family: 'Gemini',
    description: 'Kualitas tertinggi dari Google, paling rapi untuk tulisan dan detail. Lebih mahal dan lebih lambat dari Nano Banana 2.1.',
    tags: ['Gemini', 'Referensi', '4K'],
    promptLimit: 4000,
    sizable: true,
    longSide: 2048,
    free: false,
    refs: 6,
    imageSize: '2K',
    note: '± $0,13 per gambar 2K, ditagih Google ke akun Gemini-mu'
  },
  {
    id: 'gemini/gemini-2.5-flash-image',
    provider: 'gemini',
    remote: 'gemini-2.5-flash-image',
    name: 'Nano Banana (2.5 Flash Image)',
    family: 'Gemini',
    description: 'Nano Banana generasi pertama. Masih bisa dipakai kalau model yang lebih baru belum tersedia untuk kuncimu.',
    tags: ['Gemini', 'Referensi'],
    promptLimit: 4000,
    sizable: true,
    longSide: 1024,
    free: false,
    refs: 3,
    note: '± $0,04 per gambar, ditagih Google ke akun Gemini-mu'
  }
]

export const DEFAULT_FREE_IMAGE_MODEL = 'cloudflare/flux-1-schnell'

export function getFreeImageModel(id: string | null | undefined): FreeImageModel | undefined {
  return id ? FREE_IMAGE_MODELS.find((m) => m.id === id) : undefined
}

/** Any image model id the app knows, free or Higgsfield; unknown ids fall back to the Higgsfield default. */
export function resolveImageModelId(id: string | null | undefined): string {
  return getFreeImageModel(id)?.id ?? getImageModel(id).id
}

/** The picture size to ask for: the frame's shape on a long side, in multiples of 16 (models need that). */
export function freeImageSize(aspect: AspectRatio, longSide: number): { width: number; height: number } {
  const short = Math.round((longSide * 9) / 16 / 16) * 16
  return aspect === '16:9' ? { width: longSide, height: short } : { width: short, height: longSide }
}

/** Picker rows for the direct models, tagged so the picker can filter them. */
export function freeImageOptions(): ModelOption[] {
  return FREE_IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    description: m.description,
    tags: m.tags
  }))
}
