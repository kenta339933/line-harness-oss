import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'
export const size = { width: 256, height: 256 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06C755',
          color: 'white',
          fontSize: 160,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
          borderRadius: 56,
        }}
      >
        H
      </div>
    ),
    { ...size }
  )
}
