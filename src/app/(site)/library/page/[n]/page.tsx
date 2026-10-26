import type { Metadata } from "next";
import { LibraryPage, libraryMetadata, type LibrarySearchParams } from "../../_library";

type Props = { params: Promise<{ n: string }>; searchParams: LibrarySearchParams };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return libraryMetadata((await params).n, searchParams);
}

export default async function LibraryPageN({ params, searchParams }: Props) {
  return <LibraryPage raw={(await params).n} searchParams={searchParams} />;
}
