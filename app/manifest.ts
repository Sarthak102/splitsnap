import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SplitSnap',
    short_name: 'SplitSnap',
    description: 'Scan the bill, tap what you ate, pay your friend back over UPI.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4e9d3',
    theme_color: '#f4e9d3',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
