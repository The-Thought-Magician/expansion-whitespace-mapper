import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ExpansionWhitespaceMapper',
  description: 'Map every account\'s owned-vs-eligible product grid, size open expansion ARR, and turn whitespace into tracked plays.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
