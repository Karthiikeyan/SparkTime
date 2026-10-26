import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import type { Brand } from "@/server/services/settings";
import { BrandMark } from "./brand-mark";
import type { NavItem } from "@/server/services/navigation";

const heading = "caps text-muted";
const linkClass = "inline-flex min-h-11 items-center text-[0.9375rem] text-ink hover:text-muted";

/**
 * The name and what it is, then the footer menu (Studio → Navigation, one
 * column per group) and a Follow column built from the social links in
 * site-config.ts plus the feed.
 */
export function Footer({ groups, rss, brand, startHere = false, sparktribe = false }: { groups: NavItem[]; rss: boolean; brand: Brand; startHere?: boolean; sparktribe?: boolean }) {
  const year = new Date().getFullYear();
  const follow = [
    ...brand.social.map((s) => ({ id: s.id, label: s.label, href: s.url, external: true })),
    ...(sparktribe ? [{ id: "sparktribe", label: "SparkTribe", href: siteConfig.sparktribeHref, external: false }] : []),
    ...(rss ? [{ id: "rss", label: "RSS", href: "/feed.xml", external: false }] : []),
  ];
  return (
    <footer className="mt-24 border-t border-line bg-bg-tint">
      <div className="container-page flex flex-wrap justify-between gap-x-12 gap-y-10 pb-10 pt-14">
        <div className="max-w-xs">
          <p className="flex items-center gap-2.5 font-serif text-[1.625rem] font-semibold tracking-[-0.02em]">
            <BrandMark className="h-8 shrink-0" />
            {brand.name}
          </p>
          <p className="mt-2.5 text-[0.9375rem] text-muted">{brand.tagline}</p>
          {startHere && (
            <Link href="/start-here" className="mt-2 inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-accent-ink hover:underline">
              New here? Start here →
            </Link>
          )}
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-16 gap-y-8">
          {groups.map((group) => (
            <div key={group.id}>
              <h2 className={heading}>{group.label}</h2>
              <ul className="mt-3">
                {(group.children.length ? group.children : [group]).map((item) =>
                  item.href ? (
                    <li key={item.id}>
                      <Link href={item.href} className={linkClass} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {item.label}
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ))}
          <div>
            <h2 className={heading}>Follow</h2>
            <ul className="mt-3">
              {follow.map((item) => (
                <li key={item.id}>
                  {item.external ? (
                    <a href={item.href} className={linkClass} rel="me noopener noreferrer" target="_blank">
                      {item.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : item.href.startsWith("/") && item.id !== "rss" ? (
                    <Link href={item.href} className={linkClass}>
                      {item.label}
                    </Link>
                  ) : (
                    <a href={item.href} className={linkClass}>
                      {item.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
      <div className="container-page">
        <p className="flex flex-wrap justify-between gap-3 border-t border-line-strong py-6 text-sm text-muted">
          <span>
            © {year} {brand.name} · {brand.author}
          </span>
          <span>Free to read. No sign-up.</span>
        </p>
      </div>
    </footer>
  );
}
