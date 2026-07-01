import { Link, useLocation } from "react-router-dom";

export default function NotFoundView() {
  const { pathname } = useLocation();
  return (
    <div className="py-12 text-center font-mono text-ink-2">
      <p>Nothing at {pathname}.</p>
      <Link to="/" className="text-ink-1 hover:text-ink-0">
        ‹ all events
      </Link>
    </div>
  );
}
