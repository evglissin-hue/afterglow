import type { Metadata } from "next";
import { LiveMode } from "../_components/LiveMode";

export const metadata: Metadata = {
  title: "Live · Afterglow",
  description: "A countdown and what to watch while the sunset happens.",
};

export default function LivePage() {
  return <LiveMode />;
}
