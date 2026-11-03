import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "How it works · Afterglow",
  description: "How Afterglow forecasts tonight's sunset.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-5 pb-14">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tonight
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-3 text-mist">
        Afterglow scores tonight&apos;s sunset from 0 to 100 and tells you what it&apos;s likely to look like and
        when to watch.
      </p>

      <div className="mt-8 space-y-7 leading-relaxed">
        <Section title="It's about the clouds">
          The colorful part of a sunset is cloud lit from below. A clear sky gives a clean orange glow; high and
          mid-level cloud gives the pinks and reds; a thick low layer hides everything.
        </Section>

        <Section title="Looking along the sunset line">
          After sunset, the clouds above you are lit by sunlight that skims in from up to 300 km away, toward the
          sun. So Afterglow checks the forecast at 8 points along tonight&apos;s sunset direction. High and mid
          cloud near you is the canvas that lights up. Low and mid cloud far toward the sun can block the light
          before it gets there, even when your own sky looks perfect.
        </Section>

        <Section title="Don't leave at sunset">
          The best color often comes 5 to 20 minutes after the sun goes down, when most people have already left.
          High cloud stays lit the longest.
        </Section>

        <Section title="Finding spots near you">
          Afterglow builds a height map of London from OpenStreetMap buildings and trees plus Ordnance Survey
          terrain. From every park, canal path, bridge and west-facing street it works out what rises above the
          horizon toward the sunset, and how that changes through the year as the sunset moves between south-west
          in December and north-west in June. Trees and building heights are often missing from the map, so check a
          spot the first time you go.
        </Section>

        <Section title="Air and rain">
          Haze and smoke mute the colors. Rain clearing before sunset is often a good sign.
        </Section>

        <Section title="Confidence">
          Three weather models, from the UK Met Office, ECMWF and Germany&apos;s DWD, are scored separately. You
          see the middle score; when the models disagree, confidence drops. Forecasts are best guesses, and cloud
          forecasts can be wrong.
        </Section>

        <Section title="Data">
          Weather from{" "}
          <a href="https://open-meteo.com" className="underline underline-offset-2">
            Open-Meteo.com
          </a>{" "}
          (CC BY 4.0). Air quality from the Copernicus Atmosphere Monitoring Service via Open-Meteo. Sun times
          from SunCalc. Map data © OpenStreetMap contributors (ODbL); map tiles by OpenFreeMap. Contains OS data ©
          Crown copyright and database right 2026 (Open Government Licence).
        </Section>

        <Section title="Privacy">
          Your location stays in your browser. To get the forecast, your browser asks Open-Meteo for a location
          rounded to roughly 10 km, plus points along the sunset line. Nothing is stored on our servers.
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 text-mist">{children}</p>
    </section>
  );
}
