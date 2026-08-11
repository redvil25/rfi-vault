import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RFI Vault — EU CTR request-for-information repository',
  description:
    'Searchable repository of EU CTR validation RFI considerations and approved sponsor responses.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
