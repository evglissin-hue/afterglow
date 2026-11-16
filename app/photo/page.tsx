import type { Metadata } from "next";
import { SunsetPhoto } from "../_components/SunsetPhoto";

export const metadata: Metadata = {
  title: "Sunset photo · Afterglow",
  description: "Take the sunset with your phone's own camera, pick a look and save it at full size.",
};

export default function PhotoPage() {
  return <SunsetPhoto />;
}
