import type { Metadata } from "next";
import { LibraryPage, libraryMetadata, type LibrarySearchParams } from "./_library";

type Props = { searchParams: LibrarySearchParams };

export const generateMetadata = ({ searchParams }: Props): Promise<Metadata> => libraryMetadata(undefined, searchParams);

export default function Library({ searchParams }: Props) {
  return <LibraryPage raw={undefined} searchParams={searchParams} />;
}
