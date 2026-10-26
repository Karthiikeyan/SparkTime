import Link from "next/link";

export default function StudioNotFound() {
  return (
    <div className="px-6 py-24 text-center lg:px-10">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-2xl font-semibold">Nothing here</h1>
      <p className="mt-2 text-muted">That studio page doesn’t exist, or the document was deleted.</p>
      <Link href="/admin" className="btn btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  );
}
