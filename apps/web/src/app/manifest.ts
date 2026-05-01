import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LINE Harness',
    short_name: 'Harness',
    description: 'LINE公式アカウント CRM 管理画面',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#06C755',
    orientation: 'portrait',
    icons: [
      { src: '/icon', sizes: '256x256', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
