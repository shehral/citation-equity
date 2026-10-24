import Link from 'next/link';
import { textLink } from '@/components/page-shell';
import { VIEW_HREF } from '@/lib/views';

/** 404 inside the app shell, in the app's own tokens (Next's default page sets raw colours). */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-base sm:px-6">
      <h1 className="font-medium font-serif text-4xl tracking-tight">Page not found</h1>
      <p className="mt-4 text-ink-soft">
        <Link href={VIEW_HREF.home} prefetch={false} className={textLink}>
          Go to the home
        </Link>
      </p>
    </main>
  );
}
