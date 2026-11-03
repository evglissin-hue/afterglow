import type { Metadata } from "next";
import Compass from "../_components/Compass";

export const metadata: Metadata = {
  title: "Compass · Afterglow",
  description: "Turn to face tonight's sunset, with a compass dial or your camera.",
};

export default function CompassPage() {
  return <Compass />;
}
