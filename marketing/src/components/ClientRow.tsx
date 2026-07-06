// "A snapshot of clients" — names for now, swap for logos when supplied.
export default function ClientRow({ clients }: { clients: string[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
      {clients.map((name) => (
        <div
          key={name}
          className="aspect-square rounded-full border border-bgp-line flex items-center justify-center text-center px-3 text-[10px] font-semibold uppercase tracking-widest text-bgp-ink/60"
        >
          {name}
        </div>
      ))}
    </div>
  );
}
