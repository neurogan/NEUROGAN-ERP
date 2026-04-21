import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocationWithParams } from "@/lib/useHashLocationWithParams";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Settings as SettingsIcon, Sun, Moon } from "lucide-react";
import neuroganLogo from "@/assets/neurogan-logo.jpg";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import Transactions from "@/pages/transactions";
import SuppliersTab from "@/pages/suppliers-tab";
import Production from "@/pages/production";
import Receiving from "@/pages/receiving";
import CoaLibrary from "@/pages/coa-library";
import Settings from "@/pages/settings";
import SupplyChain from "@/pages/supply-chain";
import BatchPrint from "@/pages/batch-print";
import SkuManager from "@/pages/sku-manager";
import QmsDashboard from "@/pages/qms-dashboard";
import QmsReleaseQueue from "@/pages/qms-release-queue";
import QmsCapa from "@/pages/qms-capa";
import QmsComplaints from "@/pages/qms-complaints";
import QmsAuditLog from "@/pages/qms-audit-log";
import { QmsUserSelector } from "@/components/qms-user-selector";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/supply-chain", label: "Supply Chain" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/receiving", label: "Receiving" },
  { href: "/production", label: "Production" },
  { href: "/transactions", label: "Transactions" },
  { href: "/qms", label: "QMS", badge: true },
];

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="flex items-center justify-center h-8 w-8 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      data-testid="button-toggle-theme"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}

function TopNav() {
  const [location] = useLocation();

  return (
    <header className="shrink-0 border-b border-border bg-card">
      {/* Top bar: logo + settings */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2.5">
          <img src={neuroganLogo} alt="Neurogan" className="h-8 w-8 rounded-lg object-cover" />
          <div>
            <div className="text-sm font-semibold tracking-tight text-foreground">Neurogan Inventory</div>
            <div className="text-[10px] text-muted-foreground">Inventory Management</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <button
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted ${
                location === "/settings"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              }`}
              data-testid="nav-settings"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              <span>Settings</span>
            </button>
          </Link>
          <QmsUserSelector />
          <ThemeToggle />
        </div>
      </div>

      {/* Navigation tabs */}
      <nav className="flex items-center gap-0 px-5" data-testid="nav-tabs">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? location === "/"
              : location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <button
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="flex items-center gap-1.5">
                  {item.label}
                  {"badge" in item && item.badge && (
                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold leading-none">
                      !
                    </span>
                  )}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />
                )}
              </button>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-background">
      <TopNav />
      <main className="flex-1 overflow-auto">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/supply-chain" component={SupplyChain} />
          <Route path="/suppliers" component={SuppliersTab} />
          <Route path="/receiving" component={Receiving} />
          <Route path="/coa" component={CoaLibrary} />
          <Route path="/production" component={Production} />
          <Route path="/transactions" component={Transactions} />
          <Route path="/sku-manager" component={SkuManager} />
          <Route path="/qms" component={QmsDashboard} />
          <Route path="/qms/release-queue" component={QmsReleaseQueue} />
          <Route path="/qms/capa" component={QmsCapa} />
          <Route path="/qms/complaints" component={QmsComplaints} />
          <Route path="/qms/audit-log" component={QmsAuditLog} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <footer className="shrink-0 border-t border-border px-5 py-2">
        <PerplexityAttribution />
      </footer>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocationWithParams}>
            <Switch>
              <Route path="/production/print/:id" component={BatchPrint} />
              <Route>
                <AppLayout />
              </Route>
            </Switch>
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
