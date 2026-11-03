// ============================================================================
// MODERATION (v2.69)
//   Keeps slurs, swearing and sexual words out of what other players may see:
//   airline names, callsigns, livery names and text painted on aircraft.
//   Text is normalised first (case, accents, 0→o, 4→a, $→s…, spaces and dots
//   between letters, repeated letters), then checked against two lists:
//   words that are never fine anywhere in a name, and short words only
//   blocked on their own (so Scunthorpe, cockpit, Sussex and grape pass).
//   The lists are stored ROT13 so the source reads cleanly. The server will
//   check again once names and liveries are shared.
// ============================================================================

const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const ANYWHERE = ["shpx", "fuvg", "phag", "ovgpu", "avttre", "avttn", "snttbg", "ergneq", "juber", "fyhg", "chffl", "cravf", "intvan", "uvgyre", "anmv", "cbea", "gjng", "jnax", "obyybpx", "nffubyr", "onfgneq", "gvggvrf", "qvyqb", "betnfz", "xvxr", "genaal", "jrgonpx", "wvmm", "zbgures", "oybjwbo", "unaqwbo", "pbpxfhpx", "qvpxurnq", "chgn", "zvreqn", "chgnva", "pnoeba", "fpurvffr", "xhejn", "uragnv", "kkk", "crqb", "cnrqb", "zbyrfg", "vfvf", "wvunq", "urvy"].map(rot13);
const ALONE = new Set(["nff", "nefr", "phz", "gvg", "gvgf", "qvpx", "qvpxf", "pbpx", "pbpxf", "snt", "sntf", "encr", "encrq", "encvfg", "frk", "frkl", "nany", "nahf", "fcvp", "puvax", "tbbx", "qlxr", "pbba", "cvff", "obbo", "obbof", "xxx", "afsj", "zvys", "gubg", "ubr", "ubrf", "fxnax", "arteb", "wnc", "xlf"].map(rot13));

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g' };

function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0-9!|@$+]/g, (c) => LEET[c] ?? c);
}
const squeeze = (s: string) => s.replace(/(.)\1+/g, '$1');
/** Real words and places that contain a blocked word (they're taken out before checking). */
const FINE = ['scunthorpe', 'matsushita', 'shiitake', 'shitake', 'penistone', 'cockburn', 'hancock', 'peacock', 'babcock', 'shuttlecock', 'woodcock', 'cockpit', 'dickens', 'dickson', 'essex', 'sussex', 'wessex', 'middlesex', 'cumbria', 'cumberland', 'cummings', 'scuttle', 'therapist', 'analys', 'hitchcock', 'pistol', 'nazir', 'xxxl'];
const unFine = (s: string) => FINE.reduce((t, w) => t.split(w).join(' '), s);
const NOPE = 'That has a word we don’t allow. Please choose something else.';

/** null when the text is fine, else a short reason to show the player. */
export function moderate(text: string): string | null {
  if (!text.trim()) return null;
  const n = unFine(normalise(text));
  const letters = n.replace(/[^a-z]/g, '');
  const forms = [letters, squeeze(letters)];
  // squeezed forms catch "fuuuck"; a word that squeezes too short (xxx) is checked as it is
  for (const w of ANYWHERE) if (forms.some((f) => f.includes(w) || (squeeze(w).length >= 4 && f.includes(squeeze(w))))) return NOPE;
  const words = n.split(/[^a-z]+/).filter(Boolean);
  // letters spaced or dotted out ("a s s", "a.s.s") count as one word
  const spelled = n
    .split(/\s{2,}|[^a-z\s.\-_*]+/)
    .filter((x) => /^[a-z]([\s.\-_*]+[a-z])+$/.test(x.trim()))
    .map((x) => x.replace(/[^a-z]/g, ''));
  for (const w of [...words, ...spelled, ...words.map(squeeze)]) if (ALONE.has(w)) return NOPE;
  return null;
}
