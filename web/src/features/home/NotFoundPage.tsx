import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted">There is no page at this address.</p>
      <Link to="/" className="text-accent underline">
        Back to Lizard
      </Link>
    </div>
  );
}
