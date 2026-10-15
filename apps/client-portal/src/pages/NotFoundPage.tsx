import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold text-navy-900">Page not found</h1>
      <p className="mt-2 text-sm text-navy-600">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-4 inline-block font-medium text-accent-700 underline">
        Back to your matters
      </Link>
    </div>
  );
}
