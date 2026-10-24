'use client';
// Picks the bubble colour and wallpaper, for all chats (Settings) or one chat (chat menu), with a preview.
import { Check } from 'lucide-react';
import { BUBBLES, WALLPAPERS, bubbleColor, hasOwnTheme, setTheme, useChatTheme } from '@/lib/chatTheme';
import { cx } from '@/lib/format';
import { Button } from '@/components/ui';

export function ChatThemePicker({ conversationId }: { conversationId?: string }) {
  const theme = useChatTheme(conversationId);
  const own = conversationId ? hasOwnTheme(conversationId) : false;
  const pick = (t: Parameters<typeof setTheme>[1]) => setTheme(conversationId ?? null, t);

  return (
    <div className="space-y-5 py-2">
      {/* Preview */}
      <div className={cx('overflow-hidden rounded-2xl border border-line p-3', `wp-${theme.wallpaper}`)} style={{ '--bubble-me': bubbleColor(theme.bubble) } as React.CSSProperties}>
        <div className="flex justify-start">
          <span className="rounded-[18px] rounded-bl-[6px] bg-bubble-them px-3 py-1.5 text-[15px] text-bubble-them-ink">Kal milte hain?</span>
        </div>
        <div className="mt-1.5 flex justify-end">
          <span className="rounded-[18px] rounded-br-[6px] bg-bubble-me px-3 py-1.5 text-[15px] text-white">Haan, 5 baje 👍</span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Your bubbles</p>
        <div className="grid grid-cols-8 gap-2">
          {BUBBLES.map((b) => (
            <button
              key={b.id}
              aria-label={b.name}
              aria-pressed={theme.bubble === b.id}
              onClick={() => pick({ bubble: b.id })}
              className="flex aspect-square items-center justify-center rounded-full ring-offset-2 ring-offset-panel"
              style={{ background: b.color, boxShadow: theme.bubble === b.id ? `0 0 0 2px var(--panel), 0 0 0 4px ${b.color}` : undefined }}
            >
              {theme.bubble === b.id && <Check className="size-4 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Wallpaper</p>
        <div className="grid grid-cols-3 gap-2">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              aria-pressed={theme.wallpaper === w.id}
              onClick={() => pick({ wallpaper: w.id })}
              className={cx('relative h-20 overflow-hidden rounded-xl border-2', `wp-${w.id}`, theme.wallpaper === w.id ? 'border-accent' : 'border-line')}
            >
              <span className="absolute inset-x-0 bottom-0 bg-black/35 py-0.5 text-[12px] text-white">{w.name}</span>
            </button>
          ))}
        </div>
      </div>

      {conversationId && own && (
        <Button variant="ghost" size="sm" onClick={() => pick(null)}>
          Use the same theme as other chats
        </Button>
      )}
    </div>
  );
}
