/**
 * Content rules for every picture and video the app makes: faces of people and animals are never shown,
 * and women are dressed modestly. The rules go into every prompt (so most images are composed without
 * faces), and a face check after generation blurs anything that still shows (see main/censor.ts).
 */

export type CensorStyle = 'blur' | 'mosaic'

export interface ContentRules {
  /** No visible faces of people or animals: composed away in the prompt, then censored if one still shows. */
  hideFaces: boolean
  /** How a face that still shows is covered. */
  censorStyle: CensorStyle
  /** Women and girls wear loose clothing that covers arms and legs. */
  modestWomen: boolean
  /** Women and girls also wear a hijab. */
  hijab: boolean
}

export const DEFAULT_CONTENT_RULES: ContentRules = { hideFaces: true, censorStyle: 'blur', modestWomen: true, hijab: false }

export function normalizeRules(r?: Partial<ContentRules> | null): ContentRules {
  const v = r && typeof r === 'object' ? r : {}
  return {
    hideFaces: typeof v.hideFaces === 'boolean' ? v.hideFaces : DEFAULT_CONTENT_RULES.hideFaces,
    censorStyle: v.censorStyle === 'mosaic' ? 'mosaic' : 'blur',
    modestWomen: typeof v.modestWomen === 'boolean' ? v.modestWomen : DEFAULT_CONTENT_RULES.modestWomen,
    hijab: typeof v.hijab === 'boolean' ? v.hijab : DEFAULT_CONTENT_RULES.hijab
  }
}

// Image models follow what to show far better than what to leave out, so the rules describe the picture
// they want (from behind, silhouettes, hands) and only then name what must not be visible.
const FACES =
  'Faces are never shown, for people and animals alike. Show every person and animal from behind, from the side with the head turned away, as a dark silhouette against the light, with the face hidden in deep shadow or under a hood, hat brim or hair, cropped at the shoulders, or show only hands, feet, paws, tails and objects. No front views and no portraits. Eyes, nose, mouth and muzzle are not visible.'
const FACES_SHORT = 'All people and animals seen from behind or as silhouettes; no faces, eyes or mouths visible.'

function modestText(r: ContentRules): string {
  const base =
    'Every woman and girl wears modest, loose clothing that covers the arms to the wrists and the legs to the ankles, with a high neckline; nothing tight, short, sheer or revealing, no swimwear'
  return r.hijab ? `${base}, and a hijab (headscarf) that covers the hair, ears and neck.` : `${base}.`
}
function modestShort(r: ContentRules): string {
  return r.hijab ? 'Women in loose modest clothing covering arms and legs, with a hijab.' : 'Women in loose modest clothing covering arms and legs.'
}

/** The rules as one paragraph for a text-to-image prompt; empty when no rule is on. */
export function imageRules(r: ContentRules): string {
  const parts = [r.hideFaces && FACES, r.modestWomen && modestText(r)].filter(Boolean)
  return parts.length ? `Content rules, follow strictly: ${parts.join(' ')}` : ''
}

/** A one-line version for models with short prompt limits. */
export function imageRulesShort(r: ContentRules): string {
  return [r.hideFaces && FACES_SHORT, r.modestWomen && modestShort(r)].filter(Boolean).join(' ')
}

/** Words for the "must not appear" list of an image prompt. */
export function avoidTerms(r: ContentRules): string[] {
  const out: string[] = []
  if (r.hideFaces) out.push('visible faces', 'eyes', 'facial features', 'front-facing portraits')
  if (r.modestWomen) out.push('revealing clothing', 'bare shoulders', 'short skirts')
  return out
}

/** Extra numbered rules for the storyboard writer (the LLM that describes each scene). */
export function storyboardRules(r: ContentRules, startAt: number): string[] {
  const out: string[] = []
  let n = startAt
  if (r.hideFaces)
    out.push(
      `${n++}. NO VISIBLE FACES, for people and animals alike. Choose framing that hides every face: from behind, over the shoulder from behind, side view with the head turned away, silhouettes against a window or the sky, faces in deep shadow or under a hood, hat or hair, crops at the shoulders, or close-ups of hands, feet, paws or objects. In "action" say for every person and animal how the face is hidden (for example "seen from behind"). Never write a facial expression; show emotion through posture, hands and the setting instead. In "identity" describe hair, build and skin but not facial features. Add "visible faces" to "avoid". In "motion" nobody turns toward the camera.`
    )
  if (r.modestWomen)
    out.push(
      `${n++}. Every woman and girl, including extras, wears modest, loose clothing that covers the arms to the wrists and the legs to the ankles, with a high neckline${r.hijab ? ', and a hijab that covers the hair and neck' : ''}. Describe it that way in "outfit" and "wardrobe", even for historical, sports, beach or party scenes.`
    )
  return out
}

/** How the three views of a character sheet are drawn, replacing the usual front / three-quarter / side views. */
export function sheetViews(r: ContentRules): string {
  if (!r.hideFaces)
    return 'Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, evenly spaced'
  return 'Show the SAME character three times side by side: back view, three-quarter back view and side view with the head turned away, full body, neutral standing pose, evenly spaced. The face is never visible in any view'
}

/** A sentence appended to every AI video prompt. */
export function videoRules(r: ContentRules): string {
  const parts: string[] = []
  if (r.hideFaces) parts.push('Every person and animal keeps the face turned away from the camera for the whole clip; nobody turns toward the camera and no face becomes visible.')
  if (r.modestWomen) parts.push(`Women stay fully and modestly dressed${r.hijab ? ', with a hijab' : ''}.`)
  return parts.join(' ')
}

// Some art styles describe faces themselves (the stickman style asks for dot eyes and a mouth). With faces
// hidden those phrases are swapped for faceless ones, so the style and the rules never pull against each other.
const FACE_SWAPS: [RegExp, string][] = [
  [/with minimal cartoon faces \([^)]*\)/gi, 'that are completely blank (no eyes, no mouth, no facial features at all)'],
  [/big expressive faces/gi, 'expressive body language'],
  [/an expressive face/gi, 'expressive body language'],
  [/documentary portrait of/gi, 'documentary photo of'],
  [/simple geometric features/gi, 'simple geometric shapes']
]

/** A style prompt or character hint with its face descriptions removed when faces are hidden. */
export function faceSafe(text: string, r: ContentRules): string {
  if (!r.hideFaces) return text
  return FACE_SWAPS.reduce((t, [re, to]) => t.replace(re, to), text)
}
