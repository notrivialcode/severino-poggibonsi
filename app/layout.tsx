export const metadata = {
  title: 'Severino Poggibonsi',
  description: 'GitHub bot for managing stale PRs and branch cleanup',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}