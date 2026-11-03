import type { Metadata } from "next";
import SpotMap from "../_components/SpotMap";

export const metadata: Metadata = {
  title: "Spots near you · Afterglow",
  description: "Sunset spots near you, colored by tonight's view toward the sunset.",
};

export default function MapPage() {
  return <SpotMap />;
}
