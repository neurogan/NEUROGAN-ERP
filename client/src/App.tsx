import { Switch, Route, Router, Link, useLocation, Redirect } from "wouter";
import { useHashLocationWithParams } from "@/lib/useHashLocationWithParams";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Settings as SettingsIcon, Sun, Moon, LogOut } from "lucide-react";
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
import SettingsUsers from "@/pages/settings-users";
import AuditTrail from "@/pages/audit";
import Profile from "@/pages/profile";
import SupplyChain from "@/pages/supply-chain";
import BatchPrint from "@/pages/batch-print";
import SkuManager from "@/pages/sku-manager";
import Login from "@/pages/login";
import ValidationDetail from "@/pages/quality/ValidationDetail";
import OosInvestigations from "@/pages/OosInvestigations";
import EquipmentPage from "@/pages/equipment";
import { useAuth, useLogout } from "@/lib/auth";
import { InactivityWarning } from "@/components/InactivityWarning";

interface NavItem {
  href: string;
  label: string;
  requiredRoles?: string[];
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/supply-chain", label: "Supply Chain" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/receiving", label: "Receiving" },
  { href: "/production", label: "Production" },
  { href: "/equipment", label: "Equipment" },
  { href: "/transactions", label: "Transactions" },
  { href: "/oos-investigations", label: "OOS", requiredRoles: ["QA", "ADMIN"] },
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
  const { user } = useAuth();
  const logout = useLogout();
  const canViewAudit = user?.roles?.some((r) => r === "ADMIN" || r === "QA") ?? false;
  const userRoles: string[] = user?.roles ?? [];
  const visibleNavItems = navItems.filter(
    (item) => !item.requiredRoles || item.requiredRoles.some((r) => userRoles.includes(r)),
  );

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
          {canViewAudit && (
            <Link href="/audit">
              <button
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted ${
                  location.startsWith("/audit")
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                }`}
                data-testid="nav-audit"
              >
                <span>Audit Trail</span>
              </button>
            </Link>
          )}
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
          <ThemeToggle />
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <Link href="/profile">
                <span className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                  {user.fullName}
                </span>
              </Link>
              <button
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="flex items-center justify-center h-8 w-8 rounded-full border border-border text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                title="Sign out"
                data-testid="nav-logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation tabs */}
      <nav className="flex items-center gap-0 px-5" data-testid="nav-tabs">
        {visibleNavItems.map((item) => {
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
                {item.label}
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
          <Route path="/audit" component={AuditTrail} />
          <Route path="/settings/validation/:id" component={ValidationDetail} />
          <Route path="/settings/users" component={SettingsUsers} />
          <Route path="/settings" component={Settings} />
          <Route path="/oos-investigations" component={OosInvestigations} />
          <Route path="/equipment" component={EquipmentPage} />
          <Route path="/equipment/:tab" component={EquipmentPage} />
          <Route path="/profile/rotate-password" component={Profile} />
          <Route path="/profile" component={Profile} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, mustRotatePassword } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) return <Redirect to="/login" />;
  if (mustRotatePassword && location !== "/profile/rotate-password") {
    return <Redirect to="/profile/rotate-password" />;
  }

  return <>{children}</>;
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
              <Route path="/login" component={Login} />
              <Route>
                <AuthGate>
                  <AppLayout />
                </AuthGate>
              </Route>
            </Switch>
            <AuthGateInactivity />
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function AuthGateInactivity() {
  const { isAuthenticated } = useAuth();
  return <InactivityWarning isAuthenticated={isAuthenticated} />;
}

export default App;
