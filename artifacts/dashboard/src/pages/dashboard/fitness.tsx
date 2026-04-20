import { BASE } from "@/lib/base-url";

export default function FitnessPage() {
  const src = `${BASE}fitness-app.html`;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <iframe
        src={src}
        className="flex-1 w-full border-0"
        title="Actividad Física"
        allow="fullscreen"
      />
    </div>
  );
}
