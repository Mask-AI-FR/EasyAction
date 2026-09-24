EasyActions — Logo Asset Pack v2
================================

Redesign of EasyActions-Logo-Pack.zip (v1), 24 September 2026.
Same idea and same green palette as v1: a gear (automation) with a forward arrow
(pipeline flow). The drawing is rebuilt from exact geometry for a cleaner,
more professional finish.

WHAT CHANGED FROM V1
--------------------
- Gear: 10 identical teeth on an exact circular construction, rounded corners.
  (v1: 12 teeth placed by hand, uneven in width and angle.)
- Arrow: a bold rounded arrow with clear space inside the dark core.
  (v1: a block arrow touching the edge of its circle.)
- No drop shadow: it blurred at small sizes and prints as a grey smudge.
- 16 and 32 px have their own drawing: 6 teeth, a thicker ring and a chevron,
  because at that size the full arrow looked like a "+".
- Wordmark set in Inter Bold with tighter spacing, converted to outlines:
  the SVG files open the same everywhere, no font needed. (v1: live Arial text.)
- Tagline colour #047857 on white: contrast 5.5:1. (v1: #22C55E, 2.3:1, hard to read.)
- New: a maskable app icon (full-bleed background, symbol inside the 80 % safe zone)
  for installed web apps and Android, and an SVG favicon.

FOLDER STRUCTURE
----------------
/svg/
  easyactions-icon-dark.svg                main app icon, dark green background
  easyactions-icon-light.svg               app icon, white background
  easyactions-icon-small-dark.svg          simplified drawing for 16–32 px, dark
  easyactions-icon-small-light.svg         simplified drawing for 16–32 px, white
  easyactions-icon-maskable.svg            full-bleed icon; the system crops it
  easyactions-mark.svg                     the symbol alone, transparent background
  easyactions-logo-horizontal.svg          symbol + wordmark + tagline, transparent
  easyactions-logo-horizontal-white-bg.svg same, white background
  easyactions-logo-horizontal-dark.svg     same, on dark green (#052E1C)
/png/app-icons/dark/      16, 32 (small drawing), 48, 64, 128, 192, 256, 512, 1024 px
/png/app-icons/light/     the same sizes, white background
/png/app-icons/maskable/  192 and 512 px
/png/logo/                horizontal logo, 700 / 1400 / 2400 px wide, three versions
/favicon/favicon.ico      16, 32, 48, 64 px
/favicon/favicon.svg      vector favicon (small drawing)
/preview.png              the whole pack on one page

USAGE
-----
- Main app icon: the dark version. Use the light one where a white tile is expected.
- 16–32 px (browser tab, small lists): use the "small" drawings, made for that size.
- Clear space: at least a quarter of the symbol's height on every side.
- Minimum size: icon 16 px; horizontal logo 500 px wide (below, the tagline is
  unreadable: use the symbol alone).
- Do not recolour, stretch, rotate, add effects or retype the wordmark.

COLOURS
-------
Gear gradient   #6EE7A8 -> #22C55E -> #047857 (top left to bottom right)
Background      #052E1C     Core  #065F32     Arrow  #FFFFFF
On light        "Easy" #052E1C, "Actions" #16A34A, tagline #047857
On dark         "Easy" #FFFFFF, "Actions" #4ADE80, tagline #86EFAC

TYPEFACE
--------
Inter by Rasmus Andersson — Bold (wordmark) and SemiBold (tagline) —
SIL Open Font License 1.1. The text in these files is already converted to outlines.
