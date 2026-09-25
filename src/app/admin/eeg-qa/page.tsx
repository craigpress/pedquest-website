"use client";
import EegVisualQa from "@/components/EegVisualQa";
import { useRole } from "@/lib/auth";
export default function Page() {
  const { isEditor } = useRole();
  if (!isEditor) return <main style={{ margin: 100 }}>Editor access required.</main>;
  return <main style={{ margin: "100px auto", maxWidth: 1100, padding: 24 }}><h1>Flagged EEG visual QA</h1><EegVisualQa source="qbank"/><EegVisualQa source="lab"/></main>;
}
