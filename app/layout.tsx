import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QTI 3.0 Reviewer",
  description: "AI-powered QTI 3.0 assessment item reviewer using Google Gemini",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-gray-900 antialiased">
        {/* Nav */}
        <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                Q
              </div>
              <span className="font-semibold text-gray-900">QTI Reviewer</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                3.0
              </span>
            </div>
            <div className="flex-1" />
            <span className="text-xs text-gray-400">Powered by Google Gemini</span>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>

        <footer className="border-t border-gray-200 mt-16 py-6 text-center text-xs text-gray-400">
          QTI 3.0 Reviewer — AI-powered assessment quality assurance
        </footer>
      </body>
    </html>
  );
}
