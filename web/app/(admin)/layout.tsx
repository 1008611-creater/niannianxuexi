export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="h-[100dvh] overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[var(--background)] [-webkit-overflow-scrolling:touch]"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {children}
    </div>
  );
}
