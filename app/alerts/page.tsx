import type { Metadata } from "next";
import AlertSettings from "../_components/AlertSettings";
import { alertsClientConfig } from "../_server/alerts/env";

export const metadata: Metadata = {
  title: "Sunset alerts · Afterglow",
  description: "Get a nudge when tonight's sunset looks worth stepping out for.",
};

export default function AlertsPage() {
  // Read when the site is built: Vercel builds again after environment variables change.
  const { configured, publicKey } = alertsClientConfig();
  return <AlertSettings configured={configured} publicKey={publicKey} />;
}
