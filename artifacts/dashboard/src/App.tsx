import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import { ProtectedRoute } from "@/components/module-protected-route";
import { useUserSync } from "@/hooks/use-user-sync";

import Home from "@/pages/home";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import DashboardLayout from "@/components/layout";

const DashboardSummary   = lazy(() => import("@/pages/dashboard/index"));
const TasksPage          = lazy(() => import("@/pages/dashboard/tasks"));
const ShortcutsPage      = lazy(() => import("@/pages/dashboard/shortcuts"));
const NewsPage           = lazy(() => import("@/pages/dashboard/news"));
const EmailsPage         = lazy(() => import("@/pages/dashboard/emails"));
const WeatherPage        = lazy(() => import("@/pages/dashboard/weather"));
const FiscalPage         = lazy(() => import("@/pages/dashboard/fiscal"));
const TravelPage         = lazy(() => import("@/pages/dashboard/travel"));
const DueDatesPage       = lazy(() => import("@/pages/dashboard/due-dates"));
const ClientsPage        = lazy(() => import("@/pages/dashboard/clients"));
const SupplierBatchesPage = lazy(() => import("@/pages/dashboard/supplier-batches"));
const TaxCalendarsPage   = lazy(() => import("@/pages/dashboard/tax-calendars"));
const FinancePage        = lazy(() => import("@/pages/dashboard/finance"));
const GoalsPage          = lazy(() => import("@/pages/dashboard/goals"));
const StrategyPage       = lazy(() => import("@/pages/dashboard/strategy"));
const DecisionsPage      = lazy(() => import("@/pages/dashboard/decisions"));
const AdminPage          = lazy(() => import("@/pages/admin"));
const SettingsPage       = lazy(() => import("@/pages/settings"));
const ContactsPage       = lazy(() => import("@/pages/dashboard/contacts"));
const ChatPage           = lazy(() => import("@/pages/dashboard/chat"));

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
// When base is "./" (portable static build), BASE_URL is "./" or ".".
// Normalise to "" so Wouter gets no base prefix and routes work correctly.
const rawBaseUrl = import.meta.env.BASE_URL ?? "/";
const basePath = rawBaseUrl === "./" || rawBaseUrl === "."
  ? ""
  : rawBaseUrl.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// ── Page-level Suspense fallback ───────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="space-y-4 p-2">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

// ── Route helpers ──────────────────────────────────────────────────────────────

const DashboardPage      = () => <DashboardLayout><Lazy><DashboardSummary /></Lazy></DashboardLayout>;
const Tasks              = () => <DashboardLayout><Lazy><TasksPage /></Lazy></DashboardLayout>;
const Shortcuts          = () => <DashboardLayout><Lazy><ShortcutsPage /></Lazy></DashboardLayout>;
const News               = () => <DashboardLayout><Lazy><NewsPage /></Lazy></DashboardLayout>;
const Emails             = () => <DashboardLayout><Lazy><EmailsPage /></Lazy></DashboardLayout>;
const Weather            = () => <DashboardLayout><Lazy><WeatherPage /></Lazy></DashboardLayout>;
const Fiscal             = () => <DashboardLayout><Lazy><FiscalPage /></Lazy></DashboardLayout>;
const Travel             = () => <DashboardLayout><Lazy><TravelPage /></Lazy></DashboardLayout>;
const DueDates           = () => <DashboardLayout><Lazy><DueDatesPage /></Lazy></DashboardLayout>;
const Clients            = () => <DashboardLayout><Lazy><ClientsPage /></Lazy></DashboardLayout>;
const SupplierBatches    = () => <DashboardLayout><Lazy><SupplierBatchesPage /></Lazy></DashboardLayout>;
const TaxCalendars       = () => <DashboardLayout><Lazy><TaxCalendarsPage /></Lazy></DashboardLayout>;
const Finance            = () => <DashboardLayout><Lazy><FinancePage /></Lazy></DashboardLayout>;
const Goals              = () => <DashboardLayout><Lazy><GoalsPage /></Lazy></DashboardLayout>;
const Strategy           = () => <DashboardLayout><Lazy><StrategyPage /></Lazy></DashboardLayout>;
const Decisions          = () => <DashboardLayout><Lazy><DecisionsPage /></Lazy></DashboardLayout>;
const Admin              = () => <DashboardLayout><Lazy><AdminPage /></Lazy></DashboardLayout>;
const Settings           = () => <DashboardLayout><Lazy><SettingsPage /></Lazy></DashboardLayout>;
const Contacts           = () => <DashboardLayout><Lazy><ContactsPage /></Lazy></DashboardLayout>;
const Chat               = () => <DashboardLayout><Lazy><ChatPage /></Lazy></DashboardLayout>;

