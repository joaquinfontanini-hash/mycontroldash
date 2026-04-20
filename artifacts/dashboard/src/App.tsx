import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, useClerk, useUser } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
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
import {
  LOCAL_AUTH_MODE,
  getLocalSession,
  clearLocalSession,
  LOCAL_NAME,
  LOCAL_EMAIL,
} from "@/lib/local-auth";
import { AuthContextProvider, buildAuthValue } from "@/contexts/auth-context";

import Home from "@/pages/home";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import LocalSignInPage from "@/pages/local-sign-in";
import ChangePasswordPage from "@/pages/change-password";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import DashboardLayout from "@/components/layout";

const DashboardSummary    = lazy(() => import("@/pages/dashboard/index"));
const NotificationsPage   = lazy(() => import("@/pages/dashboard/notifications"));
const TasksPage           = lazy(() => import("@/pages/dashboard/tasks"));
const ShortcutsPage       = lazy(() => import("@/pages/dashboard/shortcuts"));
const NewsPage            = lazy(() => import("@/pages/dashboard/news"));
const EmailsPage          = lazy(() => import("@/pages/dashboard/emails"));
const WeatherPage         = lazy(() => import("@/pages/dashboard/weather"));
const FiscalPage          = lazy(() => import("@/pages/dashboard/fiscal"));
const TravelPage          = lazy(() => import("@/pages/dashboard/travel"));
const DueDatesPage        = lazy(() => import("@/pages/dashboard/due-dates"));
const ClientsPage         = lazy(() => import("@/pages/dashboard/clients"));
const SupplierBatchesPage = lazy(() => import("@/pages/dashboard/supplier-batches"));
const TaxCalendarsPage    = lazy(() => import("@/pages/dashboard/tax-calendars"));
const FinancePage         = lazy(() => import("@/pages/dashboard/finance"));
const GoalsPage           = lazy(() => import("@/pages/dashboard/goals"));
const StrategyPage        = lazy(() => import("@/pages/dashboard/strategy"));
const DecisionsPage       = lazy(() => import("@/pages/dashboard/decisions"));
const ModulesOverviewPage = lazy(() => import("@/pages/dashboard/modules-overview"));
const AdminPage           = lazy(() => import("@/pages/admin"));
const SettingsPage        = lazy(() => import("@/pages/settings"));
const ContactsPage        = lazy(() => import("@/pages/dashboard/contacts"));
const ChatPage            = lazy(() => import("@/pages/dashboard/chat"));
const StudioPage          = lazy(() => import("@/pages/dashboard/studio"));
const QuotesPage          = lazy(() => import("@/pages/dashboard/quotes"));
const FitnessPage         = lazy(() => import("@/pages/dashboard/fitness"));

// ── Clerk env vars (only required in Clerk mode) ───────────────────────────────
const clerkPubKey   = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

if (!LOCAL_AUTH_MODE && !clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

// ── Base path normalisation ────────────────────────────────────────────────────
const rawBaseUrl = import.meta.env.BASE_URL ?? "/";
const basePath = rawBaseUrl === "./" || rawBaseUrl === "."
  ? ""
  : rawBaseUrl.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// ── Shared page-level Suspense ─────────────────────────────────────────────────

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

// ── Page components ────────────────────────────────────────────────────────────

const DashboardPage   = () => <DashboardLayout><Lazy><DashboardSummary /></Lazy></DashboardLayout>;
const Tasks           = () => <DashboardLayout><Lazy><TasksPage /></Lazy></DashboardLayout>;
const Shortcuts       = () => <DashboardLayout><Lazy><ShortcutsPage /></Lazy></DashboardLayout>;
const News            = () => <DashboardLayout><Lazy><NewsPage /></Lazy></DashboardLayout>;
const Emails          = () => <DashboardLayout><Lazy><EmailsPage /></Lazy></DashboardLayout>;
const Weather         = () => <DashboardLayout><Lazy><WeatherPage /></Lazy></DashboardLayout>;
const Fiscal          = () => <DashboardLayout><Lazy><FiscalPage /></Lazy></DashboardLayout>;
const Travel          = () => <DashboardLayout><Lazy><TravelPage /></Lazy></DashboardLayout>;
const DueDates        = () => <DashboardLayout><Lazy><DueDatesPage /></Lazy></DashboardLayout>;
const Clients         = () => <DashboardLayout><Lazy><ClientsPage /></Lazy></DashboardLayout>;
const SupplierBatches = () => <DashboardLayout><Lazy><SupplierBatchesPage /></Lazy></DashboardLayout>;
const TaxCalendars    = () => <DashboardLayout><Lazy><TaxCalendarsPage /></Lazy></DashboardLayout>;
const Finance         = () => <DashboardLayout><Lazy><FinancePage /></Lazy></DashboardLayout>;
const Goals           = () => <DashboardLayout><Lazy><GoalsPage /></Lazy></DashboardLayout>;
const Strategy        = () => <DashboardLayout><Lazy><StrategyPage /></Lazy></DashboardLayout>;
const Decisions       = () => <DashboardLayout><Lazy><DecisionsPage /></Lazy></DashboardLayout>;
const ModulesOverview = () => <DashboardLayout><Lazy><ModulesOverviewPage /></Lazy></DashboardLayout>;
const Admin           = () => <DashboardLayout><Lazy><AdminPage /></Lazy></DashboardLayout>;
const Settings        = () => <DashboardLayout><Lazy><SettingsPage /></Lazy></DashboardLayout>;
const Contacts        = () => <DashboardLayout><Lazy><ContactsPage /></Lazy></DashboardLayout>;
const Chat            = () => <DashboardLayout><Lazy><ChatPage /></Lazy></DashboardLayout>;
const Studio          = () => <DashboardLayout><Lazy><StudioPage /></Lazy></DashboardLayout>;
const Quotes          = () => <DashboardLayout><Lazy><QuotesPage /></Lazy></DashboardLayout>;
const Fitness         = () => <DashboardLayout><Lazy><FitnessPage /></Lazy></DashboardLayout>;

// ── Protected route wrappers ───────────────────────────────────────────────────

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
const RouteModulesOverview = () => <ProtectedRoute moduleKey="dashboard"        component={ModulesOverview} />;
const RouteAdmin           = () => <ProtectedRoute moduleKey="admin"            component={Admin} />;
const RouteSettings        = () => <ProtectedRoute moduleKey="settings"         component={Settings} />;
const RouteContacts        = () => <ProtectedRoute moduleKey="contacts"         component={Contacts} />;
const RouteChat            = () => <ProtectedRoute moduleKey="chat"             component={Chat} />;
const RouteStudio          = () => <ProtectedRoute moduleKey="dashboard_studio"  component={Studio} />;
const RouteQuotes          = () => <ProtectedRoute moduleKey="quotes"             component={Quotes} />;
const RouteFitness         = () => <ProtectedRoute moduleKey="fitness"            component={Fitness} />;

// ══════════════════════════════════════════════════════════════════════════════
// ── LOCAL AUTH MODE ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function LocalAuthBridge({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const session = getLocalSession();

  const value = buildAuthValue(
    session?.name ?? LOCAL_NAME,
    session?.email ?? LOCAL_EMAIL,
    undefined,
    () => {
      clearLocalSession();
      setLocation("/sign-in");
    },
  );

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}

