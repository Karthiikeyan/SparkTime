import Link from "next/link";
import { TagLink, TagList } from "@/components/ui/pill";
import { categoryPath, tagPath } from "@/lib/content/paths";
import type { SocialLink } from "@/lib/site-config";

/** Tags as link pills under a small caps label. */
export function TagsBlock({ title, tags }: { title: string; tags: Array<{ id: string; name: string; slug: string }> }) {
  if (!tags.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="caps mb-2.5 text-muted">{title}</h2>
      <TagList>
        {tags.map((t) => (
          <li key={t.id}>
            <TagLink href={tagPath(t.slug)}>#{t.name}</TagLink>
          </li>
        ))}
      </TagList>
    </section>
  );
}

/** Other topics beside a topic page, each with its count of pieces. */
export function RelatedTopics({ topics }: { topics: Array<{ id: string; name: string; slug: string; count: number }> }) {
  if (!topics.length) return null;
  return (
    <section aria-labelledby="related-topics">
      <h2 id="related-topics" className="caps mb-1.5 text-muted">
        Related topics
      </h2>
      <ul>
        {topics.map((c) => (
          <li key={c.id} className="border-b border-line">
            <Link href={categoryPath(c.slug)} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-accent-ink">
              <span className="font-medium">{c.name}</span>
              <span className="text-sm text-muted">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where to follow along: the social links from the site config, and the RSS feed when it is on. */
export function GetNewGuides({ rss, social }: { rss: boolean; social: SocialLink[] }) {
  return (
    <section aria-labelledby="get-new-guides" className="rounded-lg bg-bg-tint p-5 sm:p-[22px]">
      <h2 id="get-new-guides" className="font-serif text-[1.375rem] font-medium">
        Get new guides
      </h2>
      <p className="mt-1.5 text-[0.9375rem] text-ink-2">Follow along on {social.map((s) => s.label).slice(0, 2).join(" and ")}{rss ? ", or subscribe with RSS" : ""}.</p>
      <ul className="mt-2.5 flex flex-wrap gap-x-4">
        {social.slice(0, 2).map((s) => (
          <li key={s.id}>
            <a href={s.url} rel="noopener" className="inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
              {s.label}
            </a>
          </li>
        ))}
        {rss && (
          <li>
            <a href="/feed.xml" className="inline-flex min-h-11 items-center font-semibold text-accent-ink hover:underline">
              RSS
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}