const RouteDashboard       = () => <ProtectedRoute moduleKey="dashboard"        component={DashboardPage} />;
const RouteTasks           = () => <ProtectedRoute moduleKey="tasks"            component={Tasks} />;
const RouteShortcuts       = () => <ProtectedRoute moduleKey="shortcuts"        component={Shortcuts} />;
const RouteNews            = () => <ProtectedRoute moduleKey="news"             component={News} />;
const RouteEmails          = () => <ProtectedRoute moduleKey="emails"           component={Emails} />;
const RouteWeather         = () => <ProtectedRoute moduleKey="weather"          component={Weather} />;
const RouteFiscal          = () => <ProtectedRoute moduleKey="fiscal"           component={Fiscal} />;
const RouteTravel          = () => <ProtectedRoute moduleKey="travel"           component={Travel} />;
const RouteDueDates        = () => <ProtectedRoute moduleKey="due-dates"        component={DueDates} />;
const RouteClients         = () => <ProtectedRoute moduleKey="clients"          component={Clients} />;
const RouteSupplierBatches = () => <ProtectedRoute moduleKey="supplier-batches" component={SupplierBatches} />;
const RouteTaxCalendars    = () => <ProtectedRoute moduleKey="tax-calendars"    component={TaxCalendars} />;
const RouteFinance         = () => <ProtectedRoute moduleKey="finance"          component={Finance} />;
const RouteGoals           = () => <ProtectedRoute moduleKey="goals"            component={Goals} />;
const RouteStrategy        = () => <ProtectedRoute moduleKey="strategy"         component={Strategy} />;
const RouteDecisions       = () => <ProtectedRoute moduleKey="decisions"        component={Decisions} />;
const RouteAdmin           = () => <ProtectedRoute moduleKey="admin"            component={Admin} />;
const RouteSettings        = () => <ProtectedRoute moduleKey="settings"         component={Settings} />;
const RouteContacts        = () => <ProtectedRoute moduleKey="contacts"         component={Contacts} />;
const RouteChat            = () => <ProtectedRoute moduleKey="chat"             component={Chat} />;

// ── Clerk cache invalidator ────────────────────────────────────────────────────

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function UserSyncEffect() {
  useUserSync();
  return null;
}

// ── Main router ────────────────────────────────────────────────────────────────

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <UserSyncEffect />
        <TooltipProvider>
          <Switch>
            <Route path="/"                       component={Home} />
            <Route path="/sign-in/*?"             component={SignInPage} />
            <Route path="/sign-up/*?"             component={SignUpPage} />
            <Route path="/dashboard"              component={RouteDashboard} />
            <Route path="/dashboard/tasks"        component={RouteTasks} />
            <Route path="/dashboard/shortcuts"    component={RouteShortcuts} />
            <Route path="/dashboard/news"         component={RouteNews} />
            <Route path="/dashboard/emails"       component={RouteEmails} />
            <Route path="/dashboard/weather"      component={RouteWeather} />
            <Route path="/dashboard/fiscal"       component={RouteFiscal} />
            <Route path="/dashboard/travel"       component={RouteTravel} />
            <Route path="/dashboard/due-dates"    component={RouteDueDates} />
            <Route path="/dashboard/clients"      component={RouteClients} />
            <Route path="/dashboard/supplier-batches" component={RouteSupplierBatches} />
            <Route path="/dashboard/tax-calendars" component={RouteTaxCalendars} />
            <Route path="/dashboard/finance"      component={RouteFinance} />
            <Route path="/dashboard/goals"        component={RouteGoals} />
            <Route path="/dashboard/strategy"     component={RouteStrategy} />
            <Route path="/dashboard/decisions"    component={RouteDecisions} />
            <Route path="/admin"                  component={RouteAdmin} />
            <Route path="/settings"               component={RouteSettings} />
            <Route path="/dashboard/contacts"     component={RouteContacts} />
            <Route path="/dashboard/chat"         component={RouteChat} />
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="dashboard-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
