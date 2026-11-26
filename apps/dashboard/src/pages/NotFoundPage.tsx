import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold text-navy-900">Page not found</h1>
      <p className="mt-2 text-sm text-navy-600">That page does not exist.</p>
      <Link
        to="/"
        className="mt-4 inline-block text-sm inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        Back to overview
      </Link>
    </div>
  );
}
