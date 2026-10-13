import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        It does not exist or you do not have access to it.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
