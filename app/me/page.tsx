import type { Metadata } from "next";
import { MySunsets } from "../_components/MySunsets";

export const metadata: Metadata = {
  title: "My sunsets · Afterglow",
  description: "The sunsets you've logged, and how the forecast did.",
};

export default function MePage() {
  return <MySunsets />;
}
