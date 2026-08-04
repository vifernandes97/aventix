import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Aventix e a PLATAFORMA; a UI publica exibe a marca do TENANT (regra de marca,
// rev 5). Este titulo e do layout RAIZ, que hoje serve so o admin — a tela do
// dono, onde "Aventix" e o nome certo. Quando o fluxo publico entrar, ele leva
// metadata propria com settings.business_name, e nao herda esta.
export const metadata: Metadata = {
  title: "Aventix — Painel",
  description: "Agendamento de experiências",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
