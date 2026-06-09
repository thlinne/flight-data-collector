import "./globals.css";
import type { ReactNode } from "react";
import { Activity, Bell, BookOpen, Database, FileText, Gauge, Globe2, Plane, Settings, Table2, Workflow } from "lucide-react";
import { appEnvironment, appVersion } from "./build-info";

const links = [
  ["/", "Overview", Gauge],
  ["/countries", "Countries", Globe2],
  ["/providers", "Providers", Plane],
  ["/control", "Collection Control", Settings],
  ["/raw", "Raw Data Explorer", Database],
  ["/reference-data", "Reference Data", BookOpen],
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
            <div className="brand">
              Flight Data Collector
              <span className={`environment-badge ${appEnvironment === "PROD" ? "is-prod" : "is-dev"}`}>{appEnvironment}</span>
              <span className="build-badge">ver {appVersion}</span>
            </div>
            <nav className="nav">
              {links.slice(0, 5).map(([href, label, Icon]) => (
                <a key={href} href={href} title={label}>
                  <Icon size={16} /> {label}
                </a>
              ))}
              <div className="nav-group">
                <a href="/reports" title="Reports">
                  <FileText size={16} /> Reports
                </a>
                <div className="nav-flyout">
                  <a href="/reports#r1">R1 Daily Overview</a>
                  <a href="/reports#r2">R2 Daily Detail</a>
                </div>
              </div>
              {links.slice(5).map(([href, label, Icon]) => (
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
