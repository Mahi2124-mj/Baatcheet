import Link from 'next/link';

export function Logo({ href = '/chats' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-bold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" className="size-8" />
      <span className="text-lg">Baatcheet</span>
    </Link>
  );
}
