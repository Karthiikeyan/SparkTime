import { SearchTrigger } from "@/components/search/search-trigger";
import type { NavItem } from "@/server/services/navigation";
import type { Brand } from "@/server/services/settings";
import { MobileMenu } from "./mobile-menu";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

/**
 * Wordmark, the primary menu (Studio → Navigation), search and the theme. Below
 * a laptop width the menu and the theme move into the menu dialog, leaving the
 * wordmark, a search button and the menu button, each 44px.
 */
export function Header({ primary, secondary, search, brand }: { primary: NavItem[]; secondary: NavItem[]; search: boolean; brand: Pick<Brand, "name" | "byline"> }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="container-page flex min-h-16 items-center justify-between gap-4 py-1.5 lg:min-h-18">
        <Wordmark name={brand.name} byline={brand.byline} />
        <div className="flex items-center gap-1 lg:gap-3">
          <nav aria-label="Primary" className="hidden lg:block">
            <NavLinks items={primary} />
          </nav>
          {search && (
            <>
              <SearchTrigger />
              <SearchTrigger compact />
            </>
          )}
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
          <MobileMenu items={primary} extra={secondary} />
        </div>
      </div>
    </header>
  );
}
