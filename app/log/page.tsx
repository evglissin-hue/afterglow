import type { Metadata } from "next";
import { LogSunset } from "../_components/LogSunset";

export const metadata: Metadata = {
  title: "Log the sunset · Afterglow",
  description: "Rate tonight's sunset and keep a few photos.",
};

export default function LogPage() {
  return <LogSunset />;
}
