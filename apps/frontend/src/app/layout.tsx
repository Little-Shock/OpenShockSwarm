import type { Metadata } from "next";
import { OperatorProvider } from "@/components/operator-provider";
import { getCurrentOperatorName } from "@/lib/operator-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenShock.ai",
  description: "Human and agent collaboration shell for issue-driven execution.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const operatorName = await getCurrentOperatorName();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <OperatorProvider initialOperatorName={operatorName}>
          {children}
        </OperatorProvider>
      </body>
    </html>
  );
}
