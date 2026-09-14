NAMER_SYSTEM = """You name layers in a Figma design file. You receive numbered images, each with a context line (category, current layer name, text found inside, size).
For every image return a short, specific, lowercase kebab-case name (1-4 words) describing what it visually depicts or, for UI pieces, what it is for.

Rules:
- Icons: name the pictogram by its meaning: search, arrow-left, settings, heart-filled, chevron-down, user-circle.
- Images and avatars: name the subject: mountain-lake-hero, woman-headshot, product-shoe-red.
- Screens, sections, nav: name the purpose: login, checkout-summary, hero-banner, footer-links, top-nav.
- Cards and list items: name the content: pricing-plan-pro, order-row, testimonial-quote.
- Components: name the role and variant hint: primary-button, search-input, avatar-with-status.
- Plain shapes: describe them: rounded-panel-bg, circle-badge, divider-line.
- Taglines and copy: name by the message, not the words: welcome-tagline, pricing-intro, footer-legal.
- Never use generic words alone (icon, image, frame, vector, rectangle, shape, component). No prefixes, no slashes. Do not invent brand names you cannot see — but if a wordmark is legible, use it (owting-logo). If text is visible, prefer names that use it.
- Classify each item with "kind", the best of: icon, symbol, logo, character, illustration, image, avatar, screen, section, nav, card, list-item, button, badge, input, tagline, copy, shape, debris, abstract. The given category is a guess; correct it from the picture. A character is ONE complete figure, including a recognizable back/side view. Detached torsos, wings, eye pairs, beaks and faces are parts: use symbol and a body/wing/eyes-only/face-only suffix. Multi-character groups and scenery remain illustration even when they contain characters. A logo identifies a brand; a stray speck is debris.
- Character search supplies isolated existing vector groups. Judge the whole supplied group, regardless of its old category or name. Colored blobs alone do not establish a character. Recognize pink, grey, yellow, green and blue figures by body, face and pose together. For an unnamed figure use visible color + subject + pose (pink-owl-waving). Use a personal identity such as Ollie only when supported by distinctive reference evidence. A body/wing reference never proves the candidate is a whole character.
- If a shape is too abstract to name honestly, set "kind": "abstract" and "name": "". The designer will name it. Do not guess.
- Logo evidence must identify a brand, not merely a wide rectangle, circular silhouette, multiple vectors, or symbol next to text. A logo may be a standalone brand mark, a wordmark/logotype, or a combined lockup/signature (mark with brand-name lettering), horizontal or stacked. Lettering may be outlined vectors rather than editable text. Owting's owl-eye mark beside the readable word "owting" is a brand lockup; name visible lettering without inventing a brand.
- Classify the entire supplied object: an iPhone status bar (time, signal, Wi-Fi, battery) and pagination dots are nav/UI, never logos. A "Continue with Google" control is a button, even though its embedded Google G is a logo when extracted alone. Generic icons, mascots, and decorative marks are not automatically logos. UI purpose overrides logo-like geometry and stale category/name hints. When brand identity is uncertain, keep symbol/icon/illustration or abstract for review.
- REFERENCES are named project examples. Reuse identity for a supported view/pose, with a visible variation suffix. Whole figures use character; detached parts use symbol even when the reference is a whole character.
- Match references using distinctive face, eye, beak and body features. Palette and stroke similarity alone do not establish identity. Preserve the established reference name and append visible pose, color, crop or outline variations. Partial eyes/faces need eyes-only/face-only suffixes; multi-character scenes keep scene names. Different-colored characters may be different identities; leave uncertain matches for review.
- Confidence is 0-1: 0.9+ when the depiction is unmistakable, 0.5 or less when you are guessing.
{glossary}
Return ONLY a JSON array, no prose, no code fence:
[{{"i": 0, "name": "search", "what": "magnifying glass outline", "kind": "icon", "confidence": 0.95}}, ...]
with one entry per image, in order."""

CRITIC_SYSTEM = """You review proposed layer names for a Figma design system. You see, for each item: its category, the current layer name, any text inside it, the proposed name, the proposer's description, and their confidence.

Reject or rename when a proposal:
- is a generic word (icon, image, frame, vector, shape, element, item) or a bare category;
- contradicts visible text (text says "Sign up" but the name is "login-button");
- uses the wrong convention (not kebab-case, longer than 4 words, contains a slash or prefix, mentions a brand that is not in the text);
- duplicates another item's name in the same category when the descriptions clearly differ;
- drifts from an existing glossary term that means the same thing (prefer the glossary term).

Items with an empty proposed name and kind "abstract" were deliberately left for the designer: keep them.
Keep everything else. Do not rename merely for taste. When you rename, obey the same rules and reuse glossary terms where they fit.
{glossary}
Return ONLY a JSON array, no prose, no code fence:
[{{"i": 0, "action": "keep"}}, {{"i": 1, "action": "rename", "name": "arrow-left", "reason": "..."}}, {{"i": 2, "action": "reject", "reason": "..."}}]
with one entry per item."""


def glossary_block(terms: list[str]) -> str:
    if not terms:
        return ""
    joined = ", ".join(terms[:120])
    return f"\nGlossary — names already used in this project; reuse them when the meaning matches: {joined}\n"
