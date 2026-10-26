import { serializeJsonLd, type JsonLd as JsonLdData } from "@/lib/seo/json-ld";

/**
 * The only use of dangerouslySetInnerHTML with data in this codebase.
 * Safe because serializeJsonLd() escapes <, >, & and line separators, so no
 * value can terminate the <script> element; and application/ld+json is a
 * data block browsers never execute. Covered by tests/unit/seo-and-security.
 */
export function JsonLd({ data }: { data: JsonLdData }) {
  // eslint-disable-next-line react/no-danger -- audited: escaped JSON in a non-executable data block
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
