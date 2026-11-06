import { Suspense } from 'react';
import BillView from '@/components/bill/BillView';

async function Bill({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BillView token={token} />;
}

export default function BillPage({ params }: PageProps<'/b/[token]'>) {
  return (
    <Suspense fallback={<p role="status">Loading the bill…</p>}>
      <Bill params={params} />
    </Suspense>
  );
}
