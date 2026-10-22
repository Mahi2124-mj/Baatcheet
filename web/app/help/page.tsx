import Link from 'next/link';
import { Logo } from '@/components/Logo';

const faq = [
  ['I can’t make calls — “allow microphone/camera”', 'Your browser blocked access. Click the lock icon next to the address bar → Site settings → allow Camera and Microphone, then reload. On iPhone: Settings → Safari → Camera / Microphone → Allow.'],
  ['Calls connect but there’s no sound or video', 'Some networks (offices, mobile carriers) block direct connections. The server then relays the call (TURN). If it still fails, try another network and tell the site admin — the TURN server may not be set up.'],
  ['Call audio: earpiece, speaker or Bluetooth?', 'Voice calls start on the phone earpiece (like a normal call) and video calls on the speaker. Tap the speaker button during the call to switch. With Bluetooth or headphones connected, the call uses them automatically, and the same button lets you choose Phone / Speaker / Bluetooth. On iPhone, Safari doesn’t let websites switch: use the audio button in Control Center.'],
  ['Will my phone ring if the site is closed?', 'Not like a phone call. Browsers can’t keep a call ringing when the tab is closed or the phone is asleep. If you enabled push notifications, you get a notification instead; tap it to open the chat and call back. Keep a tab open or install the app to the home screen to answer instantly.'],
  ['Are my messages end-to-end encrypted?', 'No. Everything is encrypted in transit (HTTPS/TLS; calls use DTLS-SRTP), and messages are stored on our servers so they sync to all your devices. Admins can’t read chats; reported messages are shared with moderators.'],
  ['I didn’t get the verification e-mail', 'Check spam, then use “Resend link” from the banner in the app. Links work for 48 hours.'],
  ['How do I block or report someone?', 'Open their profile or the chat info panel → Block or Report. To report a single message, right-click (or long-press) it → Report.'],
  ['How do I delete my account?', 'Settings → Danger zone → Delete my account.'],
];

export default function Help() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      <Logo />
      <h1 className="mt-8 text-3xl font-bold">Help & support</h1>
      <div className="mt-6 space-y-3">
        {faq.map(([q, a]) => (
          <details key={q} className="rounded-2xl border border-line bg-panel p-5">
            <summary className="cursor-pointer font-medium">{q}</summary>
            <p className="mt-3 text-sm text-muted">{a}</p>
          </details>
        ))}
      </div>
      <section className="mt-8 rounded-2xl border border-line bg-panel p-5 text-sm">
        <h2 className="font-semibold">Still stuck?</h2>
        <p className="mt-2 text-muted">Use “Report” inside the app for abuse, or contact the people who run this Baatcheet server. Include your browser, device and what happened.</p>
      </section>
      <p className="mt-8 text-sm"><Link href="/chats" className="text-accent">← Back to Baatcheet</Link></p>
    </main>
  );
}
