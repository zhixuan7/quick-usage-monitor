"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    window.location.replace("/agents/?tab=permissions");
  }, []);
  return <main className="p-8">Opening agent permissions…</main>;
}
