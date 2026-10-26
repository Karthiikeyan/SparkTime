/**
 * The recommended public menus. One definition shared by the seed (a new site),
 * Studio -> Navigation's "Use recommended menu" (an existing site, applied by the
 * owner) and `npm run apply-ia`.
 *
 * Primary is Courses, Interviews, Library, Money and About, with no dropdowns.
 * The footer has two columns, Learn and About; its Follow column and the
 * "Start here" invitation are drawn from the site config. Every link is a plain
 * site path: menus hide a link whose section is empty or whose page isn't
 * published, so the menu grows with the site.
 */

export type PresetLink = { label: string; href: string };
export type PresetGroup = { label: string; children: PresetLink[] };

export const RECOMMENDED_PRIMARY: PresetLink[] = [
  { label: "Courses", href: "/course" },
  { label: "Interviews", href: "/interviews" },
  { label: "Library", href: "/library" },
  { label: "Money", href: "/money" },
  { label: "About", href: "/about" },
];

export const RECOMMENDED_FOOTER: PresetGroup[] = [
  {
    label: "Learn",
    children: [
      { label: "Courses", href: "/course" },
      { label: "Interviews", href: "/interviews" },
      { label: "Library", href: "/library" },
      { label: "All topics", href: "/topics" },
    ],
  },
  {
    label: "About",
    children: [
      { label: "About", href: "/about" },
      { label: "Now", href: "/now" },
      { label: "Notes", href: "/notes" },
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy-policy" },
    ],
  },
];
