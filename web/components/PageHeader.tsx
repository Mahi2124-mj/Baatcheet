export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="safe-t sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-4 backdrop-blur sm:px-6">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
