import Link from 'next/link';
import { MessageCircle, Phone, Shield, Users, Video } from 'lucide-react';
import { Logo } from '@/components/Logo';

const features = [
  { icon: MessageCircle, title: 'Real-time chat', text: 'Messages, replies, reactions, photos, videos, voice notes and documents — delivered instantly with read receipts.' },
  { icon: Phone, title: 'Voice calls', text: 'Crystal-clear calls straight from the browser, with mute, call history and missed-call alerts.' },
  { icon: Video, title: 'Video calls', text: 'Face-to-face calls with camera switching, full screen and picture-in-picture.' },
  { icon: Users, title: 'Groups', text: 'Group chats with admins, invite links and group voice/video calls.' },
  { icon: Shield, title: 'Privacy controls', text: 'Choose who sees your last seen and profile, who can message you, and block anyone.' },
];

export default function Landing() {
  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-hover">
            Log in
          </Link>
          <Link href="/register" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            Sign up
          </Link>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
          Talk to your people. <span className="text-accent">Anywhere.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">Baatcheet brings chat, voice calls and video calls together in one fast, private web app — on your phone, laptop or desktop.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-ink">
            Create free account
          </Link>
          <Link href="/login" className="rounded-xl border border-line px-6 py-3 font-semibold hover:bg-hover">
            I have an account
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-2xl border border-line bg-panel p-6">
            <f.icon className="size-7 text-accent" aria-hidden />
            <h2 className="mt-4 font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted">{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        <Link href="/help" className="hover:text-text">
          Help & support
        </Link>
        <span className="mx-2">·</span>
        Messages are encrypted in transit (HTTPS / TLS) and stored on our servers. They are not end-to-end encrypted.
      </footer>
    </main>
  );
}
