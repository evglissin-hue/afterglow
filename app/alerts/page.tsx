import type { Metadata } from "next";
import AlertSettings from "../_components/AlertSettings";

export const metadata: Metadata = {
  title: "Sunset alerts · Afterglow",
  description: "Get a nudge when tonight's sunset looks worth stepping out for.",
};

export default function AlertsPage() {
  return <AlertSettings />;
}
