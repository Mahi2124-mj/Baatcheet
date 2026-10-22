export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="ios-bar safe-t sticky top-0 z-10 flex items-end justify-between border-b border-line/60 px-4 pb-2 pt-3 sm:px-6">
      {/* iOS large title */}
      <h1 className="text-[34px] font-bold leading-tight tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
