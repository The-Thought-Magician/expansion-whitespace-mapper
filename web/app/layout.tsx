import type { Metadata } from 'next'
import { Sora } from 'next/font/google'
import './globals.css'

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap' })

export const metadata: Metadata = {
  title: 'ExpansionWhitespaceMapper',
  description: 'Map every account\'s owned-vs-eligible product grid, size open expansion ARR, and turn whitespace into tracked plays.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sora.variable}>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
