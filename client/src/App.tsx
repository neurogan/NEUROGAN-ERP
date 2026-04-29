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
import QualityPage from "@/pages/quality";
import ComplaintDetail from "@/pages/quality/ComplaintDetail";
import ComplaintAE from "@/pages/quality/ComplaintAE";
import ComplaintTrends from "@/pages/quality/ComplaintTrends";
import ReturnDetail from "@/pages/quality/ReturnDetail";
import ReturnInvestigations from "@/pages/quality/ReturnInvestigations";
import EquipmentDetailPage from "@/pages/equipment/detail";
import ProcurementPage from "@/pages/procurement";
import OperationsPage from "@/pages/operations";
import { useAuth, useLogout } from "@/lib/auth";
import { InactivityWarning } from "@/components/InactivityWarning";

interface NavItem {
  href: string;
  label: string;
  requiredRoles?: string[];
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/supply-chain", label: "Supply Chain" },
  { href: "/inventory", label: "Inventory" },
  { href: "/procurement", label: "Procurement" },
  { href: "/operations", label: "Operations" },
  { href: "/quality", label: "Quality", requiredRoles: ["QA", "ADMIN"] },
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
  const canManageTransactions = user?.roles?.some((r) => r === "ADMIN") ?? false;
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
          {canManageTransactions && (
            <Link href="/transactions">
              <button
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted ${
                  location.startsWith("/transactions")
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                }`}
                data-testid="nav-transactions"
              >
                <span>Transactions</span>
              </button>
            </Link>
          )}
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
          <Route path="/procurement" component={ProcurementPage} />
          <Route path="/procurement/purchasing" component={ProcurementPage} />
          <Route path="/procurement/receiving" component={ProcurementPage} />
          <Route path="/operations" component={OperationsPage} />
          <Route path="/operations/production" component={OperationsPage} />
          <Route path="/operations/equipment" component={OperationsPage} />
          <Route path="/operations/equipment/master" component={OperationsPage} />
          <Route path="/operations/equipment/calibration" component={OperationsPage} />
          <Route path="/operations/equipment/cleaning" component={OperationsPage} />
          <Route path="/operations/equipment/line-clearance" component={OperationsPage} />
          <Route path="/operations/equipment/:id" component={EquipmentDetailPage} />
          <Route path="/coa" component={CoaLibrary} />
          <Route path="/transactions" component={Transactions} />
          <Route path="/sku-manager" component={SkuManager} />
          <Route path="/audit" component={AuditTrail} />
          <Route path="/settings/validation/:id" component={ValidationDetail} />
          <Route path="/settings/users" component={SettingsUsers} />
          <Route path="/settings" component={Settings} />
          <Route path="/quality" component={QualityPage} />
          <Route path="/quality/oos" component={QualityPage} />
          <Route path="/quality/labeling" component={QualityPage} />
          <Route path="/quality/labeling/artwork" component={QualityPage} />
          <Route path="/quality/labeling/spools" component={QualityPage} />
          <Route path="/quality/labeling/reconciliation" component={QualityPage} />
          <Route path="/quality/sops" component={QualityPage} />
          <Route path="/quality/complaints" component={QualityPage} />
          <Route path="/quality/complaints/trends" component={ComplaintTrends} />
          <Route path="/quality/complaints/:id/ae" component={ComplaintAE} />
          <Route path="/quality/complaints/:id" component={ComplaintDetail} />
          <Route path="/quality/returns" component={QualityPage} />
          <Route path="/quality/returns/:id" component={ReturnDetail} />
          <Route path="/quality/return-investigations" component={ReturnInvestigations} />
          <Route path="/profile/rotate-password" component={Profile} />
          <Route path="/profile" component={Profile} />
          <Route path="/suppliers"><Redirect to="/procurement/purchasing" /></Route>
          <Route path="/receiving"><Redirect to="/procurement/receiving" /></Route>
          <Route path="/production"><Redirect to="/operations/production" /></Route>
          <Route path="/equipment"><Redirect to="/operations/equipment" /></Route>
          <Route path="/equipment/master"><Redirect to="/operations/equipment/master" /></Route>
          <Route path="/equipment/calibration"><Redirect to="/operations/equipment/calibration" /></Route>
          <Route path="/equipment/cleaning"><Redirect to="/operations/equipment/cleaning" /></Route>
          <Route path="/equipment/line-clearance"><Redirect to="/operations/equipment/line-clearance" /></Route>
          <Route path="/oos-investigations"><Redirect to="/quality/oos" /></Route>
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
