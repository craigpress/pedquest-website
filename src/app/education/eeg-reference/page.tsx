import EegReferenceBrowser from "@/components/EegReferenceBrowser";
export const metadata = { title: "EEG and qEEG reference | PedQuEST" };
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const { q = "", category = "All" } = await searchParams;
  return <EegReferenceBrowser initialQuery={q} initialCategory={category}/>;
}