function LocalHome() {
  const session = getLocalSession();
  return <Redirect to={session ? "/dashboard" : "/sign-in"} />;
}

function UserSyncEffect() {
  useUserSync();
  return null;
}

function LocalApp() {
  return (
    <ThemeProvider defaultTheme="blue-calm" storageKey="app-color-theme">
      <WouterRouter base="">
        <QueryClientProvider client={queryClient}>
          <LocalAuthBridge>
            <UserSyncEffect />
            <TooltipProvider>
              <Switch>
                <Route path="/"                       component={LocalHome} />
                <Route path="/sign-in/*?"             component={LocalSignInPage} />
                <Route path="/forgot-password"        component={ForgotPasswordPage} />
                <Route path="/reset-password"         component={ResetPasswordPage} />
                <Route path="/change-password"        component={ChangePasswordPage} />
                <Route path="/register"               component={RegisterPage} />
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
                <Route path="/dashboard/overview"     component={RouteModulesOverview} />
                <Route path="/admin"                  component={RouteAdmin} />
                <Route path="/settings"               component={RouteSettings} />
                <Route path="/dashboard/contacts"     component={RouteContacts} />
                <Route path="/dashboard/chat"         component={RouteChat} />
                <Route path="/dashboard/studio"       component={RouteStudio} />
                <Route path="/dashboard/quotes"       component={RouteQuotes} />
                <Route path="/dashboard/fitness"      component={RouteFitness} />
                <Route path="/dashboard/notifications" component={() => <Suspense fallback={null}><NotificationsPage /></Suspense>} />
                <Route component={NotFound} />
              </Switch>
            </TooltipProvider>
          </LocalAuthBridge>
        </QueryClientProvider>
      </WouterRouter>
      <Toaster />
    </ThemeProvider>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CLERK AUTH MODE ──────────────────────────════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

function ClerkAuthBridge({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();

  const value = buildAuthValue(
    user?.fullName ?? "Mi Cuenta",
    user?.primaryEmailAddress?.emailAddress ?? "",
    user?.imageUrl,
    signOut,
  );

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}

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

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      afterSignOutUrl="/sign-in"
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <UserSyncEffect />
        <ClerkAuthBridge>
          <TooltipProvider>
            <Switch>
              <Route path="/"                       component={Home} />
              <Route path="/sign-in/*?"             component={SignInPage} />
              <Route path="/sign-up/*?"             component={SignUpPage} />
              <Route path="/forgot-password"        component={ForgotPasswordPage} />
              <Route path="/reset-password"         component={ResetPasswordPage} />
              <Route path="/change-password"        component={ChangePasswordPage} />
              <Route path="/register"               component={RegisterPage} />
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
              <Route path="/dashboard/overview"     component={RouteModulesOverview} />
              <Route path="/admin"                  component={RouteAdmin} />
              <Route path="/settings"               component={RouteSettings} />
              <Route path="/dashboard/contacts"     component={RouteContacts} />
              <Route path="/dashboard/chat"         component={RouteChat} />
              <Route path="/dashboard/studio"       component={RouteStudio} />
              <Route path="/dashboard/quotes"       component={RouteQuotes} />
              <Route path="/dashboard/fitness"      component={RouteFitness} />
              <Route path="/dashboard/notifications" component={() => <Suspense fallback={null}><NotificationsPage /></Suspense>} />
              <Route component={NotFound} />
            </Switch>
          </TooltipProvider>
        </ClerkAuthBridge>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function ClerkApp() {
  return (
    <ThemeProvider defaultTheme="blue-calm" storageKey="app-color-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </ThemeProvider>
  );
}

// ── Root export ────────────────────────────────────────────────────────────────

export default function App() {
  return LOCAL_AUTH_MODE ? <LocalApp /> : <ClerkApp />;
}
