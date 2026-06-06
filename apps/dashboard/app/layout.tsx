import "./globals.css";
import type { ReactNode } from "react";
import { Activity, Bell, Database, Gauge, Globe2, Plane, Settings, Table2, Workflow } from "lucide-react";

const links = [
  ["/", "Overview", Gauge],
  ["/countries", "Countries", Globe2],
  ["/providers", "Providers", Plane],
  ["/control", "Collection Control", Settings],
  ["/raw", "Raw Data Explorer", Database],
  ["/analytics", "Analytics", Table2],
  ["/alerts", "System Alerts", Bell],
  ["/health", "System Health", Activity],
  ["/backfill", "Backfill", Workflow]
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Flight Data Collector</div>
            <nav className="nav">
              {links.map(([href, label, Icon]) => (
                <a key={href} href={href} title={label}>
                  <Icon size={16} /> {label}
                </a>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
