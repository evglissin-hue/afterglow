import { Suspense } from "react";
import SpotDetails from "@/app/_components/SpotDetails";

export default function SpotPage({ params }: { params: Promise<{ tile: string; id: string }> }) {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-md px-4 pt-16 text-mist">Loading…</p>}>
      {params.then(({ tile, id }) => (
        <SpotDetails tile={tile} id={id} />
      ))}
    </Suspense>
  );
}
